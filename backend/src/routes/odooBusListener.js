import xmlrpc from 'xmlrpc';
import { createClient } from 'redis';
import { logger } from '../utils/logger.js';
import { createPurchase, completePurchase } from './purchase.js';
import { TravelMasterAPI } from '../integrations/odoo/travelMasterPayment.service.js';
import { getFirestore } from '../config/firebase.config.mjs';
import { incrementTicketCounters } from '../utils/ticketCounters.js';
import { sendPaymentWebhook } from '../utils/paymentWebhook.js';

const DB = process.env.TRAVELMASTER_DB;
const USER = process.env.TRAVELMASTER_USERNAME;
const API_KEY = process.env.TRAVELMASTER_API_KEY;

// New constants for long-polling and error recovery
const RECONNECT_DELAY_MS = 10000;      // 10 seconds delay before restarting on hard failure
const INVOICE_POLL_INTERVAL_MS = parseInt(process.env.ODOO_INVOICE_POLL_INTERVAL || '15000', 10);
const INVOICE_POLL_LOOKBACK_MS = parseInt(process.env.ODOO_INVOICE_POLL_LOOKBACK_MS || '300000', 10);
const INVOICE_ACTIVE_EXPIRY_MS = parseInt(process.env.ODOO_INVOICE_ACTIVE_EXPIRY_MS || '900000', 10);

// Redis client (optional)
let redisClient = null;
let redisAvailable = false;
if (process.env.REDIS_URL) {
  redisClient = createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => {
    logger.error('🔴 Redis error:', err);
    redisAvailable = false;
  });
  redisClient.on('connect', () => {
    logger.info('✅ Redis connected');
    redisAvailable = true;
  });
  (async () => {
    try {
      await redisClient.connect();
    } catch (err) {
      logger.warn('⚠️ Redis connect failed:', err.message);
      redisAvailable = false;
    }
  })();
} else {
  logger.warn('⚠️ REDIS_URL not provided, running without Redis');
}

// TravelMaster API
const travelMaster = new TravelMasterAPI({
  url: process.env.TRAVELMASTER_URL,
  db: DB,
  username: USER,
  password: API_KEY
});

// XML-RPC clients
const commonClient = xmlrpc.createClient({ url: `${process.env.TRAVELMASTER_URL}/xmlrpc/2/common` });
const objectClient = xmlrpc.createClient({ url: `${process.env.TRAVELMASTER_URL}/xmlrpc/2/object` });

// Store authenticated user info
let uid = null;
// Cache for invoice states to detect changes
const invoiceStateCache = new Map();
let lastInvoicePollAt = 0;
const activeInvoices = new Map();

// Promisify XML-RPC calls
function xmlrpcCall(client, method, params) {
  logger.debug(`🛜 XML-RPC call - method: ${method}, params:`, params);
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, res) => {
      if (err) {
        logger.error(`❌ XML-RPC call failed - method: ${method}`, err.message);
        reject(err);
      } else {
        logger.debug(`✅ XML-RPC call success - method: ${method}, result:`, res);
        resolve(res);
      }
    });
  });
}

// Login via XML-RPC
export async function login() {
  try {
    logger.info('🔐 Authenticating with Odoo via XML-RPC...');
    // The XML-RPC library's error message will be checked for authentication issues later.
    const newUid = await xmlrpcCall(commonClient, 'authenticate', [DB, USER, API_KEY, {}]);
    if (!newUid) {
      throw new Error('No UID returned from Odoo XML-RPC');
    }
    uid = newUid; // Update the global UID on success
    logger.info('✅ Successfully authenticated via XML-RPC, UID:', uid);
    return uid;
  } catch (err) {
    logger.error('❌ XML-RPC authentication failed:', err.message);
    throw err;
  }
}

// Utilities and helpers
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

let firestoreDb = null;
async function getDb() {
  if (firestoreDb) return firestoreDb;
  try {
    firestoreDb = await getFirestore();
    return firestoreDb;
  } catch (err) {
    logger.warn('⚠️ Firestore not available for cart resolution:', err.message);
    return null;
  }
}

