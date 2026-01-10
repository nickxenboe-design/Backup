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
import { sendPaymentWebhook } from '../utils/paymentWebhook.js';
import { requireAgentApi } from '../middleware/agentAuth.js';
import { getPricingSettings } from '../config/runtimeSettings.js';
import drizzleDb, { payments as paymentsTable, carts as cartsPgTable } from '../db/drizzleClient.js';
import { eq, and, inArray, sql, or, desc } from 'drizzle-orm';

const router = express.Router();

const usePostgresFirstForEticket = true;

const looksLikeBusbudCartId = (value) => {
  try {
    const s = String(value || '').trim();
    if (!s) return false;
    return !/^\d+$/.test(s);
  } catch (_) {
    return false;
  }
};

const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

const inferBusbudFailureStage = (errorMessage) => {
  const msg = String(errorMessage || '').toLowerCase();
  if (!msg) return 'unknown';
  if (msg.includes('failed to create purchase')) return 'purchase_creation';
  if (msg.includes('failed to complete purchase')) return 'purchase_completion';
  if (msg.includes('purchase did not complete')) return 'purchase_completion';
  return 'unknown';
};

const buildAgentGuidanceForFailure = ({ code, reference, errorMessage }) => {
  const stage = inferBusbudFailureStage(errorMessage);
  const ref = String(reference || '').trim();

  if (code === 'CART_NOT_FOUND') {
    return {
      agentMessage:
        'We could not find this booking reference in the system, so we cannot issue the ticket yet.',
      nextSteps: [
        'Double-check that you entered the correct PNR/reference.',
        'If the booking was just created, wait 1–2 minutes and try again.',
        `If it still fails, contact support and provide the reference${ref ? `: ${ref}` : ''}.`
      ]
    };
  }

  if (stage === 'purchase_creation') {
    return {
      agentMessage:
        'The system could not start the booking with the ticket provider, so the final ticket was not issued.',
      nextSteps: [
        'Wait a moment and try confirming again.',
        'If it keeps failing, ask the customer to wait and contact support.',
        `Provide the reference${ref ? `: ${ref}` : ''} to support.`
      ]
    };
  }

  if (stage === 'purchase_completion') {
    return {
      agentMessage:
        'The system could not finish confirming the booking with the ticket provider, so the final ticket was not issued.',
      nextSteps: [
        'Wait 2–5 minutes and try confirming again (sometimes the provider is delayed).',
        'Do not hand over a final ticket until you can download the e-ticket PDF and the booking shows as confirmed.',
        `If it still fails, contact support and provide the reference${ref ? `: ${ref}` : ''}.`
      ]
    };
  }

  return {
    agentMessage: 'The booking could not be confirmed right now, so the final ticket was not issued.',
    nextSteps: [
      'Wait a moment and try again.',
      `If it still fails, contact support and provide the reference${ref ? `: ${ref}` : ''}.`
    ]
  };
};

const markBookingFailedEverywhere = async ({ reference, busbudCartId, reason, meta = {} }) => {
  const ref = String(reference || '').trim();
  const cartId = busbudCartId != null ? String(busbudCartId).trim() : '';
  const failureReason = String(reason || '').trim();

  try {
    await ensureCartsColumnsExist();
    const clauses = [];
    if (ref) {
      clauses.push(eq(cartsPgTable.firestoreCartId, ref));
      clauses.push(eq(cartsPgTable.cartId, ref));
    }
    if (cartId) {
      clauses.push(eq(cartsPgTable.cartId, cartId));
      clauses.push(eq(cartsPgTable.firestoreCartId, cartId));
    }

    if (!clauses.length) return;

    const whereClause = or(...clauses);

    await drizzleDb
      .update(cartsPgTable)
      .set({
        ...(ref ? { firestoreCartId: ref } : {}),
        status: 'failed',
        updatedAt: new Date(),
      })
      .where(whereClause);
  } catch (_) {
  }

  try {
    const db = await getFirestore();
    const patch = {
      status: 'failed',
      failed: true,
      failureReason: failureReason || undefined,
      failureAt: new Date().toISOString(),
      firestoreCartId: ref || undefined,
      cartId: cartId || undefined,
      updatedAt: new Date().toISOString(),
      failureMeta: meta && typeof meta === 'object' ? meta : undefined,
    };

    if (ref) await db.collection('carts').doc(ref).set(patch, { merge: true });
    if (cartId) await db.collection('carts').doc(cartId).set(patch, { merge: true });

    try {
      if (ref) {
        const byFs = await db.collection('carts').where('firestoreCartId', '==', ref).limit(20).get();
        for (const d of (byFs && byFs.docs ? byFs.docs : [])) {
          await d.ref.set(patch, { merge: true });
        }
      }
    } catch (_) {
    }

    try {
      if (cartId) {
        const byCartId = await db.collection('carts').where('cartId', '==', cartId).limit(20).get();
        for (const d of (byCartId && byCartId.docs ? byCartId.docs : [])) {
          await d.ref.set(patch, { merge: true });
        }
      }
    } catch (_) {
    }
  } catch (_) {
  }

  try {
    if (cartId) {
      await travelMaster.updateBookingStatus(cartId, {
        status: 'failed',
        invoiceReference: ref || undefined,
        failedAt: new Date().toISOString(),
        failureReason: failureReason || undefined,
        updatedAt: new Date().toISOString(),
        metadata: { ...(meta && typeof meta === 'object' ? meta : {}), source: 'payments' }
      });
    }
  } catch (_) {
  }
};

let paymentsColumnsEnsured = false;
const ensurePaymentsColumnsExist = async () => {
  if (paymentsColumnsEnsured) return;
  try {
    await drizzleDb.execute(sql`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "cost_price" numeric(10, 2);`);
    await drizzleDb.execute(sql`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "discount" numeric(10, 2);`);
    await drizzleDb.execute(sql`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "markup" numeric(10, 2);`);
    await drizzleDb.execute(sql`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "charges" numeric(10, 2);`);
    await drizzleDb.execute(sql`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);`);
    await drizzleDb.execute(sql`ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "round_diff" numeric(10, 2);`);
  } catch (_) {
  } finally {
    paymentsColumnsEnsured = true;
  }
};

