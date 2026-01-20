import express from 'express';
import { param, validationResult } from 'express-validator';
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
import { eq, and, inArray, sql, or } from 'drizzle-orm';

const router = express.Router();

const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

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
    await drizzleDb.execute(sql`ALTER TABLE "carts" ADD COLUMN IF NOT EXISTS "busbud_cart_id" text;`);
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
        retailPrice: cartsPgTable.retailPrice,
        commission: cartsPgTable.commission,
        roundDiff: cartsPgTable.roundDiff
      })
      .from(cartsPgTable)
      .where(
        candidates.length > 1
          ? or(eq(cartsPgTable.cartId, String(candidates[0])), eq(cartsPgTable.busbudCartId, String(candidates[1])))
          : or(eq(cartsPgTable.cartId, String(candidates[0])), eq(cartsPgTable.busbudCartId, String(candidates[0])))
      )
      .limit(1);
    return rows && rows.length ? (rows[0] || null) : null;
  } catch (_) {
    return null;
  }
};

const normalizeEmailLocal = (value) => String(value || '').trim().toLowerCase();

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const warmFinalTicketCache = async ({ pnr, requestId }) => {
  try {
    const __baseRaw = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const __base = String(__baseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
    const url = `${__base}/api/ticket/pdf?pnr=${encodeURIComponent(String(pnr))}&download=1&type=final&zip=1`;

    // Retry briefly because Busbud completePurchase sometimes takes a moment to include booking.tickets[].
    const delays = [0, 1500, 3000, 6000];
    let lastErr = null;
    for (let i = 0; i < delays.length; i += 1) {
      if (delays[i] > 0) await sleepMs(delays[i]);
      try {
        const resp = await axios.get(url, {
          timeout: 120000,
          maxRedirects: 5,
          responseType: 'arraybuffer',
          validateStatus: () => true,
        });

        if (resp.status >= 200 && resp.status < 300) {
          logger.info(`[${requestId}] Warmed final ticket cache`, { pnr: String(pnr), status: resp.status });
          return { success: true, status: resp.status };
        }

        // 422 means ticket numbers not ready yet; retry.
        if (resp.status === 422 || resp.status === 404) {
          lastErr = new Error(`Ticket not ready (status ${resp.status})`);
          continue;
        }

        lastErr = new Error(`Ticket warmup failed (status ${resp.status})`);
      } catch (e) {
        lastErr = e;
      }
    }

    logger.warn(`[${requestId}] Failed to warm final ticket cache after retries`, { pnr: String(pnr), error: lastErr && lastErr.message ? lastErr.message : String(lastErr) });
    return { success: false, error: lastErr && lastErr.message ? lastErr.message : String(lastErr) };
  } catch (e) {
    logger.warn(`[${requestId}] Failed to warm final ticket cache`, { pnr: String(pnr), error: e.message });
    return { success: false, error: e.message };
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
  const agentNameLower = buildAgentNameLower(req);

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

    for (const r of rows || []) {
      const ref = String(r.transactionRef || '').trim();
      if (!ref) continue;
      const bookedByNorm = normalizeEmailLocal(r.bookedBy || '');

      if (bookedByNorm && normalizedAgentEmail && bookedByNorm === normalizedAgentEmail) {
        allowed.add(ref);
        pending.delete(ref);
        continue;
      }

      if (bookedByNorm && agentNameLower && bookedByNorm === agentNameLower) {
        allowed.add(ref);
        pending.delete(ref);
        continue;
      }

      if (allowOnline && bookedByNorm === 'online') {
        allowed.add(ref);
        pending.delete(ref);
        continue;
      }
    }
  } catch (_) {
  }

  if (!pending.size) return allowed;

  // Fallback: check Postgres carts.booked_by (if carts were mirrored without a payment record)
  try {
    await ensureCartsColumnsExist();
    const pendingArr = Array.from(pending);
    const cartRows = await drizzleDb
      .select({
        cartId: cartsPgTable.cartId,
        busbudCartId: cartsPgTable.busbudCartId,
        bookedBy: cartsPgTable.bookedBy,
      })
      .from(cartsPgTable)
      .where(or(inArray(cartsPgTable.cartId, pendingArr), inArray(cartsPgTable.busbudCartId, pendingArr)));

    for (const r of cartRows || []) {
      const bookedByNorm = normalizeEmailLocal(r.bookedBy || '');
      const matchesAgentEmail = bookedByNorm && normalizedAgentEmail && bookedByNorm === normalizedAgentEmail;
      const matchesAgentName = bookedByNorm && agentNameLower && bookedByNorm === agentNameLower;
      const matchesOnline = allowOnline && bookedByNorm === 'online';

      if (!matchesAgentEmail && !matchesAgentName && !matchesOnline) continue;

      const candidates = [r.cartId, r.busbudCartId]
        .map((v) => String(v || '').trim())
        .filter(Boolean);
      for (const ref of candidates) {
        if (pending.has(ref)) {
          allowed.add(ref);
          pending.delete(ref);
        }
      }
      if (!pending.size) break;
    }
  } catch (_) {
  }

  if (!pending.size) return allowed;

  try {
    const db = await getFirestore();
    const checks = await Promise.all(
      Array.from(pending).map(async (ref) => {
        try {
          const snap = await db.collection('carts').doc(String(ref)).get();
          if (!snap.exists) return { ref, allowed: false };
          const cart = snap.data() || {};
          const rawMode = cart.agentMode;
          const cartAgentMode = rawMode === true || String(rawMode).toLowerCase() === 'true';
          const cartAgentEmail = normalizeEmailLocal(cart.agentEmail || (cart.agent && cart.agent.agentEmail) || '');
          const cartAgentNameLower = String(cart.agentName || (cart.agent && cart.agent.agentName) || '').trim().toLowerCase();

          if (cartAgentEmail) {
            if (normalizedAgentEmail && cartAgentEmail === normalizedAgentEmail) return { ref, allowed: true };
            return { ref, allowed: false };
          }

          if (cartAgentNameLower) {
            if (agentNameLower && cartAgentNameLower === agentNameLower) return { ref, allowed: true };
            if (cartAgentMode) return { ref, allowed: false };
          }

          if (cartAgentMode) return { ref, allowed: false };
          if (allowOnline) return { ref, allowed: true };
          return { ref, allowed: false };
        } catch (_) {
          return { ref, allowed: false };
        }
      })
    );

    for (const c of checks) {
      if (c && c.allowed) allowed.add(c.ref);
    }
  } catch (_) {
  }

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

    const pollCacheTtlMs = (() => {
      try {
        const n = Number(process.env.PAYMENT_POLL_CACHE_TTL_MS || 3000);
        return Number.isFinite(n) && n >= 0 ? n : 3000;
      } catch (_) {
        return 3000;
      }
    })();

    const mergeRawResponseLocal = (base, patch) => {
      try {
        const b = (base && typeof base === 'object') ? base : {};
        const p = (patch && typeof patch === 'object') ? patch : {};
        const bLast = (b.lastPoll && typeof b.lastPoll === 'object') ? b.lastPoll : {};
        const pLast = (p.lastPoll && typeof p.lastPoll === 'object') ? p.lastPoll : {};
        return { ...b, ...p, lastPoll: { ...bLast, ...pLast } };
      } catch (_) {
        return patch && typeof patch === 'object' ? patch : {};
      }
    };

    let cachedPaymentRow = null;
    try {
      await ensurePaymentsColumnsExist();
      const rows = await drizzleDb
        .select({ status: paymentsTable.status, rawResponse: paymentsTable.rawResponse })
        .from(paymentsTable)
        .where(eq(paymentsTable.transactionRef, String(paymentRef)))
        .limit(1);
      cachedPaymentRow = (rows && rows.length) ? (rows[0] || null) : null;
    } catch (e) {
      logger.warn(`[${pollId}] Failed to load cached payment row from Postgres`, { error: e.message });
    }

    const extractPurchaseFromRaw = (raw) => {
      try {
        const r = raw && typeof raw === 'object' ? raw : {};
        const pid = r.purchaseId || (r.purchase && r.purchase.id) || null;
        const puuid = r.purchaseUuid || (r.purchase && r.purchase.uuid) || null;
        return {
          purchaseId: pid != null ? String(pid) : null,
          purchaseUuid: puuid != null ? String(puuid) : null,
        };
      } catch (_) {
        return { purchaseId: null, purchaseUuid: null };
      }
    };

    const terminalStatusFromPg = (status) => {
      const s = String(status || '').toLowerCase();
      if (!s) return null;
      if (s === 'confirmed' || s === 'paid') return 'confirmed';
      if (s === 'cancelled' || s === 'canceled' || s === 'cancel') return 'cancelled';
      if (s === 'payment_failed' || s === 'failed' || s === 'reversed') return 'payment_failed';
      if (s === 'confirm_registered' || s === 'already_paid' || s === 'already_processed') return 'already_processed';
      return null;
    };

    const cachedTerminal = cachedPaymentRow ? terminalStatusFromPg(cachedPaymentRow.status) : null;
    if (cachedTerminal) {
      const purchase = extractPurchaseFromRaw(cachedPaymentRow.rawResponse);
      return res.status(200).json({
        success: true,
        status: cachedTerminal,
        ...(purchase.purchaseId ? { purchaseId: purchase.purchaseId } : {}),
        ...(purchase.purchaseUuid ? { purchaseUuid: purchase.purchaseUuid } : {}),
      });
    }

    // Small TTL cache: if we recently observed a non-terminal state, avoid hammering Odoo.
    try {
      const lastPoll = cachedPaymentRow && cachedPaymentRow.rawResponse && typeof cachedPaymentRow.rawResponse === 'object'
        ? cachedPaymentRow.rawResponse.lastPoll
        : null;
      const lastAtMs = lastPoll && typeof lastPoll === 'object' ? Number(lastPoll.atMs) : NaN;
      const nowMs = Date.now();
      if (Number.isFinite(lastAtMs) && pollCacheTtlMs > 0 && (nowMs - lastAtMs) < pollCacheTtlMs) {
        const st = String(cachedPaymentRow && cachedPaymentRow.status ? cachedPaymentRow.status : '').toLowerCase();
        if (st === 'payment_processing' || st === 'not_found') {
          return res.status(200).json({
            success: true,
            status: st,
            payment_state: lastPoll && typeof lastPoll === 'object' ? (lastPoll.odooPaymentState || null) : null,
            cached: true,
          });
        }
      }
    } catch (_) {}

    // If already processed, do not hit Odoo; return terminal state
    if (await isProcessed(paymentRef)) {
      return res.status(200).json({ success: true, status: 'already_processed' });
    }

    const persistPollSnapshot = async ({ status, invoice, odooState, busbudCartId, extra } = {}) => {
      try {
        await ensurePaymentsColumnsExist();
        const amount = invoice && typeof invoice.amount_total === 'number' ? invoice.amount_total : 0;
        const baseRaw = cachedPaymentRow && cachedPaymentRow.rawResponse ? cachedPaymentRow.rawResponse : {};
        const patch = {
          ...(busbudCartId ? { busbudCartId: String(busbudCartId) } : {}),
          lastPoll: {
            at: new Date().toISOString(),
            atMs: Date.now(),
            odooPaymentState: odooState != null ? String(odooState) : null,
          },
          ...(extra && typeof extra === 'object' ? extra : {}),
        };
        const merged = mergeRawResponseLocal(baseRaw, patch);

        await drizzleDb
          .insert(paymentsTable)
          .values({
            tripId: null,
            amount,
            method: 'invoice_poll',
            status: String(status || 'payment_processing'),
            transactionRef: String(paymentRef),
            bookedBy: null,
            rawResponse: merged
          })
          .onConflictDoUpdate({
            target: paymentsTable.transactionRef,
            set: {
              status: sql`CASE 
                WHEN ${paymentsTable.status} IN ('paid','confirmed') AND ${String(status || '')} NOT IN ('paid','confirmed') THEN ${paymentsTable.status}
                ELSE ${String(status || 'payment_processing')}
              END`,
              rawResponse: merged
            }
          });
      } catch (e) {
        logger.warn(`[${pollId}] Failed to persist poll snapshot`, { reference: paymentRef, error: e.message });
      }
    };

    const resolveBusbudCartId = async () => {
      let busbudCartId = null;

      try {
        const raw = cachedPaymentRow && cachedPaymentRow.rawResponse && typeof cachedPaymentRow.rawResponse === 'object'
          ? cachedPaymentRow.rawResponse
          : null;
        const candidate = raw && (raw.busbudCartId || (raw.cart && raw.cart.busbudCartId) || null);
        if (candidate != null && String(candidate).trim()) {
          busbudCartId = String(candidate).trim();
        }
      } catch (_) {}

      if (!busbudCartId) {
        try {
          await ensureCartsColumnsExist();
          const pgRows = await drizzleDb
            .select({ busbudCartId: cartsPgTable.busbudCartId })
            .from(cartsPgTable)
            .where(eq(cartsPgTable.cartId, String(paymentRef)))
            .limit(1);
          const pgRow = pgRows && pgRows.length ? (pgRows[0] || null) : null;
          if (pgRow && pgRow.busbudCartId) busbudCartId = String(pgRow.busbudCartId);
        } catch (e) {
          logger.warn(`[${pollId}] Failed to resolve Busbud cart ID from Postgres`, { reference: paymentRef, error: e.message });
        }
      }

      if (!busbudCartId) {
        try {
          const db = await getFirestore();
          const cartDoc = await db.collection('carts').doc(String(paymentRef)).get();
          if (cartDoc.exists) {
            const cartData = cartDoc.data() || {};
            busbudCartId = cartData.busbudCartId || null;
            if (busbudCartId) {
              try {
                await ensureCartsColumnsExist();
                drizzleDb
                  .update(cartsPgTable)
                  .set({ busbudCartId: String(busbudCartId), updatedAt: new Date() })
                  .where(eq(cartsPgTable.cartId, String(paymentRef)))
                  .catch(() => {});
              } catch (_) {}
            }
          } else {
            logger.warn(`[${pollId}] No Firestore cart found for payment reference`, { reference: paymentRef });
          }
        } catch (e) {
          logger.warn(`[${pollId}] Failed to resolve Busbud cart ID from Firestore`, { reference: paymentRef, error: e.message });
        }
      }

      return busbudCartId;
    };

    logger.info(`[${pollId}] Polling invoice state`, { reference: paymentRef, firestoreCartId: paymentRef });

    // Query Odoo for invoice state
    let invoices = [];
    try {
      invoices = await travelMaster.searchByPNR(paymentRef);
    } catch (err) {
      logger.error(`[${pollId}] Odoo searchByPNR failed`, { error: err.message });
      return res.status(500).json({ success: false, message: 'Failed to query invoice', error: err.message });
    }

    if (!invoices || invoices.length === 0) {
      await persistPollSnapshot({ status: 'not_found', invoice: null, odooState: 'not_found', busbudCartId: null });
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
          const busbudCartId = await resolveBusbudCartId();
          if (!busbudCartId) {
            await persistPollSnapshot({ status: 'payment_processing', invoice: inv, odooState: currentState, busbudCartId: null });
            return res.status(400).json({ success: false, message: 'No Busbud cartId resolved for payment reference' });
          }

          await persistPollSnapshot({ status: 'payment_processing', invoice: inv, odooState: currentState, busbudCartId });

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
              const __baseRaw = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
              const __base = String(__baseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');
              if (isCompletedPurchase) {
                axios
                  .post(
                    `${__base}/api/ticket/eticket/send`,
                    {
                      pnr: paymentRef,
                      cartId: busbudCartId,
                      purchaseId,
                      purchaseUuid
                    },
                    { timeout: 60000 }
                  )
                  .then(() => {
                    logger.info(`[${pollId}] Triggered e-ticket email via ticket route`, { reference: paymentRef, cartId: busbudCartId });
                  })
                  .catch((err) => {
                    logger.warn(`[${pollId}] Failed to trigger e-ticket email via ticket route`, { error: err.message });
                  });
              } else {
                axios
                  .post(
                    `${__base}/api/ticket/failed/send`,
                    {
                      pnr: paymentRef,
                      cartId: busbudCartId,
                      purchaseId,
                      purchaseUuid,
                      purchaseStatus: completeResult.status || (completeResult.purchase && completeResult.purchase.status) || null,
                      pollOutcome: completeResult.pollOutcome || null
                    },
                    { timeout: 60000 }
                  )
                  .then(() => {
                    logger.info(`[${pollId}] Triggered failed-ticket notification via ticket route`, {
                      reference: paymentRef,
                      cartId: busbudCartId,
                      pollOutcome: completeResult.pollOutcome || null,
                      status: normalizedStatus
                    });
                  })
                  .catch((err) => {
                    logger.warn(`[${pollId}] Failed to trigger failed-ticket email via ticket route`, { error: err.message });
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

            await persistPollSnapshot({
              status: 'confirmed',
              invoice: inv,
              odooState: currentState,
              busbudCartId,
              extra: {
                purchaseId,
                purchaseUuid,
              }
            });

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
          } finally {
            await releaseProcessingLock(paymentRef);
          }
        }

        case 'in_payment':
        case 'pending': {
          const busbudCartId = await resolveBusbudCartId();
          if (busbudCartId) {
            try {
              await travelMaster.updateBookingStatus(busbudCartId, { status: 'payment_processing', updatedAt: new Date().toISOString() });
            } catch (e) {
              logger.warn(`[${pollId}] updateBookingStatus(payment_processing) failed`, { error: e.message });
            }
          }
          await persistPollSnapshot({ status: 'payment_processing', invoice: inv, odooState: currentState, busbudCartId: busbudCartId || null });
          return res.status(200).json({ success: true, status: 'payment_processing' });
        }

        case 'cancel':
        case 'cancelled': {
          const busbudCartId = await resolveBusbudCartId();
          if (busbudCartId) {
            try {
              await travelMaster.updateBookingStatus(busbudCartId, { status: 'cancelled', cancelledAt: new Date().toISOString(), cancellationReason: 'Payment cancelled' });
            } catch (e) {
              logger.warn(`[${pollId}] updateBookingStatus(cancelled) failed`, { error: e.message });
            }
          }
          await markProcessed(paymentRef);
          await persistPollSnapshot({ status: 'cancelled', invoice: inv, odooState: currentState, busbudCartId: busbudCartId || null });
          return res.status(200).json({ success: true, status: 'cancelled' });
        }

        case 'failed':
        case 'reversed': {
          const busbudCartId = await resolveBusbudCartId();
          if (busbudCartId) {
            try {
              await travelMaster.updateBookingStatus(busbudCartId, { status: 'payment_failed', failedAt: new Date().toISOString(), failureReason: `Payment failed: ${currentState}` });
            } catch (e) {
              logger.warn(`[${pollId}] updateBookingStatus(payment_failed) failed`, { error: e.message });
            }
          }
          await markProcessed(paymentRef);
          await persistPollSnapshot({ status: 'payment_failed', invoice: inv, odooState: currentState, busbudCartId: busbudCartId || null });
          return res.status(200).json({ success: true, status: 'payment_failed' });
        }

        default:
          logger.info(`[${pollId}] Unhandled payment state`, { payment_state: currentState, reference: paymentRef });
          await persistPollSnapshot({ status: String(currentState || 'unknown'), invoice: inv, odooState: currentState, busbudCartId: null });
          return res.status(200).json({ success: true, status: currentState || 'unknown' });
      }
    } catch (error) {
      logger.error(`[${pollId}] Poll processing error`, { error: error.message, stack: error.stack });
      return res.status(500).json({ success: false, message: 'Failed to process poll', error: error.message });
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

      const results = new Array(refs.length);

      // Persist a confirmation attempt/result to Postgres payments table (upsert by PNR)
      const persistConfirmation = async ({ reference, amount, status, invoiceId: _invoiceId, detail: _detail }) => {
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

          const cartRetail = (() => {
            try {
              const v = pricingFromCart && pricingFromCart.retailPrice;
              if (v == null) return null;
              const n = Number(v);
              return Number.isFinite(n) && n > 0 ? n : null;
            } catch (_) {
              return null;
            }
          })();
          const amtProvided = (typeof amount === 'number' && Number.isFinite(amount) && amount > 0) ? amount : null;
          if (cartRetail != null && amtProvided != null && Math.abs(cartRetail - amtProvided) > 0.01) {
            logger.warn('[payments.confirm] Cart total differs from invoice/payment amount', {
              reference,
              cartRetail,
              amount: amtProvided,
              diff: Number((cartRetail - amtProvided).toFixed(2)),
              status
            });
          }

          const hdrName = (req.get && req.get('x-agent-name')) || (req.headers && req.headers['x-agent-name']) || null;
          const hdrEmail = (req.get && req.get('x-agent-email')) || (req.headers && req.headers['x-agent-email']) || null;
          const agentEmail = (req.agentEmail || (hdrEmail && String(hdrEmail)) || '').trim().toLowerCase();
          const agentName =
            (req.agent && (req.agent.name || `${req.agent.firstName || req.agent.first_name || ''} ${req.agent.lastName || req.agent.last_name || ''}`.trim())) ||
            (hdrName || '').trim();
          const bookedBy = agentName || agentEmail || 'agent';
          const record = {
            tripId: null,
            amount: (typeof amount === 'number' && Number.isFinite(amount) && amount > 0)
              ? amount
              : (cartRetail != null ? cartRetail : 0),
            ...pricingVals,
            method: selectedMethod || 'agent_invoice',
            status,
            transactionRef: reference,
            bookedBy,
            rawResponse: {}
          };

          await drizzleDb
            .insert(paymentsTable)
            .values(record)
            .onConflictDoUpdate({
              target: paymentsTable.transactionRef,
              set: {
                amount: sql`CASE WHEN ${paymentsTable.status} = 'paid' AND ${record.status} <> 'paid' THEN ${paymentsTable.amount} ELSE ${record.amount} END`,
                ...pricingVals,
                method: record.method,
                status: sql`CASE WHEN ${paymentsTable.status} = 'paid' AND ${record.status} <> 'paid' THEN 'paid' ELSE ${record.status} END`,
                bookedBy: sql`CASE 
                  WHEN (${paymentsTable.bookedBy} IS NULL OR ${paymentsTable.bookedBy} = '' OR ${paymentsTable.bookedBy} = 'online') AND ${record.bookedBy} <> 'online' THEN ${record.bookedBy}
                  WHEN (${paymentsTable.bookedBy} IS NULL OR ${paymentsTable.bookedBy} = '') THEN ${record.bookedBy}
                  ELSE ${paymentsTable.bookedBy}
                END`
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

      const processOne = async (reference) => {
        const item = { reference };
        try {
          if (!allowedRefs.has(reference)) {
            item.status = 'forbidden';
            item.error = 'NOT_ALLOWED';
            return item;
          }

          // Persist start of confirmation for audit
          await persistConfirmation({ reference, amount: null, status: 'confirm_started', invoiceId: null, detail: null });
          // Find invoice by PNR
          const invoices = await travelMaster.searchByPNR(reference);
          if (!invoices || invoices.length === 0) {
            item.status = 'not_found';
            await persistConfirmation({ reference, amount: null, status: 'not_found', invoiceId: null, detail: null });
            return item;
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
            await persistConfirmation({ reference, amount: amt, status: 'paid', invoiceId, detail: { skipped: true, reason: 'already_paid' } });
          }

          // Directly execute the ticket issuance flow without further polling
          try {
            let busbudCartId = null;
            try {
              await ensureCartsColumnsExist();
              const pgRows = await drizzleDb
                .select({ busbudCartId: cartsPgTable.busbudCartId })
                .from(cartsPgTable)
                .where(eq(cartsPgTable.cartId, String(reference)))
                .limit(1);
              const pgRow = pgRows && pgRows.length ? (pgRows[0] || null) : null;
              if (pgRow && pgRow.busbudCartId) busbudCartId = String(pgRow.busbudCartId);
            } catch (e) {
              logger.warn(`[${requestId}] Failed to resolve Busbud cart ID from Postgres`, { reference, error: e.message });
            }

            if (!busbudCartId) {
              try {
                const db = await getFirestore();
                const cartDoc = await db.collection('carts').doc(String(reference)).get();
                if (cartDoc.exists) {
                  const cartData = cartDoc.data() || {};
                  busbudCartId = cartData.busbudCartId || null;
                  if (busbudCartId) {
                    try {
                      await ensureCartsColumnsExist();
                      drizzleDb
                        .update(cartsPgTable)
                        .set({ busbudCartId: String(busbudCartId), updatedAt: new Date() })
                        .where(eq(cartsPgTable.cartId, String(reference)))
                        .catch(() => {});
                    } catch (_) {}
                  }
                } else {
                  logger.warn(`[${requestId}] No Firestore cart found for payment reference`, { reference });
                }
              } catch (e) {
                logger.warn(`[${requestId}] Failed to resolve Busbud cart ID from Firestore`, { reference, error: e.message });
              }
            }

            if (!busbudCartId) {
              item.poll = { success: false, error: 'No Busbud cartId resolved for payment reference' };
            } else {
              try {
                const verifyRows = await drizzleDb
                  .select({ cartId: cartsPgTable.cartId, busbudCartId: cartsPgTable.busbudCartId })
                  .from(cartsPgTable)
                  .where(or(eq(cartsPgTable.cartId, String(reference)), eq(cartsPgTable.busbudCartId, String(busbudCartId))))
                  .limit(1);
                const verify = verifyRows && verifyRows.length ? (verifyRows[0] || null) : null;
                if (verify && verify.cartId && String(verify.cartId) !== String(reference)) {
                  throw new Error(`Cart mapping mismatch for reference ${reference}`);
                }
              } catch (e) {
                item.poll = { success: false, error: e.message };
                item.status = 'error';
                item.error = e.message;
                return item;
              }

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
                    skipValidation: true,
                    locale: 'en-ca',
                    currency
                  });
                  if (!createResult.success || !createResult.data) {
                    throw new Error(`Failed to create purchase: ${createResult.error || 'Unknown error'}`);
                  }
                  const purchaseId = createResult.data.id;
                  const purchaseUuid = createResult.data.uuid || createResult.data.purchase_uuid;

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

                  try {
                    const amt = typeof inv.amount_total === 'number'
                      ? inv.amount_total
                      : (typeof options.amount === 'number' ? options.amount : null);
                    await persistConfirmation({
                      reference,
                      amount: typeof amt === 'number' && Number.isFinite(amt) ? amt : null,
                      status: 'paid',
                      invoiceId,
                      detail: {
                        purchaseId,
                        purchaseUuid,
                        busbudCartId,
                        completedAt: new Date().toISOString(),
                      },
                    });
                  } catch (_) {}

                  try {
                    await ensureCartsColumnsExist();
                    drizzleDb
                      .update(cartsPgTable)
                      .set({
                        status: 'confirmed',
                        purchaseId: String(purchaseId),
                        purchaseUuid: String(purchaseUuid),
                        purchaseUpdatedAt: new Date(),
                        updatedAt: new Date(),
                      })
                      .where(or(eq(cartsPgTable.cartId, String(reference)), eq(cartsPgTable.busbudCartId, String(busbudCartId))))
                      .catch(() => {});
                  } catch (_) {}

                  // Best-effort booking status update
                  try {
                    travelMaster.updateBookingStatus(busbudCartId, {
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
                    axios
                      .post(
                        `${__base}/api/ticket/eticket/send`,
                        {
                          pnr: reference,
                          cartId: busbudCartId,
                          purchaseId,
                          purchaseUuid
                        },
                        { timeout: 60000 }
                      )
                      .then(() => {
                        logger.info(`[${requestId}] Triggered e-ticket email via ticket route`, { reference, cartId: busbudCartId });
                      })
                      .catch((err) => {
                        logger.warn(`[${requestId}] Failed to trigger e-ticket email via ticket route`, { error: err.message });
                      });
                  } catch (e) {
                    logger.warn(`[${requestId}] Failed to trigger e-ticket email via ticket route`, { error: e.message });
                  }

                  // Warm final ticket download cache (PDF/ZIP) so customer download cannot fail after payment success.
                  // Fire-and-forget with retries.
                  warmFinalTicketCache({ pnr: reference, requestId }).catch(() => {});

                  // Counters + webhook
                  try {
                    incrementTicketCounters(reference).catch((e) => {
                      logger.warn(`[${requestId}] incrementTicketCounters failed`, { error: e.message });
                    });
                  } catch (e) {
                    logger.warn(`[${requestId}] incrementTicketCounters failed`, { error: e.message });
                  }
                  await markProcessed(reference);
                  try {
                    sendPaymentWebhook({
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
                    }).catch((e) => {
                      logger.warn(`[${requestId}] sendPaymentWebhook failed`, { error: e.message });
                    });
                  } catch (e) { logger.warn(`[${requestId}] sendPaymentWebhook failed`, { error: e.message }); }

                  item.poll = { success: true, status: 'confirmed', purchaseId, purchaseUuid };
                } finally {
                  await releaseProcessingLock(reference);
                }
              }
            }
          } catch (e) {
            item.poll = { success: false, error: e.message };
          }

          item.status = 'ok';
          item.downloadUrl = `/api/ticket/pdf?pnr=${encodeURIComponent(String(reference))}&download=1&type=final&zip=1&v=${Date.now()}`;
          return item;
        } catch (e) {
          item.status = 'error';
          item.error = e.message;
          try {
            await persistConfirmation({ reference, amount: null, status: 'confirm_failed', invoiceId: item.invoiceId, detail: { error: e.message } });
          } catch (_) {}
          return item;
        }
      };

      const maxConcurrency = 3;
      let cursor = 0;
      const workers = Array.from({ length: Math.min(maxConcurrency, refs.length) }, async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= refs.length) break;
          const reference = refs[i];
          results[i] = await processOne(reference);
        }
      });
      await Promise.all(workers);

      return res.json({ success: true, results });
    } catch (err) {
      logger.error(`[${requestId}] Failed to confirm invoice payments`, { error: err.message, stack: err.stack, body: req.body });
      return res.status(500).json({ success: false, error: 'CONFIRM_PAYMENTS_FAILED', message: err.message });
    }
  })
);

export default router;
