import express from 'express';
import { param, query, validationResult } from 'express-validator';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { TravelMasterAPI } from '../integrations/odoo/travelMasterPayment.service.js';
import { logger } from '../utils/logger.js';
import { createPurchase, completePurchase } from './purchase.js';
import { createClient } from 'redis';
import { getFirestore } from '../config/firebase.config.mjs';
import axios from 'axios';
import { incrementTicketCounters } from '../utils/ticketCounters.js';

const router = express.Router();

// Initialize TravelMaster API
const travelMaster = new TravelMasterAPI({
  url: process.env.TRAVELMASTER_URL,
  db: process.env.TRAVELMASTER_DB,
  username: process.env.TRAVELMASTER_USERNAME,
  password: process.env.TRAVELMASTER_PASSWORD
});

// Authenticate with TravelMaster API on startup
(async () => {
  try {
    await travelMaster.authenticate();
    logger.info('✅ Successfully connected to TravelMaster API');
  } catch (error) {
    logger.error('❌ Failed to connect to TravelMaster API:', error);
  }
})();

// Redis client for deduplication
let redisClient = null;
let redisAvailable = false;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => { logger.error('Redis error:', err); redisAvailable = false; });
  redisClient.on('connect', () => { logger.info('✅ Redis connected'); redisAvailable = true; });
  (async () => {
    try {
      await redisClient.connect();
    } catch (err) {
      logger.warn('Redis connect failed:', err.message);
      redisAvailable = false;
    }
  })();
} else { 
  logger.warn('REDIS_URL not provided, running without Redis deduplication'); 
}

// Redis helpers
async function isProcessed(paymentRef) {
  if (!redisAvailable || !redisClient) return false;
  try { return (await redisClient.get(`payment:${paymentRef}`)) === '1'; }
  catch (err) { logger.warn('Redis check failed:', err.message); return false; }
}

async function markProcessed(paymentRef) {
  if (!redisAvailable || !redisClient) return;
  try { await redisClient.set(`payment:${paymentRef}`, '1', { EX: 86400 }); }
  catch (err) { logger.warn('Redis mark failed:', err.message); }
}

// Processing lock (Redis with in-memory fallback)
const inMemoryLocks = new Map();

async function acquireProcessingLock(paymentRef) {
  const lockKey = `payment:lock:${paymentRef}`;
  if (redisAvailable && redisClient) {
    try {
      const resp = await redisClient.set(lockKey, '1', { NX: true, EX: 300 });
      return resp === 'OK';
    } catch (err) {
      logger.warn('Redis acquire lock failed:', err.message);
    }
  }
  // Fallback in-memory lock (single-instance only)
  const now = Date.now();
  const existing = inMemoryLocks.get(paymentRef);
  if (existing && (now - existing) < 5 * 60 * 1000) {
    return false;
  }
  inMemoryLocks.set(paymentRef, now);
  setTimeout(() => {
    if (inMemoryLocks.get(paymentRef) === now) inMemoryLocks.delete(paymentRef);
  }, 5 * 60 * 1000);
  return true;
}

async function releaseProcessingLock(paymentRef) {
  const lockKey = `payment:lock:${paymentRef}`;
  if (redisAvailable && redisClient) {
    try { await redisClient.del(lockKey); } catch (err) { logger.warn('Redis release lock failed:', err.message); }
  }
  inMemoryLocks.delete(paymentRef);
}

/**
 * @route   GET /api/payments/poll/:reference
 * @desc    Poll Odoo/TravelMaster invoice by reference; processes payment when paid
 * @access  Public
 */