async function resolveCartIdFromReference(reference) {
  try {
    const db = await getDb();
    if (!db) return null;
    const doc = await db.collection('carts').doc(reference).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return data?.busbudCartId || data?.cartId || data?.cart_id || null;
  } catch (err) {
    logger.warn('⚠️ Failed to resolve cartId from Firestore:', err.message);
    return null;
  }
}

function formatOdooDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Redis helpers
async function isProcessed(paymentRef) {
  logger.debug(`🔍 Checking if paymentRef "${paymentRef}" is processed...`);
  if (!redisAvailable || !redisClient) {
    logger.debug('ℹ️ Redis not available, skipping duplicate check');
    return false;
  }

  try {
    const status = await redisClient.get(`payment:${paymentRef}`);
    logger.debug(`ℹ️ Redis status for paymentRef "${paymentRef}":`, status);
    return status === '1';
  } catch (err) {
    logger.warn('⚠️ Redis check failed:', err.message);
    return false;
  }
}

async function markProcessed(paymentRef) {
  logger.debug(`📝 Marking paymentRef "${paymentRef}" as processed in Redis...`);
  if (!redisAvailable || !redisClient) return;

  try {
    // Set key to expire in 24 hours (86400 seconds)
    await redisClient.set(`payment:${paymentRef}`, '1', { EX: 86400 }); 
  } catch (err) {
    logger.warn('⚠️ Redis mark failed:', err.message);
  }
}

// Handle payment notification
async function handlePayment(data) {
  const webhookId = `bus-${Date.now()}-${data.reference || 'unknown'}`;
  // Resolve cartId from metadata or Firestore using the reference
  let cartId = data.metadata?.cartId || null; 
  if (!cartId && data.reference) {
    try {
      const resolved = await resolveCartIdFromReference(data.reference);
      cartId = resolved || data.reference;
    } catch (e) {
      logger.warn(`[${webhookId}] Failed to resolve cartId from Firestore: ${e.message}`);
      cartId = data.reference;
    }
  }

  logger.info(`[${webhookId}] 📨 Payment event received from Odoo bus`);
  logger.debug(`[${webhookId}] Raw data:`, data);

  // Use data.tx_id as a better deduplication key if available, 
  // although paymentRef logic above is used for consistency with existing code
  const paymentRef = data.reference || data.tx_id; 
  if (paymentRef && await isProcessed(paymentRef)) {
    logger.info(`[${webhookId}] ⛔ Payment ${paymentRef} already processed. Skipping.`);
    return;
  }

  if (!cartId) {
    logger.warn(`[${webhookId}] ⚠️ No cartId found in payment data`);
    return;
  }

  // Normalize payment state (Odoo can use various states like 'done', 'authorized', etc.)
  const paymentState = data.payment_state || data.state; 

  switch (paymentState) {
    case 'paid':
    case 'done': {
      logger.info(`[${webhookId}] 💰 Payment confirmed. Beginning purchase creation...`);
      const createResult = await createPurchase(cartId, {
        returnUrl: `${process.env.FRONTEND_URL || 'https://your-app.com'}/confirmation`,
        skipValidation: true,
        locale: 'en-ca',
        currency: data.currency || 'USD'
      });

      if (!createResult.success || !createResult.data) {
        logger.error(`[${webhookId}] ❌ Failed to create purchase`, createResult.error);
        return;
      }

      const { id: purchaseId, uuid: purchaseUuid, purchase_uuid } = createResult.data;
      const finalUuid = purchaseUuid || purchase_uuid;

      logger.info(`[${webhookId}] ✅ Purchase created successfully:`, { purchaseId, finalUuid });

      const completeResult = await completePurchase(purchaseId, finalUuid, webhookId, Date.now(), {
        paymentRef,
        cartId,
      });
      if (!completeResult.success) {
        logger.error(`[${webhookId}] ❌ Failed to complete purchase`, completeResult.error);
        return;
      }

      logger.info(`[${webhookId}] ✅ Purchase completed successfully`, { purchaseId, ...completeResult });

      try {
        await travelMaster.updateBookingStatus(cartId, {
          status: 'confirmed',
          purchaseId,
          purchaseUuid: finalUuid,
          invoiceReference: data.reference,
          confirmedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metadata: { webhookId, processedAt: new Date().toISOString() }
        });
        logger.info(`[${webhookId}] ✅ TravelMaster booking updated successfully`);
      } catch (err) {
        logger.error(`[${webhookId}] ❌ Failed to update TravelMaster booking`, err.message);
      }

      // Increment counters and mark processed only on success
      try {
        if (paymentRef) {
          await incrementTicketCounters(paymentRef);
        }
      } catch (err) {
        logger.warn(`[${webhookId}] ⚠️ incrementTicketCounters failed: ${err.message}`);
      }

      if (paymentRef) {
        await markProcessed(paymentRef);
        try {
          await sendPaymentWebhook({
            event: 'payment.confirmed',
            status: 'confirmed',
            pnr: data.reference || paymentRef,
            payment_reference: data.reference || paymentRef,
            firestoreCartId: data.reference,
            cartId,
            purchaseId,
            purchaseUuid: finalUuid,
            amount: data.amount_total || data.amount,
            currency: data.currency || 'USD',
            confirmedAt: new Date().toISOString(),
            metadata: {
              webhookId,
              source: 'odoo.bus'
            }
          });
        } catch (e) {
          logger.warn(`[${webhookId}] sendPaymentWebhook failed`, { error: e.message });
        }
      }
      break;
    }

    case 'in_payment':
    case 'pending':
      logger.info(`[${webhookId}] ⏳ Payment still in process`);
      await travelMaster.updateBookingStatus(cartId, {
        status: 'payment_processing',
        updatedAt: new Date().toISOString()
      });
      break;

    case 'cancel':
    case 'cancelled':
      logger.warn(`[${webhookId}] ❌ Payment cancelled`);
      await travelMaster.updateBookingStatus(cartId, {
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        cancellationReason: 'Payment cancelled by user or gateway'
      });
      break;

    case 'failed':
    case 'reversed':
      logger.error(`[${webhookId}] ❌ Payment failed or reversed`);
      await travelMaster.updateBookingStatus(cartId, {
        status: 'payment_failed',
        failedAt: new Date().toISOString(),
        failureReason: `Payment failed: ${paymentState}`
      });
      break;

    default:
      logger.info(`[${webhookId}] ℹ️ Unhandled payment state: ${paymentState}`);
  }
}