let cartsColumnsEnsured = false;
const ensureCartsColumnsExist = async () => {
  if (cartsColumnsEnsured) return;
  try {
    await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "booked_by" text;`);
    await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_id" text;`);
    await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_uuid" text;`);
    await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "purchase_updated_at" timestamp with time zone;`);
    await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "round_diff" numeric(10, 2);`);
    await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "commission" numeric(10, 2);`);
  } catch (_) {
  } finally {
    cartsColumnsEnsured = true;
  }
};

const loadPricingFromCartsTable = async ({ firestoreCartId, cartId }) => {
  try {
    await ensureCartsColumnsExist();
    const candidates = [firestoreCartId, cartId].filter(v => v != null && String(v).trim());
    if (!candidates.length) return null;
    const rows = await drizzleDb
      .select({
        costPrice: cartsPgTable.costPrice,
        discount: cartsPgTable.discount,
        markup: cartsPgTable.markup,
        charges: cartsPgTable.charges,
        commission: cartsPgTable.commission,
        roundDiff: cartsPgTable.roundDiff
      })
      .from(cartsPgTable)
      .where(
        candidates.length > 1
          ? or(eq(cartsPgTable.firestoreCartId, String(candidates[0])), eq(cartsPgTable.cartId, String(candidates[1])))
          : or(eq(cartsPgTable.firestoreCartId, String(candidates[0])), eq(cartsPgTable.cartId, String(candidates[0])))
      )
      .limit(1);
    return rows && rows.length ? (rows[0] || null) : null;
  } catch (_) {
    return null;
  }
};

const normalizeEmailLocal = (value) => String(value || '').trim().toLowerCase();

const normalizeIdLocal = (value) => String(value || '').trim().toLowerCase();

const extractEmailFromText = (value) => {
  try {
    const s = String(value || '').trim().toLowerCase();
    if (!s) return '';
    const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return m ? String(m[0] || '').trim().toLowerCase() : '';
  } catch (_) {
    return '';
  }
};

const buildAgentNameLower = (req) => {
  try {
    const hdrName = (req.get && req.get('x-agent-name')) || (req.headers && req.headers['x-agent-name']) || '';
    const name = String(hdrName || '').trim();
    return name ? name.toLowerCase() : '';
  } catch (_) {
    return '';
  }
};

const computeAllowedInvoiceRefsForAgent = async (req, refs, options = {}) => {
  const allowOnline = options && Object.prototype.hasOwnProperty.call(options, 'allowOnline')
    ? Boolean(options.allowOnline)
    : true;

  const allowed = new Set();
  const normalizedAgentEmail = normalizeEmailLocal(req.agentEmail || (req.user && req.user.email) || '');
  const normalizedAgentId = normalizeIdLocal(
    req.agentId ||
      ((req.get && req.get('x-agent-id')) || (req.headers && req.headers['x-agent-id'])) ||
      ''
  );
  const agentNameLower = buildAgentNameLower(req);

  logger.info('computeAllowedInvoiceRefsForAgent', {
    refs: refs.slice(0, 10),
    normalizedAgentEmail,
    normalizedAgentId,
    agentNameLower,
    allowOnline
  });

  const pending = new Set((refs || []).map((r) => String(r || '').trim()).filter(Boolean));
  if (!pending.size) return allowed;

  try {
    const rows = await drizzleDb
      .select({
        transactionRef: paymentsTable.transactionRef,
        bookedBy: paymentsTable.bookedBy,
      })
      .from(paymentsTable)
      .where(inArray(paymentsTable.transactionRef, Array.from(pending)));

    logger.info('Payments query results', { rows: rows.map(r => ({ ref: r.transactionRef, bookedBy: r.bookedBy })) });

    for (const r of rows || []) {
      const ref = String(r.transactionRef || '').trim();
      if (!ref) continue;
      const bookedByRaw = r.bookedBy || '';
      const bookedByNorm = normalizeEmailLocal(bookedByRaw);
      const bookedByEmail = extractEmailFromText(bookedByRaw);
      const bookedById = normalizeIdLocal(bookedByRaw);

      if ((bookedByEmail || bookedByNorm) && normalizedAgentEmail && (bookedByEmail === normalizedAgentEmail || bookedByNorm === normalizedAgentEmail)) {
        allowed.add(ref);
        pending.delete(ref);
        logger.info(`Allowed ref ${ref} via payments email match`);
        continue;
      }

      if (bookedById && normalizedAgentId && bookedById === normalizedAgentId) {
        allowed.add(ref);
        pending.delete(ref);
        logger.info(`Allowed ref ${ref} via payments agentId match`);
        continue;
      }

      if (bookedByNorm && agentNameLower && bookedByNorm === agentNameLower) {
        allowed.add(ref);
        pending.delete(ref);
        logger.info(`Allowed ref ${ref} via payments name match`);
        continue;
      }

      if (allowOnline && bookedByNorm === 'online') {
        allowed.add(ref);
        pending.delete(ref);
        logger.info(`Allowed ref ${ref} via payments online`);
        continue;
      }
    }
  } catch (e) {
    logger.warn('Payments query failed', { error: e.message });
  }

  if (!pending.size) return allowed;

  // Fallback: check Postgres carts.booked_by (if carts were mirrored without a payment record)
  try {
    await ensureCartsColumnsExist();
    const pendingArr = Array.from(pending);
    const cartRows = await drizzleDb
      .select({
        cartId: cartsPgTable.cartId,
        firestoreCartId: cartsPgTable.firestoreCartId,
        bookedBy: cartsPgTable.bookedBy,
      })
      .from(cartsPgTable)
      .where(or(inArray(cartsPgTable.cartId, pendingArr), inArray(cartsPgTable.firestoreCartId, pendingArr)));

    logger.info('Carts query results', { rows: cartRows.map(r => ({ cartId: r.cartId, firestoreCartId: r.firestoreCartId, bookedBy: r.bookedBy })) });

    for (const r of cartRows || []) {
      const bookedByRaw = r.bookedBy || '';
      const bookedByNorm = normalizeEmailLocal(bookedByRaw);
      const bookedByEmail = extractEmailFromText(bookedByRaw);
      const bookedById = normalizeIdLocal(bookedByRaw);
      const matchesAgentEmail = (bookedByEmail || bookedByNorm) && normalizedAgentEmail && (bookedByEmail === normalizedAgentEmail || bookedByNorm === normalizedAgentEmail);
      const matchesAgentName = bookedByNorm && agentNameLower && bookedByNorm === agentNameLower;
      const matchesAgentId = bookedById && normalizedAgentId && bookedById === normalizedAgentId;
      const matchesOnline = allowOnline && bookedByNorm === 'online';

      if (!matchesAgentEmail && !matchesAgentName && !matchesAgentId && !matchesOnline) continue;

      const candidates = [r.cartId, r.firestoreCartId]
        .map((v) => String(v || '').trim())
        .filter(Boolean);
      for (const ref of candidates) {
        if (pending.has(ref)) {
          allowed.add(ref);
          pending.delete(ref);
          logger.info(`Allowed ref ${ref} via carts match (${matchesAgentEmail ? 'email' : matchesAgentId ? 'agentId' : matchesAgentName ? 'name' : 'online'})`);
        }
      }
      if (!pending.size) break;
    }
  } catch (e) {
    logger.warn('Carts query failed', { error: e.message });
  }

  if (!pending.size) return allowed;

  try {
    const db = await getFirestore();
    const checks = await Promise.all(
      Array.from(pending).map(async (ref) => {
        try {
          const snap = await db.collection('carts').doc(String(ref)).get();
          if (!snap.exists) {
            logger.info(`No Firestore cart for ref ${ref}`);
            return { ref, allowed: false };
          }
          const cart = snap.data() || {};
          const rawMode = cart.agentMode;
          const cartAgentMode = rawMode === true || String(rawMode).toLowerCase() === 'true';
          const cartAgentEmail = normalizeEmailLocal(cart.agentEmail || (cart.agent && cart.agent.agentEmail) || '');
          const cartAgentId = normalizeIdLocal(cart.agentId || (cart.agent && cart.agent.agentId) || '');
          const cartAgentNameLower = String(cart.agentName || (cart.agent && cart.agent.agentName) || '').trim().toLowerCase();

          logger.info(`Firestore cart for ref ${ref}`, { cartAgentEmail, cartAgentId, cartAgentNameLower, cartAgentMode });

          if (cartAgentEmail) {
            if (normalizedAgentEmail && cartAgentEmail === normalizedAgentEmail) {
              logger.info(`Allowed ref ${ref} via Firestore email match`);
              return { ref, allowed: true };
            }
            return { ref, allowed: false };
          }

          if (cartAgentId) {
            if (normalizedAgentId && cartAgentId === normalizedAgentId) {
              logger.info(`Allowed ref ${ref} via Firestore agentId match`);
              return { ref, allowed: true };
            }
            return { ref, allowed: false };
          }

          if (cartAgentNameLower) {
            if (agentNameLower && cartAgentNameLower === agentNameLower) {
              logger.info(`Allowed ref ${ref} via Firestore name match`);
              return { ref, allowed: true };
            }
            if (cartAgentMode) return { ref, allowed: false };
          }

          if (cartAgentMode) return { ref, allowed: false };
          if (allowOnline) {
            logger.info(`Allowed ref ${ref} via Firestore online`);
            return { ref, allowed: true };
          }
          return { ref, allowed: false };
        } catch (e) {
          logger.warn(`Firestore check failed for ref ${ref}`, { error: e.message });
          return { ref, allowed: false };
        }
      })
    );

    for (const c of checks) {
      if (c && c.allowed) allowed.add(c.ref);
    }
  } catch (e) {
    logger.warn('Firestore query failed', { error: e.message });
  }

  logger.info('Final allowed refs', { allowed: Array.from(allowed) });

  return allowed;
};

// Agent headers are managed by the frontend; backend does not enrich agent context here.

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

// Redis helpers with in-memory fallback for processed flags
const inMemoryProcessed = new Set();
async function isProcessed(paymentRef) {
  if (redisAvailable && redisClient) {
    try { return (await redisClient.get(`payment:${paymentRef}`)) === '1'; }
    catch (err) { logger.warn('Redis check failed:', err.message); }
  }
  return inMemoryProcessed.has(paymentRef);
}

async function markProcessed(paymentRef) {
  if (redisAvailable && redisClient) {
    try { await redisClient.set(`payment:${paymentRef}`, '1', { EX: 86400 }); }
    catch (err) { logger.warn('Redis mark failed:', err.message); }
  }
  inMemoryProcessed.add(paymentRef);
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

    // Early stop: if this PNR is already paid, do not poll Odoo
    try {
      const terminal = await drizzleDb
        .select({ status: paymentsTable.status })
        .from(paymentsTable)
        .where(
          and(
            eq(paymentsTable.transactionRef, paymentRef),
            inArray(paymentsTable.status, ['paid'])
          )
        )
        .limit(1);
      if (Array.isArray(terminal) && terminal.length) {
        return res.status(200).json({ success: true, status: 'already_processed' });
      }
    } catch (e) {
      logger.warn(`[${pollId}] DB check for processed invoice failed`, { error: e.message });
    }

    // Resolve Busbud cart ID from Firestore using the Firestore cart ID / invoice reference
    let busbudCartId = null;
    try {
      const ref = String(paymentRef);
      const goodRows = await drizzleDb
        .select({ cartId: cartsPgTable.cartId })
        .from(cartsPgTable)
        .where(and(eq(cartsPgTable.firestoreCartId, ref), sql`${cartsPgTable.cartId} !~ '^\\d+$'`))
        .orderBy(desc(cartsPgTable.updatedAt))
        .limit(1);
      let candidate = goodRows && goodRows.length ? (goodRows[0]?.cartId || null) : null;
      if (!candidate) {
        const anyRows = await drizzleDb
          .select({ cartId: cartsPgTable.cartId })
          .from(cartsPgTable)
          .where(eq(cartsPgTable.firestoreCartId, ref))
          .orderBy(desc(cartsPgTable.updatedAt))
          .limit(1);
        candidate = anyRows && anyRows.length ? (anyRows[0]?.cartId || null) : null;
      }
      if (candidate && /^\d+$/.test(String(candidate).trim())) {
        candidate = null;
      }
      busbudCartId = candidate;
    } catch (e) {
      logger.warn(`[${pollId}] Failed to resolve Busbud cart ID from Postgres`, { reference: paymentRef, error: e.message });
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
    const clientBranch = (req.clientBranch || 'unknown');

    // If already processed, return current state without reprocessing
    if (await isProcessed(paymentRef)) {
      return res.status(200).json({ success: true, status: 'already_processed', payment_state: currentState });
    }

    try {
      switch (currentState) {
        case 'paid':
        case 'done': {
          if (!busbudCartId) {
            const guidance = buildAgentGuidanceForFailure({
              code: 'CART_NOT_FOUND',
              reference: paymentRef,
              errorMessage: 'CART_NOT_FOUND'
            });
            return res.status(400).json({
              success: false,
              error: 'CART_NOT_FOUND',
              message: 'No Busbud cartId resolved for payment reference',
              agentMessage: guidance.agentMessage,
              nextSteps: guidance.nextSteps
            });
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

            // Persist purchase identifiers to Postgres carts for agent retry flows.
            try {
              await ensureCartsColumnsExist();
              await drizzleDb
                .update(cartsPgTable)
                .set({
                  firestoreCartId: String(paymentRef),
                  purchaseId: String(purchaseId),
                  purchaseUuid: String(purchaseUuid),
                  purchaseUpdatedAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(
                  or(
                    eq(cartsPgTable.cartId, String(busbudCartId)),
                    eq(cartsPgTable.firestoreCartId, String(paymentRef)),
                    eq(cartsPgTable.cartId, String(paymentRef))
                  )
                );
            } catch (e) {
              logger.warn(`[${pollId}] Failed to persist purchase ids to Postgres carts`, { error: e.message });
            }

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
                status: isCompletedPurchase ? 'confirmed' : 'failed',
                purchaseId,
                purchaseUuid,
                invoiceReference: paymentRef,
                confirmedAt: isCompletedPurchase ? new Date().toISOString() : undefined,
                failedAt: !isCompletedPurchase ? new Date().toISOString() : undefined,
                updatedAt: new Date().toISOString(),
                metadata: {
                  pollId,
                  processedAt: new Date().toISOString(),
                  purchaseStatus: completeResult.status || null,
                  pollOutcome: completeResult.pollOutcome || null
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

            if (isCompletedPurchase) {
              try {
                await incrementTicketCounters(paymentRef);
              } catch (e) {
                logger.warn(`[${pollId}] incrementTicketCounters failed`, { error: e.message });
              }

              await markProcessed(paymentRef);

              try {
                await sendPaymentWebhook({
                  event: 'payment.confirmed',
                  status: 'confirmed',
                  pnr: paymentRef,
                  payment_reference: paymentRef,
                  firestoreCartId: paymentRef,
                  cartId: busbudCartId,
                  purchaseId,
                  purchaseUuid,
                  amount: inv.amount_total,
                  currency: currency || 'USD',
                  confirmedAt: new Date().toISOString(),
                  metadata: {
                    pollId,
                    source: 'payments.poll',
                    clientBranch
                  }
                });
              } catch (e) {
                logger.warn(`[${pollId}] sendPaymentWebhook failed`, { error: e.message });
              }

              return res.status(200).json({ success: true, status: 'confirmed', purchaseId, purchaseUuid });
            }

            // Non-completed purchase: do NOT generate final ticket and do NOT count as sold.
            // Mark processed to prevent repeated purchase creation for the same paid invoice.
            await markProcessed(paymentRef);

            await markBookingFailedEverywhere({
              reference: paymentRef,
              busbudCartId,
              reason: 'Busbud purchase failed',
              meta: { source: 'payments.poll' }
            });
            try {
              await sendPaymentWebhook({
                event: 'payment.failed',
                status: 'busbud_failed',
                pnr: paymentRef,
                payment_reference: paymentRef,
                firestoreCartId: paymentRef,
                cartId: busbudCartId,
                purchaseId,
                purchaseUuid,
                amount: inv.amount_total,
                currency: currency || 'USD',
                failedAt: new Date().toISOString(),
                metadata: {
                  pollId,
                  source: 'payments.poll',
                  clientBranch,
                  pollOutcome: completeResult.pollOutcome || null,
                  purchaseStatus: completeResult.status || null
                }
              });
            } catch (e) {
              logger.warn(`[${pollId}] sendPaymentWebhook failed`, { error: e.message });
            }

            return res.status(200).json({
              success: false,
              status: 'busbud_failed',
              error: 'BUSBUD_PURCHASE_NOT_COMPLETED',
              message: `Busbud purchase did not complete (pollOutcome=${completeResult.pollOutcome || 'unknown'}, status=${normalizedStatus || 'unknown'})`,
              agentMessage: buildAgentGuidanceForFailure({
                code: 'BUSBUD_PURCHASE_NOT_COMPLETED',
                reference: paymentRef,
                errorMessage: `Busbud purchase did not complete (pollOutcome=${completeResult.pollOutcome || 'unknown'}, status=${normalizedStatus || 'unknown'})`
              }).agentMessage,
              nextSteps: buildAgentGuidanceForFailure({
                code: 'BUSBUD_PURCHASE_NOT_COMPLETED',
                reference: paymentRef,
                errorMessage: `Busbud purchase did not complete (pollOutcome=${completeResult.pollOutcome || 'unknown'}, status=${normalizedStatus || 'unknown'})`
              }).nextSteps,
              purchaseId,
              purchaseUuid,
            });
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
      const inferredStage = inferBusbudFailureStage(error && error.message ? error.message : '');
      if (inferredStage !== 'unknown') {
        const guidance = buildAgentGuidanceForFailure({
          code: 'BUSBUD_PURCHASE_FAILED',
          reference: paymentRef,
          errorMessage: error && error.message ? error.message : ''
        });

        await markBookingFailedEverywhere({
          reference: paymentRef,
          busbudCartId,
          reason: 'Busbud purchase failed',
          meta: { source: 'payments.poll' }
        });
        return res.status(200).json({
          success: false,
          status: 'busbud_failed',
          error: 'BUSBUD_PURCHASE_FAILED',
          message: 'Busbud purchase failed',
          agentMessage: guidance.agentMessage,
          nextSteps: guidance.nextSteps
        });
      }

      return res.status(500).json({ success: false, message: 'Failed to process poll', error: error.message });
    }
  })
);

// Agent-only: retry a failed Busbud purchase completion.
// IMPORTANT: This performs a single Busbud status check (no internal polling retries).
router.post(
  '/retry/:reference',
  requireAgentApi,
  asyncHandler(async (req, res) => {
    const requestId = `retry-${Date.now()}`;
    const reference = String(req.params.reference || '').trim();
    if (!reference) {
      return res.status(400).json({ success: false, error: 'NO_REFERENCE', message: 'Provide a reference/PNR' });
    }

    const allowedRefs = await computeAllowedInvoiceRefsForAgent(req, [reference], { allowOnline: true });
    if (!allowedRefs || !allowedRefs.has(reference)) {
      return res.status(403).json({ success: false, error: 'NOT_ALLOWED', message: 'Not allowed to retry this booking' });
    }

    let wasPaid = false;
    try {
      const rows = await drizzleDb
        .select({ status: paymentsTable.status })
        .from(paymentsTable)
        .where(eq(paymentsTable.transactionRef, reference))
        .limit(1);
      const s = rows && rows.length ? String(rows[0]?.status || '').toLowerCase() : '';
      wasPaid = s === 'paid';
    } catch (_) {
      wasPaid = false;
    }

    // Resolve Busbud cart id + stored purchase ids from Postgres carts.
    let busbudCartId = null;
    let purchaseId = null;
    let purchaseUuid = null;
    try {
      await ensureCartsColumnsExist();

      const ref = String(reference);
      const goodRows = await drizzleDb
        .select({
          cartId: cartsPgTable.cartId,
          purchaseId: cartsPgTable.purchaseId,
          purchaseUuid: cartsPgTable.purchaseUuid,
        })
        .from(cartsPgTable)
        .where(and(eq(cartsPgTable.firestoreCartId, ref), sql`${cartsPgTable.cartId} !~ '^\\d+$'`))
        .orderBy(desc(cartsPgTable.updatedAt))
        .limit(1);
      let row = goodRows && goodRows.length ? (goodRows[0] || null) : null;

      if (!row) {
        const anyRows = await drizzleDb
          .select({
            cartId: cartsPgTable.cartId,
            purchaseId: cartsPgTable.purchaseId,
            purchaseUuid: cartsPgTable.purchaseUuid,
          })
          .from(cartsPgTable)
          .where(or(eq(cartsPgTable.firestoreCartId, ref), eq(cartsPgTable.cartId, ref)))
          .orderBy(desc(cartsPgTable.updatedAt))
          .limit(1);
        row = anyRows && anyRows.length ? (anyRows[0] || null) : null;
      }

      if (row && row.cartId && !/^\d+$/.test(String(row.cartId).trim())) {
        busbudCartId = String(row.cartId).trim();
      }
      if (row && row.purchaseId) purchaseId = String(row.purchaseId).trim();
      if (row && row.purchaseUuid) purchaseUuid = String(row.purchaseUuid).trim();
    } catch (e) {
      logger.warn(`[${requestId}] Failed to resolve retry context from Postgres carts`, { reference, error: e.message });
    }

    if (!busbudCartId) {
      const guidance = buildAgentGuidanceForFailure({
        code: 'CART_NOT_FOUND',
        reference,
        errorMessage: 'CART_NOT_FOUND'
      });
      return res.status(400).json({
        success: false,
        error: 'CART_NOT_FOUND',
        message: 'No Busbud cartId resolved for payment reference',
        agentMessage: guidance.agentMessage,
        nextSteps: guidance.nextSteps
      });
    }

    // Acquire lock to prevent double retry
    const locked = await acquireProcessingLock(reference);
    if (!locked) {
      return res.status(200).json({ success: true, status: 'payment_processing', message: 'Already processing' });
    }

    try {
      // If we don't have a stored purchase id, start a new purchase.
      if (!purchaseId || !purchaseUuid) {
        const createResult = await createPurchase(busbudCartId, {
          returnUrl: `${process.env.FRONTEND_URL || 'https://your-app.com'}/confirmation`,
          skipValidation: true,
          locale: 'en-ca',
          currency: 'USD'
        });
        if (!createResult.success || !createResult.data) {
          throw new Error(`Failed to create purchase: ${createResult.error || 'Unknown error'}`);
        }
        purchaseId = String(createResult.data.id);
        purchaseUuid = String(createResult.data.uuid || createResult.data.purchase_uuid || '');
        if (!purchaseUuid) throw new Error('Missing purchaseUuid');

        try {
          await ensureCartsColumnsExist();
          await drizzleDb
            .update(cartsPgTable)
            .set({
              firestoreCartId: String(reference),
              purchaseId: String(purchaseId),
              purchaseUuid: String(purchaseUuid),
              purchaseUpdatedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(
              or(
                eq(cartsPgTable.cartId, String(busbudCartId)),
                eq(cartsPgTable.firestoreCartId, String(reference)),
                eq(cartsPgTable.cartId, String(reference))
              )
            );
        } catch (e) {
          logger.warn(`[${requestId}] Failed to persist purchase ids to Postgres carts (retry create)`, { reference, error: e.message });
        }
      }

      // Single status check: do NOT poll/retry internally.
      const completeResult = await completePurchase(purchaseId, purchaseUuid, requestId, Date.now(), {
        paymentRef: reference,
        cartId: busbudCartId,
        firestoreCartId: reference,
        paymentMethod: 'agent_retry',
        busbudStatusMaxAttempts: 1,
        busbudStatusIntervalMs: 0,
      });

      const normalizedStatus = (completeResult.status || (completeResult.purchase && completeResult.purchase.status) || '').toString().toLowerCase();
      const isCompletedPurchase =
        completeResult &&
        completeResult.success === true &&
        (completeResult.pollOutcome === 'completed' ||
          normalizedStatus === 'completed' ||
          normalizedStatus === 'booked' ||
          normalizedStatus === 'confirmed');

      if (!isCompletedPurchase) {
        const guidance = buildAgentGuidanceForFailure({
          code: 'BUSBUD_PURCHASE_FAILED',
          reference,
          errorMessage: 'Busbud purchase did not complete'
        });

        await markBookingFailedEverywhere({
          reference,
          busbudCartId,
          reason: 'Busbud purchase failed',
          meta: { source: 'payments.retry' }
        });

        return res.status(200).json({
          success: false,
          status: 'busbud_failed',
          error: 'BUSBUD_PURCHASE_NOT_COMPLETED',
          message: 'Busbud purchase did not complete',
          agentMessage: guidance.agentMessage,
          nextSteps: guidance.nextSteps,
          purchaseId,
          purchaseUuid,
        });
      }

      // Success: update statuses + send ticket email.
      try {
        await ensureCartsColumnsExist();
        await drizzleDb
          .update(cartsPgTable)
          .set({
            firestoreCartId: String(reference),
            status: 'confirmed',
            purchaseId: String(purchaseId),
            purchaseUuid: String(purchaseUuid),
            purchaseUpdatedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            or(
              eq(cartsPgTable.cartId, String(busbudCartId)),
              eq(cartsPgTable.firestoreCartId, String(reference)),
              eq(cartsPgTable.cartId, String(reference))
            )
          );
      } catch (e) {
        logger.warn(`[${requestId}] Failed to update Postgres cart status after retry confirmation`, {
          reference,
          cartId: busbudCartId,
          error: e.message,
        });
      }

      try {
        const db = await getFirestore();
        const patch = {
          status: 'confirmed',
          paid: true,
          paymentStatus: 'paid',
          firestoreCartId: String(reference),
          cartId: String(busbudCartId),
          updatedAt: new Date().toISOString(),
        };
        await db.collection('carts').doc(String(reference)).set(patch, { merge: true });
        if (busbudCartId) {
          await db.collection('carts').doc(String(busbudCartId)).set(patch, { merge: true });
        }
      } catch (_) {
        // noop
      }

      // Send e-ticket email (best-effort).
      try {
        const __baseRaw = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
        const __base = String(__baseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
        await axios.post(`${__base}/api/ticket/eticket/send`, {
          pnr: reference,
          cartId: busbudCartId,
          purchaseId,
          purchaseUuid
        }, { timeout: 15000 });
      } catch (e) {
        logger.warn(`[${requestId}] Failed to trigger e-ticket email via ticket route (retry)`, { error: e.message });
      }

      // Counters + webhook: only if this reference was not already marked paid.
      if (!wasPaid) {
        try { await incrementTicketCounters(reference); } catch (e) { logger.warn(`[${requestId}] incrementTicketCounters failed`, { error: e.message }); }
        try {
          await sendPaymentWebhook({
            event: 'payment.confirmed',
            status: 'confirmed',
            pnr: reference,
            payment_reference: reference,
            firestoreCartId: reference,
            cartId: busbudCartId,
            purchaseId,
            purchaseUuid,
            confirmedAt: new Date().toISOString(),
            metadata: { source: 'payments.retry' }
          });
        } catch (e) {
          logger.warn(`[${requestId}] sendPaymentWebhook failed`, { error: e.message });
        }
      }

      return res.status(200).json({
        success: true,
        status: 'confirmed',
        purchaseId,
        purchaseUuid,
      });
    } finally {
      await releaseProcessingLock(reference);
    }
  })
);

// Alias: support legacy/frontend path /api/payments/invoices/confirm
router.post(
  '/invoices/confirm',
  requireAgentApi,
  (req, res) => {
    // Preserve POST method and body
    return res.redirect(307, '/api/payments/confirm');
  }
);

// List unpaid active invoices for agents to confirm
router.get(
  '/invoices',
  requireAgentApi,
  asyncHandler(async (req, res) => {
    try {
      const status = String(req.query.status || 'unpaid').toLowerCase();
      const limit = Math.min(Number(req.query.limit || 200), 1000);
      const searchRaw = req.query.search ? String(req.query.search).trim() : '';

      const domain = [['move_type', '=', 'out_invoice']];
      if (status === 'unpaid') {
        domain.push(['payment_state', '!=', 'paid']);
        domain.push(['state', '!=', 'cancel']);
        domain.push(['amount_residual', '>', 0]);
      }
      if (searchRaw) {
        // Best-effort: filter by reference or invoice number
        domain.push('|', ['payment_reference', 'ilike', `%${searchRaw}%`], ['name', 'ilike', `%${searchRaw}%`]);
      }

      const fields = [
        'id', 'name', 'payment_reference', 'invoice_date', 'x_datetime',
        'amount_total', 'amount_residual', 'payment_state', 'state',
        'partner_id', 'currency_id'
      ];

      const rows = await travelMaster.searchReadInvoices(domain, fields, { limit, order: 'invoice_date desc' });
      const mapped = (rows || []).map((r) => ({
        id: r.id,
        number: r.name || null,
        reference: r.payment_reference || null,
        invoiceDate: r.invoice_date || null,
        dueDate: r.x_datetime || null,
        amount: typeof r.amount_total === 'number' ? r.amount_total : null,
        residual: typeof r.amount_residual === 'number' ? r.amount_residual : null,
        status: r.payment_state || r.state || null,
        state: r.state || null,
        partnerId: Array.isArray(r.partner_id) ? r.partner_id[0] : null,
        partnerName: Array.isArray(r.partner_id) ? r.partner_id[1] : null,
        currency: Array.isArray(r.currency_id) ? r.currency_id[1] : null,
      }));

      // Filter by invoices initiated by this agent only, using Firestore carts metadata
      let filtered = mapped;
      try {
        const refs = Array.from(new Set(mapped.map((m) => m.reference).filter(Boolean)));
        if (refs.length > 0) {
          const allowedSet = await computeAllowedInvoiceRefsForAgent(req, refs, { allowOnline: Boolean(searchRaw) });
          filtered = mapped.filter((m) => m.reference && allowedSet.has(m.reference));
        } else {
          filtered = [];
        }
      } catch (e) {
        logger.warn('Failed to filter invoices by agent via Firestore', { error: e.message });
        filtered = [];
      }

      return res.json({ success: true, data: { total: filtered.length, rows: filtered } });
    } catch (err) {
      logger.error('Failed to list unpaid invoices', { error: err.message, stack: err.stack });
      return res.status(500).json({ success: false, error: 'LIST_INVOICES_FAILED', message: err.message });
    }
  })
);

// Agents can confirm payment of one or more PNRs (invoice references).
// This will register a payment in Odoo and then trigger our existing poll flow to issue tickets.
router.post(
  '/confirm',
  requireAgentApi,
  asyncHandler(async (req, res) => {
    const requestId = `confirm-${Date.now()}`;
    try {
      const body = req.body || {};
      const selectedMethod = (typeof body.method === 'string' && body.method.trim()) ? body.method.trim() : 'agent_invoice';
      let refs = [];
      if (Array.isArray(body.references)) refs = body.references;
      if (typeof body.reference === 'string') refs.push(body.reference);
      if (typeof body.pnr === 'string') refs.push(body.pnr);
      if (Array.isArray(body.pnrs)) refs.push(...body.pnrs);

      // normalize and dedupe
      refs = Array.from(new Set(refs.map((r) => String(r).trim()).filter(Boolean)));
      if (!refs.length) {
        return res.status(400).json({ success: false, error: 'NO_REFERENCES', message: 'Provide at least one reference/PNR' });
      }

      // Filter by agent access (only for the refs requested by the agent)
      const allowedRefs = await computeAllowedInvoiceRefsForAgent(req, refs, { allowOnline: true });
      logger.info(`[${req.requestId || 'unknown'}] Allowed refs for agent (confirm): ${allowedRefs.size}`, {
        agentEmail: req.agentEmail,
        requestedRefs: refs.slice(0, 10),
        allowedRefs: Array.from(allowedRefs).slice(0, 10)
      });

      const results = [];

      // Persist successful confirmations to Postgres payments table (upsert by PNR)
      const persistConfirmation = async ({ reference, amount, status, invoiceId, detail }) => {
        try {
          await ensurePaymentsColumnsExist();

          const pricingFromCart = await loadPricingFromCartsTable({ firestoreCartId: reference, cartId: null });
          const pricingVals = {};
          if (pricingFromCart && pricingFromCart.costPrice != null) pricingVals.costPrice = pricingFromCart.costPrice;
          if (pricingFromCart && pricingFromCart.discount != null) pricingVals.discount = pricingFromCart.discount;
          if (pricingFromCart && pricingFromCart.markup != null) pricingVals.markup = pricingFromCart.markup;
          if (pricingFromCart && pricingFromCart.charges != null) pricingVals.charges = pricingFromCart.charges;
          if (pricingFromCart && pricingFromCart.commission != null) pricingVals.commission = pricingFromCart.commission;
          if (pricingFromCart) {
            const commissionPct = (() => {
              try {
                const ui = getPricingSettings();
                const raw = ui && (ui.commission ?? ui.percentage);
                const n = Number(raw);
                return Number.isFinite(n) ? n : null;
              } catch (_) {
                return null;
              }
            })();
            const costPriceNum = pricingFromCart.costPrice != null ? Number(pricingFromCart.costPrice) : NaN;
            const existingCommissionNum = pricingFromCart.commission != null ? Number(pricingFromCart.commission) : NaN;
            if (
              Number.isFinite(costPriceNum) &&
              costPriceNum > 0 &&
              commissionPct != null &&
              commissionPct > 0 &&
              (!Number.isFinite(existingCommissionNum) || existingCommissionNum === 0)
            ) {
              const computed = round2(costPriceNum * (commissionPct / 100));
              if (computed != null) pricingVals.commission = computed;
            }
          }
          if (pricingFromCart && pricingFromCart.roundDiff != null) pricingVals.roundDiff = pricingFromCart.roundDiff;

          const hdrName = (req.get && req.get('x-agent-name')) || (req.headers && req.headers['x-agent-name']) || null;
          const hdrEmail = (req.get && req.get('x-agent-email')) || (req.headers && req.headers['x-agent-email']) || null;
          const agentEmail = (req.agentEmail || (hdrEmail && String(hdrEmail)) || '').trim().toLowerCase();
          const agentName =
            (req.agent && (req.agent.name || `${req.agent.firstName || req.agent.first_name || ''} ${req.agent.lastName || req.agent.last_name || ''}`.trim())) ||
            (hdrName || '').trim();
          const bookedBy = agentName || agentEmail || 'agent';
          // IMPORTANT: Do NOT mark as paid until Busbud purchase completion succeeds.
          // Odoo payment registration is an intermediate state.
          const normalizedStatus = (status === 'confirm_registered' || status === 'already_paid') ? 'odoo_paid' : status;
          const record = {
            tripId: null,
            amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : 0,
            ...pricingVals,
            method: selectedMethod || 'agent_invoice',
            status: normalizedStatus,
            transactionRef: reference,
            bookedBy,
            rawResponse: {
              source: 'payments.confirm',
              invoiceId: invoiceId || null,
              requestId,
              payload: detail || null,
              at: new Date().toISOString()
            }
          };
          await drizzleDb
            .insert(paymentsTable)
            .values(record)
            .onConflictDoUpdate({
              target: paymentsTable.transactionRef,
              set: {
                amount: record.amount,
                ...pricingVals,
                method: record.method,
                status: sql`CASE WHEN ${paymentsTable.status} = 'paid' THEN 'paid' ELSE ${record.status} END`,
                bookedBy: record.bookedBy,
                rawResponse: sql`${paymentsTable.rawResponse}`
              }
            });
        } catch (e) {
          logger.warn('[payments.confirm] Persist confirmation failed', { reference, error: e.message });
        }
      };
      const toId = (v) => {
        try {
          if (v == null) return null;
          if (Array.isArray(v)) return Number(v[0]);
          if (typeof v === 'object') {
            if (typeof v.id === 'number') return v.id;
            if (Array.isArray(v.id)) return Number(v.id[0]);
          }
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        } catch (_) { return null; }
      };

      for (const reference of refs) {
        const item = { reference };
        try {
          if (!allowedRefs.has(reference)) {
            item.status = 'forbidden';
            item.error = 'NOT_ALLOWED';
            results.push(item);
            continue;
          }

          // Persist start of confirmation for audit
          await persistConfirmation({ reference, amount: null, status: 'confirm_started', invoiceId: null, detail: null });
          // Find invoice by PNR
          const invoices = await travelMaster.searchByPNR(reference);
          if (!invoices || invoices.length === 0) {
            item.status = 'not_found';
            await persistConfirmation({ reference, amount: null, status: 'not_found', invoiceId: null, detail: null });
            results.push(item);
            continue;
          }
          const inv = invoices[0];
          const invoiceId = toId(inv.id) || toId(inv.invoice_id) || toId(inv.move_id) || null;
          item.invoiceId = invoiceId;
          item.invoiceState = inv.state || null;
          item.paymentState = inv.payment_state || null;

          const options = {
            amount:
              typeof inv.amount_residual === 'number' && inv.amount_residual > 0
                ? inv.amount_residual
                : inv.amount_total,
            payment_date: new Date().toISOString().slice(0, 10),
            communication: `Payment registered via API (${selectedMethod || 'agent_invoice'}) for ${reference}`
          };

          // If not yet paid, register a payment in Odoo
          if (String(inv.payment_state || '').toLowerCase() !== 'paid') {
            logger.info('[payments.confirm] Registering payment', { reference, invoiceId, options });
            const reg = await travelMaster.registerPayment(invoiceId, options);
            item.registered = reg;
            const amt = (typeof options.amount === 'number' && options.amount > 0) ? options.amount : (typeof inv.amount_residual === 'number' && inv.amount_residual > 0 ? inv.amount_residual : inv.amount_total);
            await persistConfirmation({ reference, amount: amt, status: 'confirm_registered', invoiceId, detail: reg });
          } else {
            item.registered = { skipped: true, reason: 'already_paid' };
            const amt = typeof inv.amount_residual === 'number' && inv.amount_residual > 0 ? inv.amount_residual : inv.amount_total;
            await persistConfirmation({ reference, amount: amt, status: 'already_paid', invoiceId, detail: { skipped: true, reason: 'already_paid' } });
          }

          // Directly execute the ticket issuance flow without further polling
          try {
            // Resolve Busbud cart ID from Firestore using the Firestore cart ID / invoice reference
            let busbudCartId = null;

            const resolveFromPostgres = async () => {
              try {
                await ensureCartsColumnsExist();
                const ref = String(reference);

                let candidate = null;

                // For numeric references (PNR / firestoreCartId), prefer non-numeric cart_id values.
                if (!looksLikeBusbudCartId(ref)) {
                  const goodRows = await drizzleDb
                    .select({ cartId: cartsPgTable.cartId })
                    .from(cartsPgTable)
                    .where(and(eq(cartsPgTable.firestoreCartId, ref), sql`${cartsPgTable.cartId} !~ '^\\d+$'`))
                    .orderBy(desc(cartsPgTable.updatedAt))
                    .limit(1);
                  candidate = goodRows && goodRows.length ? (goodRows[0]?.cartId || null) : null;

                  if (!candidate) {
                    const anyRows = await drizzleDb
                      .select({ cartId: cartsPgTable.cartId })
                      .from(cartsPgTable)
                      .where(eq(cartsPgTable.firestoreCartId, ref))
                      .orderBy(desc(cartsPgTable.updatedAt))
                      .limit(1);
                    candidate = anyRows && anyRows.length ? (anyRows[0]?.cartId || null) : null;
                  }
                } else {
                  const rows = await drizzleDb
                    .select({ cartId: cartsPgTable.cartId })
                    .from(cartsPgTable)
                    .where(or(eq(cartsPgTable.firestoreCartId, ref), eq(cartsPgTable.cartId, ref)))
                    .orderBy(desc(cartsPgTable.updatedAt))
                    .limit(1);
                  candidate = rows && rows.length ? (rows[0]?.cartId || null) : null;
                }

                if (candidate && /^\d+$/.test(String(candidate).trim())) {
                  logger.warn(`[${requestId}] Postgres cartId is numeric; ignoring as Busbud cart id`, { reference, cartId: candidate });
                  candidate = null;
                }

                if (candidate) {
                  busbudCartId = candidate;
                  logger.info(`[${requestId}] Resolved Busbud cart ID from Postgres`, { reference, cartId: busbudCartId });
                }
              } catch (e) {
                logger.warn(`[${requestId}] Failed to resolve Busbud cart ID from Postgres`, { reference, error: e.message });
              }
            };

            if (usePostgresFirstForEticket) {
              await resolveFromPostgres();
            }

            if (!busbudCartId) {
              const guidance = buildAgentGuidanceForFailure({
                code: 'CART_NOT_FOUND',
                reference,
                errorMessage: 'CART_NOT_FOUND'
              });
              item.poll = {
                success: false,
                code: 'CART_NOT_FOUND',
                error: 'No Busbud cartId resolved for payment reference (Postgres carts.cart_id is required)',
                agentMessage: guidance.agentMessage,
                nextSteps: guidance.nextSteps
              };
            } else {
              const clientBranch = (req.clientBranch || 'unknown');
              // Acquire lock to prevent duplicate processing
              const locked = await acquireProcessingLock(reference);
              if (!locked) {
                item.poll = { success: true, status: 'payment_processing', message: 'Already processing' };
              } else {
                try {
                  // Create purchase
                  const currency = Array.isArray(inv.currency_id) ? (inv.currency_id[1] || 'USD') : 'USD';
                  const createResult = await createPurchase(busbudCartId, {
                    returnUrl: `${process.env.FRONTEND_URL || 'https://your-app.com'}/confirmation`,
                    skipValidation: false,
                    locale: 'en-ca',
                    currency
                  });
                  if (!createResult.success || !createResult.data) {
                    throw new Error(`Failed to create purchase: ${createResult.error || 'Unknown error'}`);
                  }
                  const purchaseId = createResult.data.id;
                  const purchaseUuid = createResult.data.uuid || createResult.data.purchase_uuid;

                  // Persist purchase identifiers to Postgres carts for agent retry flows.
                  try {
                    await ensureCartsColumnsExist();
                    await drizzleDb
                      .update(cartsPgTable)
                      .set({
                        firestoreCartId: String(reference),
                        purchaseId: String(purchaseId),
                        purchaseUuid: String(purchaseUuid),
                        purchaseUpdatedAt: new Date(),
                        updatedAt: new Date(),
                      })
                      .where(
                        or(
                          eq(cartsPgTable.cartId, String(busbudCartId)),
                          eq(cartsPgTable.firestoreCartId, String(reference)),
                          eq(cartsPgTable.cartId, String(reference))
                        )
                      );
                  } catch (e) {
                    logger.warn(`[${requestId}] Failed to persist purchase ids to Postgres carts`, { reference, error: e.message });
                  }

                  // Complete purchase
                  const completeResult = await completePurchase(purchaseId, purchaseUuid, requestId, Date.now(), {
                    paymentRef: reference,
                    cartId: busbudCartId,
                    firestoreCartId: reference,
                    paymentMethod: selectedMethod || null,
                  });
                  if (!completeResult.success) {
                    throw new Error(`Failed to complete purchase: ${completeResult.error || 'Unknown error'}`);
                  }

                  const normalizedStatus = (completeResult.status || (completeResult.purchase && completeResult.purchase.status) || '').toString().toLowerCase();
                  const isCompletedPurchase =
                    completeResult.pollOutcome === 'completed' ||
                    normalizedStatus === 'completed' ||
                    normalizedStatus === 'booked' ||
                    normalizedStatus === 'confirmed';

                  if (!isCompletedPurchase) {
                    throw new Error(
                      `Busbud purchase did not complete (pollOutcome=${completeResult.pollOutcome || 'unknown'}, status=${normalizedStatus || 'unknown'})`
                    );
                  }

                  // Mark the confirmation as paid only after Busbud completion succeeded.
                  try {
                    const amt = (typeof options.amount === 'number' && options.amount > 0)
                      ? options.amount
                      : (typeof inv.amount_residual === 'number' && inv.amount_residual > 0 ? inv.amount_residual : inv.amount_total);
                    await persistConfirmation({
                      reference,
                      amount: amt,
                      status: 'paid',
                      invoiceId,
                      detail: { purchaseId, purchaseUuid }
                    });
                  } catch (_) {
                    // ignore
                  }

                  // Ensure Postgres cart is no longer treated as awaiting_payment in agent reports.
                  // This is critical when the confirmation is initiated by PNR (invoices tab),
                  // while the awaiting-payment cart row may still be keyed by Busbud cart id.
                  try {
                    await ensureCartsColumnsExist();
                    await drizzleDb
                      .update(cartsPgTable)
                      .set({
                        firestoreCartId: String(reference),
                        status: 'confirmed',
                        updatedAt: new Date(),
                      })
                      .where(
                        or(
                          eq(cartsPgTable.cartId, String(busbudCartId)),
                          eq(cartsPgTable.firestoreCartId, String(reference)),
                          eq(cartsPgTable.cartId, String(reference))
                        )
                      );
                  } catch (e) {
                    logger.warn(`[${requestId}] Failed to update Postgres cart status after confirmation`, {
                      reference,
                      cartId: busbudCartId,
                      error: e.message,
                    });
                  }

                  // Best-effort: update Firestore cart status too (if the cart doc id is the PNR).
                  try {
                    const db = await getFirestore();
                    const patch = {
                      status: 'confirmed',
                      paid: true,
                      paymentStatus: 'paid',
                      firestoreCartId: String(reference),
                      cartId: String(busbudCartId),
                      updatedAt: new Date().toISOString(),
                    };
                    // Some environments use PNR as the Firestore doc id, others use Busbud cart id.
                    // Update both so agent recent bookings (Firestore fallback) cannot keep showing awaiting_payment.
                    await db.collection('carts').doc(String(reference)).set(patch, { merge: true });
                    if (busbudCartId) {
                      await db.collection('carts').doc(String(busbudCartId)).set(patch, { merge: true });
                    }

                    // Also update any cart docs that reference this booking but use a different doc id.
                    try {
                      const byFs = await db.collection('carts').where('firestoreCartId', '==', String(reference)).limit(20).get();
                      for (const d of (byFs && byFs.docs ? byFs.docs : [])) {
                        await d.ref.set(patch, { merge: true });
                      }
                    } catch (_) {}

                    try {
                      if (busbudCartId) {
                        const byCartId = await db.collection('carts').where('cartId', '==', String(busbudCartId)).limit(20).get();
                        for (const d of (byCartId && byCartId.docs ? byCartId.docs : [])) {
                          await d.ref.set(patch, { merge: true });
                        }
                      }
                    } catch (_) {}
                  } catch (_) {
                    // noop
                  }

                  // Best-effort booking status update
                  try {
                    await travelMaster.updateBookingStatus(busbudCartId, {
                      status: 'confirmed',
                      purchaseId,
                      purchaseUuid,
                      invoiceReference: reference,
                      confirmedAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                      metadata: { source: 'payments.confirm', processedAt: new Date().toISOString() }
                    });
                  } catch (e) {
                    logger.warn(`[${requestId}] updateBookingStatus failed`, { error: e.message });
                  }

                  // Send e-ticket email
                  try {
                    const __baseRaw = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
                    const __base = String(__baseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
                    await axios.post(`${__base}/api/ticket/eticket/send`, {
                      pnr: reference,
                      cartId: busbudCartId,
                      purchaseId,
                      purchaseUuid
                    }, { timeout: 15000 });
                    logger.info(`[${requestId}] Triggered e-ticket email via ticket route`, { reference, cartId: busbudCartId });
                  } catch (e) {
                    const status = e && e.response ? e.response.status : null;
                    const data = e && e.response ? e.response.data : null;
                    logger.warn(`[${requestId}] Failed to trigger e-ticket email via ticket route`, { error: e.message, status, data });
                  }

                  // Counters + webhook
                  try { await incrementTicketCounters(reference); } catch (e) { logger.warn(`[${requestId}] incrementTicketCounters failed`, { error: e.message }); }
                  await markProcessed(reference);
                  try {
                    await sendPaymentWebhook({
                      event: 'payment.confirmed',
                      status: 'confirmed',
                      pnr: reference,
                      payment_reference: reference,
                      firestoreCartId: reference,
                      cartId: busbudCartId,
                      purchaseId,
                      purchaseUuid,
                      amount: inv.amount_total,
                      currency,
                      confirmedAt: new Date().toISOString(),
                      metadata: { source: 'payments.confirm', clientBranch }
                    });
                  } catch (e) { logger.warn(`[${requestId}] sendPaymentWebhook failed`, { error: e.message }); }

                  item.poll = { success: true, status: 'confirmed', purchaseId, purchaseUuid };
                } finally {
                  await releaseProcessingLock(reference);
                }
              }
            }
          } catch (e) {
            const guidance = buildAgentGuidanceForFailure({
              code: 'BUSBUD_PURCHASE_FAILED',
              reference,
              errorMessage: e && e.message ? e.message : ''
            });
            item.poll = {
              success: false,
              code: 'BUSBUD_PURCHASE_FAILED',
              error: 'BUSBUD_PURCHASE_FAILED',
              agentMessage: guidance.agentMessage,
              nextSteps: guidance.nextSteps
            };

            await markBookingFailedEverywhere({
              reference,
              busbudCartId,
              reason: 'Busbud purchase failed',
              meta: { source: 'payments.confirm' }
            });
            try {
              await persistConfirmation({ reference, amount: null, status: 'busbud_failed', invoiceId: item.invoiceId, detail: { error: 'BUSBUD_PURCHASE_FAILED' } });
            } catch (_) {}
          }

          if (item.poll && item.poll.success) {
            item.status = 'ok';
            item.downloadUrl = `${process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`}/api/ticket/pdf/${reference}?download=1`;
          } else {
            item.status = 'error';
            item.error = (item.poll && item.poll.error) ? item.poll.error : (item.error || 'BUSBD_PURCHASE_FAILED');
          }
          results.push(item);
        } catch (e) {
          item.status = 'error';
          item.error = e.message;
          try {
            await persistConfirmation({ reference, amount: null, status: 'confirm_failed', invoiceId: item.invoiceId, detail: { error: e.message } });
          } catch (_) {}
          results.push(item);
        }
      }

      const hasFailure = (results || []).some((r) => {
        try {
          return !(r && r.poll && r.poll.success);
        } catch (_) {
          return true;
        }
      });

      if (hasFailure) {
        const guidance = buildAgentGuidanceForFailure({
          code: 'BUSBUD_PURCHASE_FAILED',
          reference: (results && results[0] && results[0].reference) ? results[0].reference : '',
          errorMessage: 'BUSBUD_PURCHASE_FAILED'
        });
        return res.status(409).json({
          success: false,
          error: 'BUSBUD_PURCHASE_FAILED',
          message: 'One or more confirmations failed. No final ticket was generated for the failed item(s).',
          agentMessage: guidance.agentMessage,
          nextSteps: guidance.nextSteps,
          results
        });
      }

      return res.status(200).json({ success: true, results });
    } catch (err) {
      logger.error(`[${requestId}] Failed to confirm invoice payments`, { error: err.message, stack: err.stack, body: req.body });
      return res.status(500).json({ success: false, error: 'CONFIRM_PAYMENTS_FAILED', message: err.message });
    }
  })
);

export default router;