router.get(
  '/poll/:reference',
  [
    param('reference').isString().notEmpty().isLength({ max: 128 }).withMessage('Invoice reference is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Polling validation failed', { errors: errors.array() });
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const pollId = `poll-${Date.now()}`;
    const paymentRef = req.params.reference;

    // Resolve Busbud cart ID from Firestore using the Firestore cart ID / invoice reference
    let busbudCartId = null;
    try {
      const db = await getFirestore();
      const cartDoc = await db.collection('carts').doc(String(paymentRef)).get();
      if (cartDoc.exists) {
        const cartData = cartDoc.data() || {};
        busbudCartId = cartData.busbudCartId || null;
      } else {
        logger.warn(`[${pollId}] No Firestore cart found for payment reference`, { reference: paymentRef });
      }
    } catch (e) {
      logger.warn(`[${pollId}] Failed to resolve Busbud cart ID from Firestore`, { reference: paymentRef, error: e.message });
    }

    // If already processed, do not hit Odoo; return terminal state
    if (await isProcessed(paymentRef)) {
      return res.status(200).json({ success: true, status: 'already_processed' });
    }

    logger.info(`[${pollId}] Polling invoice state`, { reference: paymentRef, firestoreCartId: paymentRef, busbudCartId: busbudCartId || 'unknown' });

    // Query Odoo for invoice state
    let invoices = [];
    try {
      invoices = await travelMaster.searchByPNR(paymentRef);
    } catch (err) {
      logger.error(`[${pollId}] Odoo searchByPNR failed`, { error: err.message });
      return res.status(500).json({ success: false, message: 'Failed to query invoice', error: err.message });
    }

    if (!invoices || invoices.length === 0) {
      return res.status(200).json({ success: true, status: 'not_found', message: 'Invoice not found yet' });
    }

    const inv = invoices[0];
    const currentState = inv.payment_state || inv.state;
    const currency = Array.isArray(inv.currency_id) ? inv.currency_id[1] : 'USD';

    // If already processed, return current state without reprocessing
    if (await isProcessed(paymentRef)) {
      return res.status(200).json({ success: true, status: 'already_processed', payment_state: currentState });
    }

    try {
      switch (currentState) {
        case 'paid':
        case 'done': {
          if (!busbudCartId) {
            return res.status(400).json({ success: false, message: 'No Busbud cartId resolved for payment reference' });
          }

          // Acquire processing lock to prevent duplicate purchases
          const locked = await acquireProcessingLock(paymentRef);
          if (!locked) {
            return res.status(200).json({ success: true, status: 'payment_processing', message: 'Already processing' });
          }

          try {
            // Create purchase
            const createResult = await createPurchase(busbudCartId, {
              returnUrl: `${process.env.FRONTEND_URL || 'https://your-app.com'}/confirmation`,
              skipValidation: true,
              locale: 'en-ca',
              currency: currency || 'USD'
            });

            if (!createResult.success || !createResult.data) {
              throw new Error(`Failed to create purchase: ${createResult.error || 'Unknown error'}`);
            }

            const purchaseId = createResult.data.id;
            const purchaseUuid = createResult.data.uuid || createResult.data.purchase_uuid;

            // Complete purchase (also persists full Busbud purchase into Firestore 'tickets' collection)
            const completeResult = await completePurchase(purchaseId, purchaseUuid, pollId, Date.now(), {
              paymentRef,
              cartId: busbudCartId,
              firestoreCartId: paymentRef,
            });
            if (!completeResult.success) {
              throw new Error(`Failed to complete purchase: ${completeResult.error || 'Unknown error'}`);
            }

            const normalizedStatus = (completeResult.status || (completeResult.purchase && completeResult.purchase.status) || '').toString().toLowerCase();
            const isCompletedPurchase =
              // Primary signal: polling outcome from Busbud status API
              completeResult.pollOutcome === 'completed' ||
              // Fallback: completed-like status on the detailed purchase payload
              normalizedStatus === 'completed' ||
              normalizedStatus === 'booked' ||
              normalizedStatus === 'confirmed';

            // Attempt booking status update (best-effort)
            try {
              await travelMaster.updateBookingStatus(busbudCartId, {
                status: 'confirmed',
                purchaseId,
                purchaseUuid,
                invoiceReference: paymentRef,
                confirmedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                metadata: {
                  pollId,
                  processedAt: new Date().toISOString(),
                  purchaseStatus: completeResult.status || 'confirmed'
                }
              });
            } catch (e) {
              logger.warn(`[${pollId}] updateBookingStatus failed`, { error: e.message });
            }

            try {
              const __base = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
              if (isCompletedPurchase) {
                await axios.post(`${__base}/api/ticket/eticket/send`, {
                  pnr: paymentRef,
                  cartId: busbudCartId,
                  purchaseId,
                  purchaseUuid
                });
                logger.info(`[${pollId}] Triggered e-ticket email via ticket route`, { reference: paymentRef, cartId: busbudCartId });
              } else {
                await axios.post(`${__base}/api/ticket/failed/send`, {
                  pnr: paymentRef,
                  cartId: busbudCartId,
                  purchaseId,
                  purchaseUuid,
                  purchaseStatus: completeResult.status || (completeResult.purchase && completeResult.purchase.status) || null,
                  pollOutcome: completeResult.pollOutcome || null
                });
                logger.info(`[${pollId}] Triggered failed-ticket notification via ticket route`, {
                  reference: paymentRef,
                  cartId: busbudCartId,
                  pollOutcome: completeResult.pollOutcome || null,
                  status: normalizedStatus
                });
              }
            } catch (e) {
              logger.warn(`[${pollId}] Failed to trigger ${isCompletedPurchase ? 'e-ticket' : 'failed-ticket'} email via ticket route`, { error: e.message });
            }

            try {
              await incrementTicketCounters(paymentRef);
            } catch (e) {
              logger.warn(`[${pollId}] incrementTicketCounters failed`, { error: e.message });
            }
            await markProcessed(paymentRef);
            return res.status(200).json({ success: true, status: 'confirmed', purchaseId, purchaseUuid });
          } finally {
            await releaseProcessingLock(paymentRef);
          }
        }

        case 'in_payment':
        case 'pending': {
          if (busbudCartId) {
            try {
              await travelMaster.updateBookingStatus(busbudCartId, { status: 'payment_processing', updatedAt: new Date().toISOString() });
            } catch (e) {
              logger.warn(`[${pollId}] updateBookingStatus(payment_processing) failed`, { error: e.message });
            }
          }
          return res.status(200).json({ success: true, status: 'payment_processing' });
        }

        case 'cancel':
        case 'cancelled': {
          if (busbudCartId) {
            try {
              await travelMaster.updateBookingStatus(busbudCartId, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancellationReason: 'Payment cancelled' });
            } catch (e) {
              logger.warn(`[${pollId}] updateBookingStatus(cancelled) failed`, { error: e.message });
            }
          }
          await markProcessed(paymentRef);
          return res.status(200).json({ success: true, status: 'cancelled' });
        }

        case 'failed':
        case 'reversed': {
          if (busbudCartId) {
            try {
              await travelMaster.updateBookingStatus(busbudCartId, { status: 'payment_failed', failedAt: new Date().toISOString(), failureReason: `Payment failed: ${currentState}` });
            } catch (e) {
              logger.warn(`[${pollId}] updateBookingStatus(payment_failed) failed`, { error: e.message });
            }
          }
          await markProcessed(paymentRef);
          return res.status(200).json({ success: true, status: 'payment_failed' });
        }

        default:
          logger.info(`[${pollId}] Unhandled payment state`, { payment_state: currentState, reference: paymentRef });
          return res.status(200).json({ success: true, status: currentState || 'unknown' });
      }
    } catch (error) {
      logger.error(`[${pollId}] Poll processing error`, { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, message: 'Failed to process poll', error: error.message });
    }
  })
);

export default router;