// Periodic polling for invoice state changes (fallback/augmentation to bus)
async function pollInvoiceStatesLoop() {
  if (!uid) {
    logger.error('❌ Invoice polling cannot start before successful authentication.');
    return;
  }

  logger.info('🔁 Starting Odoo invoice state polling loop...');
  while (true) {
    try {
      const now = Date.now();
      const sinceTs = lastInvoicePollAt ? Math.max(lastInvoicePollAt, now - INVOICE_POLL_LOOKBACK_MS) : now - INVOICE_POLL_LOOKBACK_MS;
      const sinceStr = formatOdooDateTime(new Date(sinceTs));

      const domain = [
        ['move_type', '=', 'out_invoice'],
        ['payment_reference', '!=', false],
        ['write_date', '>=', sinceStr]
      ];

      const fields = ['id', 'payment_reference', 'payment_state', 'state', 'currency_id', 'write_date', 'name'];

      const invoices = await xmlrpcCall(objectClient, 'execute_kw', [
        DB, uid, API_KEY,
        'account.move', 'search_read',
        [domain],
        { fields, order: 'write_date asc', limit: 200 }
      ]);

      if (Array.isArray(invoices) && invoices.length) {
        logger.debug(`🧾 Polled ${invoices.length} invoice(s) updated since ${sinceStr}`);
        for (const inv of invoices) {
          const ref = inv.payment_reference || String(inv.id);
          if (ref && !activeInvoices.has(ref)) {
            activeInvoices.set(ref, { addedAt: Date.now() });
          }
          const prev = invoiceStateCache.get(ref);
          const currentFingerprint = `${inv.state}|${inv.payment_state}|${inv.write_date}`;
          if (prev === currentFingerprint) continue;

          const state = inv.payment_state || inv.state;
          if (!state) {
            invoiceStateCache.set(ref, currentFingerprint);
            continue;
          }

          const payload = {
            reference: inv.payment_reference,
            payment_state: inv.payment_state || inv.state,
            state: inv.state,
            currency: Array.isArray(inv.currency_id) ? inv.currency_id[1] : undefined,
            metadata: { cartId: await resolveCartIdFromReference(inv.payment_reference) }
          };

          if (['paid', 'in_payment', 'pending', 'cancel', 'cancelled', 'failed', 'reversed', 'done'].includes(payload.payment_state)) {
            await handlePayment(payload);
          } else if (payload.state === 'cancel') {
            await handlePayment({ ...payload, payment_state: 'cancel' });
          }

          invoiceStateCache.set(ref, currentFingerprint);
        }
      }

      const refs = Array.from(activeInvoices.keys());
      if (refs.length) {
        const batchSize = 50;
        for (let i = 0; i < refs.length; i += batchSize) {
          const batch = refs.slice(i, i + batchSize);
          const batchDomain = [
            ['move_type', '=', 'out_invoice'],
            ['payment_reference', 'in', batch]
          ];
          const batchFields = ['id', 'payment_reference', 'payment_state', 'state', 'currency_id', 'write_date', 'name'];
          const batchInvoices = await xmlrpcCall(objectClient, 'execute_kw', [
            DB, uid, API_KEY,
            'account.move', 'search_read',
            [batchDomain],
            { fields: batchFields }
          ]);

          if (Array.isArray(batchInvoices) && batchInvoices.length) {
            for (const inv of batchInvoices) {
              const ref = inv.payment_reference || String(inv.id);
              const state = inv.payment_state || inv.state;
              const payload = {
                reference: inv.payment_reference,
                payment_state: inv.payment_state || inv.state,
                state: inv.state,
                currency: Array.isArray(inv.currency_id) ? inv.currency_id[1] : undefined,
                metadata: { cartId: await resolveCartIdFromReference(inv.payment_reference) }
              };
              if (['paid', 'in_payment', 'pending', 'cancel', 'cancelled', 'failed', 'reversed', 'done'].includes(payload.payment_state)) {
                await handlePayment(payload);
              } else if (payload.state === 'cancel') {
                await handlePayment({ ...payload, payment_state: 'cancel' });
              }
              if (['paid', 'done', 'cancel', 'cancelled', 'failed', 'reversed'].includes(String(state))) {
                activeInvoices.delete(ref);
              }
            }
          }
        }
      }

      const nowTs = Date.now();
      for (const [ref, meta] of Array.from(activeInvoices.entries())) {
        if (nowTs - (meta?.addedAt || nowTs) >= INVOICE_ACTIVE_EXPIRY_MS) {
          const cartId = await resolveCartIdFromReference(ref);
          await handlePayment({ reference: ref, payment_state: 'cancelled', state: 'cancelled', metadata: { cartId } });
          await markProcessed(ref);
          activeInvoices.delete(ref);
        }
      }

      lastInvoicePollAt = now;
      await delay(INVOICE_POLL_INTERVAL_MS);
    } catch (err) {
      logger.warn(`⚠️ Invoice polling error: ${err.message}. Retrying in ${INVOICE_POLL_INTERVAL_MS}ms`);
      await delay(INVOICE_POLL_INTERVAL_MS);
    }
  }
}

// Start listener
export async function startOdooBusListener() {
  try {
    logger.info('🚀 Starting Odoo Bus Listener...');
    // Ensure initial login before starting the poll loop
    await login();
    logger.info('✅ Odoo Bus Listener authenticated successfully');
    
    // Start the invoice polling loop
    pollInvoiceStatesLoop().catch((err) => {
      logger.error('❌ Odoo invoice polling loop crashed:', err.message);
    });
  } catch (err) {
    logger.error('❌ Critical failure in Odoo Bus Listener, attempting restart:', err.message);
    
    // Wait and then recursively call the function to attempt a restart, including re-login
    setTimeout(() => startOdooBusListener(), RECONNECT_DELAY_MS);
    return false; // Indicate that the initial attempt failed
  }
  return true; // Indicate that the initial attempt to start the listener has begun successfully
}