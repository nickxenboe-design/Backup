 import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import logger from '../utils/logger.js';
import BusbudService from '../services/busbud.service.mjs';
import { ApiError } from '../utils/apiError.js';
import { getFirestore } from '../config/firebase.config.mjs';
import { applyPriceAdjustments } from '../utils/price.utils.js';
import { getPricingSettings } from '../config/runtimeSettings.js';
import drizzleDb, { payments, carts as cartsPgTable } from '../db/drizzleClient.js';
import { sql, eq, or } from 'drizzle-orm';

// In-memory cart storage
const carts = new Map();

const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// Simple in-memory cart functions
const saveCart = async (cartData) => {
  if (!cartData.id) {
    cartData.id = `cart_${Date.now()}`;
  }
  cartData.updatedAt = new Date().toISOString();
  carts.set(cartData.id, { ...cartData });
  return cartData;
};

const getCart = async (cartId) => {
  return carts.get(cartId) || null;
};

const router = express.Router();

// Agent headers are managed by the frontend; backend does not enrich agent context here.

console.log('✅ Purchase route loaded');

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

function deriveBranchFromId(id) {
  const s = String(id || '').trim();
  if (!s) return null;
  if (/^[1-3][0-9]{8,}$/.test(s)) return s.slice(1, 3);
  if (/^[A-Za-z][0-9]{8,}$/.test(s)) return s.slice(1, 3);
  if (/^[0-9]{8,}$/.test(s)) return s.slice(0, 2);
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePurchaseStatusForPolling(statusPayload) {
  const payload = statusPayload || {};
  const rawStatus = (payload.status || '').toString().toLowerCase();
  const purchaseStep = (payload.purchase_step || '').toString().toLowerCase();
  const ticketsState = (payload.tickets_state || '').toString().toLowerCase();

  const result = {
    state: 'pending',
    status: rawStatus,
    purchaseStep,
    ticketsState
  };

  const completedStatusValues = ['completed', 'booked', 'confirmed', 'succeeded', 'success'];
  const completedTicketStates = ['booked', 'confirmed', 'issued', 'completed'];
  const completedSteps = ['complete', 'completed', 'book', 'done'];

  const failedStatusValues = ['failed', 'cancelled', 'canceled', 'refunded', 'reversed', 'expired'];
  const failedTicketStates = ['failed', 'cancelled', 'canceled', 'refunded', 'reversed', 'expired'];
  const failedSteps = ['failed', 'error'];

  if (
    completedStatusValues.includes(rawStatus) ||
    completedTicketStates.includes(ticketsState) ||
    completedSteps.includes(purchaseStep)
  ) {
    result.state = 'completed';
    return result;
  }

  if (
    failedStatusValues.includes(rawStatus) ||
    failedTicketStates.includes(ticketsState) ||
    failedSteps.includes(purchaseStep)
  ) {
    result.state = 'failed';
  }

  return result;
}

async function pollBusbudPurchaseStatus(purchaseId, purchaseUuid, requestId, options = {}) {
  const maxAttempts = Number(
    (options && options.maxAttempts != null ? options.maxAttempts : process.env.BUSBUD_PURCHASE_STATUS_MAX_ATTEMPTS) ||
      10
  );
  const intervalMs = Number(
    (options && options.intervalMs != null ? options.intervalMs : process.env.BUSBUD_PURCHASE_STATUS_INTERVAL_MS) ||
      3000
  );

  let lastStatus = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[${requestId}] 🔄 Polling purchase status (attempt ${attempt}/${maxAttempts})`);
    try {
      lastStatus = await BusbudService.getPurchaseStatus(purchaseId, purchaseUuid);
    } catch (err) {
      console.log(`[${requestId}] ❌ Error polling purchase status on attempt ${attempt}:`, err.message);
      return {
        outcome: 'failed',
        lastStatus,
        normalized: lastStatus ? normalizePurchaseStatusForPolling(lastStatus) : null,
        error: err
      };
    }

    const normalized = normalizePurchaseStatusForPolling(lastStatus);
    console.log(`[${requestId}] ℹ️ Normalized purchase status:`, JSON.stringify(normalized, null, 2));

    if (normalized.state === 'completed') {
      return {
        outcome: 'completed',
        lastStatus,
        normalized
      };
    }

    if (normalized.state === 'failed') {
      return {
        outcome: 'failed',
        lastStatus,
        normalized
      };
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  return {
    outcome: 'timeout',
    lastStatus,
    normalized: lastStatus ? normalizePurchaseStatusForPolling(lastStatus) : null
  };
}

function computeAdjustedTotalsFromPurchase(purchaseDetails) {
  try {
    if (!purchaseDetails || typeof purchaseDetails !== 'object') return null;
    const summary = purchaseDetails.summary || {};
    const charges = purchaseDetails.charges || {};
    let baseTotal = null;
    let currency = null;

    if (typeof summary.total === 'number') {
      baseTotal = summary.total; // cents
      currency = summary.currency || charges.currency || 'USD';
    } else if (typeof charges.total === 'number') {
      baseTotal = charges.total; // cents
      currency = charges.currency || summary.currency || 'USD';
    } else if (typeof charges.amount === 'number') {
      // Many Busbud responses expose charges.amount as the main total
      baseTotal = charges.amount; // cents
      currency = charges.currency || summary.currency || 'USD';
    } else {
      // Fallback: try nested trips.*.prices[0].prices.total structure
      try {
        const trips = purchaseDetails.trips && typeof purchaseDetails.trips === 'object'
          ? Object.values(purchaseDetails.trips)
          : [];
        const firstTrip = Array.isArray(trips) && trips.length ? trips[0] : null;
        const pricesArr = firstTrip && Array.isArray(firstTrip.prices) ? firstTrip.prices : [];
        const firstPrice = pricesArr.length ? pricesArr[0] : null;
        const deepPrices = firstPrice && firstPrice.prices ? firstPrice.prices : null;
        if (deepPrices && typeof deepPrices.total === 'number') {
          baseTotal = deepPrices.total; // cents
          currency = deepPrices.currency || charges.currency || summary.currency || 'USD';
        }
      } catch (_) {
        // ignore and fall through
      }

      if (baseTotal == null) {
        return null;
      }
    }

    const baseAmount = baseTotal / 100;
    const adj = applyPriceAdjustments(baseAmount, { currency, returnMetadata: true });
    if (!adj || typeof adj.amount !== 'number') return null;

    return {
      currency,
      originalTotal: adj.originalAmount,
      adjustedTotal: adj.amount,
      totalAdjustment: adj.discountAmount
    };
  } catch (e) {
    logger.warn('Failed to compute adjusted totals from purchase', { error: e.message });
    return null;
  }
}

async function savePurchaseToPostgres(purchaseId, purchaseUuid, purchaseDetails, extraMeta, pollOutcome, requestId) {
  try {
    if (!purchaseDetails || typeof purchaseDetails !== 'object') {
      return;
    }

    const rawStatus = (
      purchaseDetails.status ||
      purchaseDetails.purchase_state ||
      purchaseDetails.tickets_state ||
      ''
    )
      .toString()
      .toLowerCase();

    logger.info('Persisting Busbud purchase to Postgres', {
      purchaseId,
      purchaseUuid,
      pollOutcome,
      rawStatus,
      requestId,
    });

    const totals = computeAdjustedTotalsFromPurchase(purchaseDetails) || {};
    const charges = purchaseDetails.charges || {};

    let amount = null;
    if (typeof totals.adjustedTotal === 'number' && Number.isFinite(totals.adjustedTotal)) {
      amount = totals.adjustedTotal;
    } else if (typeof charges.total === 'number' && Number.isFinite(charges.total)) {
      amount = charges.total / 100;
    } else if (typeof charges.amount === 'number' && Number.isFinite(charges.amount)) {
      amount = charges.amount / 100;
    }

    const currency =
      totals.currency ||
      charges.currency ||
      (purchaseDetails.summary && purchaseDetails.summary.currency) ||
      'USD';

    if (amount == null || !Number.isFinite(amount)) {
      logger.warn('Skipping Postgres persistence: could not determine numeric amount from purchase', {
        purchaseId,
        purchaseUuid,
        requestId,
      });
      return;
    }

    // Normalize to 2 decimal places to satisfy numeric(10,2)
    amount = Number(amount.toFixed(2));

    const booking = purchaseDetails.booking || {};
    const tripRef = booking.reference || purchaseId;

    let origin = null;
    let destination = null;
    let departureTime = null;
    let arrivalTime = null;
    let provider = 'busbud';

    const tickets = Array.isArray(booking.tickets) ? booking.tickets : [];
    if (tickets.length > 0) {
      const firstTicket = tickets[0] || {};
      const segment = firstTicket.segment || firstTicket.trip || {};
      const segOrigin = segment.origin || segment.departure || {};
      const segDestination = segment.destination || segment.arrival || {};

      origin = segOrigin.name || segOrigin.city || null;
      destination = segDestination.name || segDestination.city || null;
      departureTime =
        segment.departure_time ||
        segment.departureTime ||
        segment.departure ||
        null;
      arrivalTime =
        segment.arrival_time ||
        segment.arrivalTime ||
        segment.arrival ||
        null;
      provider =
        segment.operator_name ||
        segment.operator ||
        (segment.operator && segment.operator.name) ||
        provider;
    }

    // Fallbacks for required trip fields
    if (!origin) {
      origin = purchaseDetails.origin_name || purchaseDetails.origin || 'UNKNOWN';
    }

    if (!destination) {
      destination = purchaseDetails.destination_name || purchaseDetails.destination || 'UNKNOWN';
    }

    if (!departureTime) {
      departureTime =
        purchaseDetails.departure_time ||
        purchaseDetails.departureTime ||
        purchaseDetails.completed_at ||
        purchaseDetails.created_at ||
        purchaseDetails.updated_at ||
        new Date().toISOString();
    }

    if (!arrivalTime) {
      arrivalTime =
        purchaseDetails.arrival_time ||
        purchaseDetails.arrivalTime ||
        departureTime;
    }

    const tripId = null;

    // Derive bookedBy: prefer agent email (header or Firestore) for reliable matching in reports
    let bookedBy = 'online';
    const ex = extraMeta || {};
    const exAgent = (ex.agent) || ex;
    const exModeRaw = exAgent && Object.prototype.hasOwnProperty.call(exAgent, 'agentMode') ? exAgent.agentMode : undefined;
    const exMode = exModeRaw === true || String(exModeRaw).toLowerCase() === 'true';
    if (exMode) {
      const exEmail = exAgent.agentEmail || exAgent.email || null;
      const exName = exAgent.agentName || exAgent.name || null;
      const exFirst = exAgent.firstName || exAgent.first_name || '';
      const exLast = exAgent.lastName || exAgent.last_name || '';
      const exCombined = [exFirst, exLast].filter(Boolean).join(' ').trim();
      if (exEmail && String(exEmail).trim()) {
        bookedBy = String(exEmail).trim().toLowerCase();
      } else if (exName && String(exName).trim()) {
        bookedBy = String(exName).trim();
      } else if (exCombined) {
        bookedBy = exCombined;
      } else {
        bookedBy = 'agent';
      }
    } else {
      try {
        const db = await getFirestore();
        const ref = (extraMeta && (extraMeta.paymentRef || extraMeta.firestoreCartId)) || null;
        const maybeCartId = (extraMeta && extraMeta.cartId) || null;
        let snap = null;
        if (ref) {
          snap = await db.collection('carts').doc(String(ref)).get();
        }
        if ((!snap || !snap.exists) && maybeCartId) {
          snap = await db.collection('carts').doc(String(maybeCartId)).get();
        }
        if (snap && snap.exists) {
          const cart = snap.data() || {};
          const aName = cart.agentName || (cart.agent && cart.agent.agentName) || null;
          const aEmail = cart.agentEmail || (cart.agent && cart.agent.agentEmail) || null;
          const rawMode = cart.agentMode;
          const aMode = rawMode === true || String(rawMode).toLowerCase() === 'true';
          if (aMode) {
            if (aEmail && String(aEmail).trim()) {
              bookedBy = String(aEmail).trim().toLowerCase();
            } else if (aName && String(aName).trim()) {
              bookedBy = String(aName).trim();
            } else {
              bookedBy = 'agent';
            }
          } else {
            bookedBy = 'online';
          }
        }
      } catch (_) { /* noop */ }
    }
    if (!bookedBy) bookedBy = 'online';

    let method =
      (purchaseDetails.payment && purchaseDetails.payment.method) ||
      (purchaseDetails.payment && purchaseDetails.payment.provider) ||
      'iou';

    const extra = extraMeta || {};
    if (extra && typeof extra.paymentMethod === 'string' && extra.paymentMethod.trim()) {
      method = extra.paymentMethod.trim();
    }
    const transactionRef =
      extra.paymentRef ||
      booking.reference ||
      purchaseDetails.reference ||
      purchaseId;

    const status = 'paid';

    await ensurePaymentsColumnsExist();

    const pricingFromCart = await loadPricingFromCartsTable({
      firestoreCartId: extra.firestoreCartId || extra.paymentRef || transactionRef,
      cartId: extra.cartId || purchaseDetails.cartId || purchaseDetails.cart_id || (booking && (booking.cartId || booking.cart_id)) || null
    });
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

    await drizzleDb
      .insert(payments)
      .values({
        tripId,
        amount,
        ...pricingVals,
        method,
        status,
        transactionRef,
        bookedBy,
        rawResponse: purchaseDetails
      })
      .onConflictDoUpdate({
        target: payments.transactionRef,
        set: {
          tripId,
          amount,
          ...pricingVals,
          method,
          status: 'paid',
          bookedBy,
          rawResponse: purchaseDetails
        }
      });
  } catch (err) {
    logger.error('Failed to persist purchase to Postgres/Drizzle', {
      message: err.message,
      stack: err.stack,
      purchaseId,
      purchaseUuid,
      requestId,
    });
  }
}

/**
 * Creates a new purchase in Busbud
 * @param {string} cartId - The cart ID to create purchase for
 * @param {Object} options - Purchase options
 * @param {string} options.locale - Locale for the purchase (default: 'en-ca')
 * @param {string} options.currency - Currency for the purchase (default: 'USD')
 * @param {string} options.returnUrl - Return URL after payment
 * @param {boolean} options.skipValidation - Skip cart validation (default: false)
 * @returns {Promise<Object>} The created purchase details
 */
export async function createPurchase(cartId, options = {}) {
  const requestId = `create-${Date.now()}`;
  logger.info(`[${requestId}] Creating purchase for cart: ${cartId}`, { options });

  try {
    // 1. Create the purchase in Busbud (handles saving to database)
    logger.info(`[${requestId}] Calling BusbudService.createPurchase`);
    const purchaseResponse = await BusbudService.createPurchase(cartId, {
      locale: options.locale || 'en-ca',
      currency: options.currency || 'USD',
      returnUrl: options.returnUrl,
      skipValidation: options.skipValidation || false
    });

    // Unwrap BusbudService result shape and extract purchase identifiers
    if (!purchaseResponse || purchaseResponse.success === false) {
      const errMsg = purchaseResponse?.error || 'Unknown error from BusbudService.createPurchase';
      throw new Error(errMsg);
    }

    const resp = purchaseResponse.data || purchaseResponse;

    // Extract purchase ID and UUID from the unwrapped payload
    const purchaseId = resp.id || resp.purchase_id || resp.purchase?.id;
    const purchaseUuid = resp.uuid || resp.purchase_uuid || resp.purchase?.uuid;

    if (!purchaseId || !purchaseUuid) {
      throw new Error('Failed to extract purchase ID or UUID from response');
    }

    logger.info(`[${requestId}] Purchase created successfully`, {
      purchaseId,
      purchaseUuid,
      status: resp.status
    });

    return {
      success: true,
      message: 'Purchase created successfully',
      data: {
        ...resp,
        id: purchaseId,
        uuid: purchaseUuid
      }
    };
  } catch (error) {
    logger.error(`[${requestId}] Failed to create purchase`, {
      error: error.message,
      stack: error.stack,
      cartId,
      options
    });
    
    throw new Error(`Failed to create purchase: ${error.message}`);
  }
}

// ----------------------------
// 🔧 Purchase completion function (completes existing purchases)
// Enhanced logging includes:
// - Request payloads and headers
// - Busbud API responses
// - Detailed error information with stack traces
// - Performance timing
// - Step-by-step execution flow
// Flow: getPurchase() -> save to memory -> optionally persist to Firestore -> return response
// extraMeta can include context like paymentRef (PNR) and cartId for analytics.
// ----------------------------
export async function completePurchase(purchaseId, purchaseUuid, requestId, startTime, extraMeta = {}) {
  try {
    if (!purchaseId || !purchaseUuid) {
      throw new Error('Both purchaseId and purchaseUuid are required');
    }

    console.log(`\n=== COMPLETE PURCHASE FUNCTION ===`);
    console.log(`[${requestId}] 🚀 Starting purchase completion for:`, { 
      purchaseId, 
      purchaseUuid: purchaseUuid ? `${purchaseUuid.substring(0, 8)}...` : 'undefined'
    });
    
    logger.info(`🚀 [${requestId}] Completing purchase`, { 
      purchaseId,
      purchaseUuid: purchaseUuid ? `${purchaseUuid.substring(0, 8)}...` : 'undefined'
    });

    // Step 1: Get complete purchase details immediately (no polling)
    let purchaseDetails;
    let pollOutcome = 'unknown';
    let statusSnapshot = null;
    let completedDuringPoll = false;

    console.log(`\n=== PURCHASE STATUS POLLING ===`);
    console.log(`[${requestId}] Starting Busbud purchase status polling...`);

    try {
      const pollResult = await pollBusbudPurchaseStatus(purchaseId, purchaseUuid, requestId, {
        maxAttempts: extraMeta && extraMeta.busbudStatusMaxAttempts != null ? extraMeta.busbudStatusMaxAttempts : undefined,
        intervalMs: extraMeta && extraMeta.busbudStatusIntervalMs != null ? extraMeta.busbudStatusIntervalMs : undefined,
      });
      pollOutcome = pollResult?.outcome || 'unknown';
      statusSnapshot = pollResult?.lastStatus || null;

      console.log(`[${requestId}] 🔁 Poll outcome:`, JSON.stringify({
        outcome: pollOutcome,
        normalized: pollResult?.normalized || null
      }, null, 2));

      completedDuringPoll =
        pollOutcome === 'completed' ||
        (pollResult?.normalized?.state === 'completed');

      if (completedDuringPoll) {
        console.log(`[${requestId}] ✅ Purchase status is completed. Fetching final purchase details...`);
        console.log(`[${requestId}] 📞 Calling BusbudService.getPurchase(${purchaseId}, ${purchaseUuid})`);
        purchaseDetails = await BusbudService.getPurchase(purchaseId, purchaseUuid);
        console.log(`[${requestId}] 📥 Final purchase details retrieved successfully (redacted)`, {
          hasCharges: !!purchaseDetails?.charges,
          hasBooking: !!purchaseDetails?.booking,
          status: purchaseDetails?.status
        });
      } else {
        console.log(`[${requestId}] ⚠️ Purchase did not reach completed state during polling (outcome=${pollOutcome}).`);
        purchaseDetails = {
          status: 'failed'
        };
      }
    } catch (detailsError) {
      console.log(`[${requestId}] ❌ Failed during purchase status polling or details retrieval:`, detailsError.message);
      console.log(`[${requestId}] Error details:`, JSON.stringify(detailsError, null, 2));

      logger.warn(`⚠️ [${requestId}] Failed during purchase status polling or details retrieval:`, {
        error: detailsError.message,
        stack: detailsError.stack,
        purchaseId,
        purchaseUuid
      });

      throw detailsError; // Re-throw since we can't continue without details
    }

    // Step 2: Check if purchase is already completed to prevent duplicates
    console.log(`\n=== CHECK FOR DUPLICATES ===`);
    console.log(`[${requestId}] Checking if purchase ${purchaseId} exists in memory`);

    const existingPurchase = await getCart(purchaseId);
    if (existingPurchase && existingPurchase.status === 'purchase_completed') {
      console.log(`[${requestId}] 🚫 Purchase already completed, skipping save`);
      console.log(`[${requestId}] Existing status: ${existingPurchase.status}`);
      console.log(`[${requestId}] Returning existing data`);

      return {
        success: true,
        message: 'Purchase already completed',
        purchase: {
          id: purchaseId,
          uuid: purchaseUuid,
          status: existingPurchase.purchaseStatus?.status || existingPurchase.status,
          totalPrice: existingPurchase.purchaseStatus?.total || existingPurchase.totalPrice,
          currency: existingPurchase.purchaseStatus?.currency || existingPurchase.currency || 'USD',
          paymentUrl: existingPurchase.purchaseStatus?.paymentUrl || existingPurchase.paymentUrl,
          createdAt: existingPurchase.purchaseStatus?.created_at || existingPurchase.createdAt,
          updatedAt: existingPurchase.purchaseStatus?.updated_at || existingPurchase.updatedAt
        },
        booking: existingPurchase.purchaseStatus?.booking || existingPurchase.booking || null,
        requestId,
        timestamp: new Date().toISOString(),
        note: 'Already completed - no action taken'
      };
    }

    console.log(`[${requestId}] ✅ Purchase not completed yet, proceeding with save`);

    // Step 3: Save purchase to memory
    console.log(`\n=== SAVING PURCHASE ===`);
    console.log(`[${requestId}] Saving purchase to memory...`);

    try {
      const dataToSave = {
        // Preserve existing cart stages
        ...existingPurchase,
        // Purchase completion stage
        purchase: {
          purchaseId: purchaseId,
          purchaseUuid: purchaseUuid,
          purchaseStatus: purchaseDetails,
          purchaseDetails: purchaseDetails,
          timestamp: new Date().toISOString()
        },
        // Update metadata
        status: completedDuringPoll ? 'purchase_completed' : 'purchase_failed',
        updatedAt: new Date().toISOString()
      };

      console.log(`[${requestId}] 💾 Saving to memory:`, JSON.stringify(dataToSave, null, 2));

      await saveCart(dataToSave);

      console.log(`[${requestId}] ✅ Purchase saved with ID: ${purchaseId}`);

    } catch (error) {
      console.log(`[${requestId}] ❌ Failed to save purchase:`, error.message);
      logger.error(`❌ [${requestId}] Failed to save purchase:`, {
        error: error.message,
        stack: error.stack,
        purchaseId,
        purchaseUuid
      });
      // Continue even if save fails
    }

    // Step 4: Log final purchase state
    console.log(`\n=== FINAL PURCHASE STATE ===`);
    console.log(`[${requestId}] Final purchase state (redacted)`, {
      status: purchaseDetails?.status,
      hasCharges: !!purchaseDetails?.charges,
      hasBooking: !!purchaseDetails?.booking
    });

    // Step 5: Persist full Busbud purchase response into Firestore (best-effort)
    try {
      const db = await getFirestore();
      const { paymentRef, cartId } = extraMeta || {};

      const ticketDocId = String(
        paymentRef ||
          (purchaseDetails && (purchaseDetails.reference || purchaseDetails.id)) ||
          purchaseId
      );

      const now = new Date();
      const paymentTsRaw =
        (purchaseDetails &&
          (purchaseDetails.completed_at || purchaseDetails.created_at || purchaseDetails.updated_at)) ||
        now.toISOString();
      const paymentDateObj = new Date(paymentTsRaw);
      const paymentDate = !Number.isNaN(paymentDateObj.getTime())
        ? paymentDateObj.toISOString()
        : now.toISOString();
      const paymentDateKey = paymentDate.slice(0, 10);

      const branchCode = deriveBranchFromId(paymentRef || cartId || purchaseId);

      const frontendBase = process.env.FRONTEND_URL || 'https://your-app.com';
      const firestoreTicket = cartId
        ? `${frontendBase}/tickets/${encodeURIComponent(cartId)}`
        : null;

      const priceTotals = computeAdjustedTotalsFromPurchase(purchaseDetails);

      const docCurrency = (priceTotals && priceTotals.currency) ||
        (purchaseDetails && purchaseDetails.summary && purchaseDetails.summary.currency) ||
        (purchaseDetails && purchaseDetails.charges && purchaseDetails.charges.currency) ||
        'USD';

      const isCompletedPurchase = (() => {
        // Primary signal: polling outcome from Busbud status API
        if (pollOutcome === 'completed') return true;

        // Fallback: inspect detailed purchase payload for a completed-like status
        const rawStatus =
          purchaseDetails &&
          (purchaseDetails.status || purchaseDetails.purchase_state || purchaseDetails.tickets_state) ||
          '';
        const normalized = rawStatus.toString().toLowerCase();
        return normalized === 'completed' || normalized === 'booked' || normalized === 'confirmed';
      })();

      const collectionName = isCompletedPurchase
        ? 'tickets'
        : 'failed_tickets';

      const ticketDoc = {
        purchaseId,
        purchaseUuid,
        paymentRef: paymentRef || null,
        cartId: cartId || null,
        branchCode: branchCode || null,
        paymentDate,
        paymentDateKey,
        status: purchaseDetails && purchaseDetails.status ? purchaseDetails.status : null,
        currency: docCurrency,
        originalTotal: priceTotals ? priceTotals.originalTotal : null,
        adjustedTotal: priceTotals ? priceTotals.adjustedTotal : null,
        totalAdjustment: priceTotals ? priceTotals.totalAdjustment : null,
        createdAt: new Date().toISOString(),
        source: 'busbud_purchase',
        firestoreTicket,
        busbudPurchase: isCompletedPurchase ? (purchaseDetails || null) : null,
      };

      await db.collection(collectionName).doc(ticketDocId).set(ticketDoc, { merge: true });
      logger.info(`✅ [${requestId}] Stored Busbud purchase in Firestore ${collectionName} collection`, {
        ticketDocId,
        purchaseId,
        paymentRef: paymentRef || null,
      });
    } catch (firestoreErr) {
      logger.warn(`⚠️ [${requestId}] Failed to persist purchase to Firestore tickets/failed_tickets collection`, {
        error: firestoreErr.message,
      });
    }

    try {
      await savePurchaseToPostgres(
        purchaseId,
        purchaseUuid,
        purchaseDetails,
        extraMeta,
        pollOutcome,
        requestId,
      );
    } catch (persistErr) {
      logger.warn('Failed to persist purchase to Postgres (non-blocking)', {
        message: persistErr.message,
        purchaseId,
        purchaseUuid,
        requestId,
      });
    }

    const responseTime = Date.now() - startTime;
    console.log(`[${requestId}] ⏱️ Total completion time: ${responseTime}ms`);
    logger.info(`✅ [${requestId}] Purchase processed successfully in ${responseTime}ms`, { pollOutcome });

    const topLevelStatus = purchaseDetails && purchaseDetails.status ? purchaseDetails.status : null;

    if (!completedDuringPoll) {
      return {
        success: false,
        statusCode: 409,
        error: 'BUSBUD_PURCHASE_FAILED',
        message: 'Busbud purchase did not complete',
        status: topLevelStatus,
        pollOutcome,
        purchase: {
          id: purchaseId,
          uuid: purchaseUuid,
        },
        requestId,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      success: true,
      message: 'Purchase processed successfully',
      status: topLevelStatus,
      pollOutcome,
      purchase: {
        id: purchaseId,
        uuid: purchaseUuid,
        status: purchaseDetails.status,
        paymentUrl: purchaseDetails.payment?.url,
        totalPrice: purchaseDetails.charges?.total,
        currency: purchaseDetails.charges?.currency || 'USD',
        booking: purchaseDetails.booking ? {
          id: purchaseDetails.booking.id,
          reference: purchaseDetails.booking.reference,
          status: purchaseDetails.booking.status,
          tickets: purchaseDetails.booking.tickets
        } : null,
        requestId,
        timestamp: new Date().toISOString(),
        nextSteps: (() => {
          if (purchaseDetails.status === 'completed' || purchaseDetails.status === 'booked') {
            return ['Purchase completed successfully', 'Booking confirmation sent to email'];
          } else if (purchaseDetails.status === 'pending') {
            return ['Purchase is still processing', 'Check status again in a few minutes'];
          } else {
            return ['Review purchase details', 'Contact support if needed'];
          }
        })()
      }
    };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`[${requestId}] 💥 CRITICAL ERROR in completePurchase function:`);
    console.log(`[${requestId}] Error Name:`, error.name);
    console.log(`[${requestId}] Error Message:`, error.message);
    console.log(`[${requestId}] Error Stack:`, error.stack);

    logger.error(`❌ [${requestId}] Purchase error after ${responseTime}ms:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      purchaseId,
      purchaseUuid
    });

    // Enhanced error logging for Busbud API errors
    if (error.response) {
      console.log(`\n=== BUSBUD API ERROR ===`);
      console.log(`[${requestId}] API Error Details:`, {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
        headers: error.response.headers
      });
    }

    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        type: 'PURCHASE_ERROR',
        code: error.code || 'UNKNOWN_ERROR'
      },
      purchase: {
        id: purchaseId,
        uuid: purchaseUuid
      },
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Verify purchase ID is correct and purchase was created successfully',
        'Ensure purchase is still valid and not expired',
        'Check purchase details and try again'
      ]
    };

    // Return appropriate HTTP status based on error type
    const statusCode = error.response?.status === 404 ? 404 :
                      error.response?.status === 401 ? 401 :
                      error.response?.status === 400 ? 400 :
                      error.response?.status === 409 ? 409 :
                      error.response?.status === 410 ? 410 : 500;

    return errorResponse;
  }
}

/**
 * @route   POST /api/purchase
 * @desc    Process a purchase
 * @access  Public
 * @body    {string} purchaseId - The purchase ID
 * @body    {string} purchaseUuid - The purchase UUID
 * @returns {Object} The purchase details and status
 */
router.post('/', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { purchaseId, purchaseUuid } = req.body;

  const isProduction = process.env.NODE_ENV === 'production';

  // 📊 Enhanced logging - Show actual request payload
  if (!isProduction) {
    console.log(`\n=== INCOMING REQUEST ===`);
    console.log(`[${requestId}] 📨 HTTP Method: ${req.method}`);
    console.log(`[${requestId}] 🔗 URL: ${req.originalUrl}`);
    console.log(`[${requestId}] 📦 Raw Request Body:`, JSON.stringify(req.body, null, 2));
    console.log(`[${requestId}] 📦 Request Keys:`, Object.keys(req.body || {}));
    console.log(`[${requestId}] 📦 Purchase ID Type:`, typeof purchaseId);
    console.log(`[${requestId}] 📦 Purchase ID Value:`, purchaseId);
    console.log(`[${requestId}] 📦 Purchase UUID Type:`, typeof purchaseUuid);
    console.log(`[${requestId}] 📦 Purchase UUID Value:`, purchaseUuid);
    console.log(`[${requestId}] 📦 Query Params:`, JSON.stringify(req.query, null, 2));
    console.log(`[${requestId}] 👤 Headers:`, JSON.stringify({
      'content-type': req.get('content-type'),
      'user-agent': req.get('user-agent'),
      'origin': req.get('origin'),
      'referer': req.get('referer'),
      'content-length': req.get('content-length')
    }, null, 2));
  }

  // 🔍 DEBUG SPECIFIC ISSUE: Check if purchaseId is the literal string "undefined"
  if (purchaseId === "undefined") {
    if (!isProduction) {
      console.log(`[${requestId}] 🚨 CRITICAL: Frontend is sending purchaseId as literal string "undefined"`);
      console.log(`[${requestId}] This usually means frontend is doing: purchaseId: purchaseId.toString() when purchaseId is undefined`);
    }
  }

  if (typeof purchaseId === 'undefined') {
    if (!isProduction) {
      console.log(`[${requestId}] 🚨 CRITICAL: purchaseId is actually undefined`);
      console.log(`[${requestId}] This means frontend is not sending purchaseId field at all`);
    }
  }

  logger.info(`💰 [${requestId}] Purchase completion request initiated`, {
    purchaseId,
    purchaseUuid,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestBody: isProduction ? undefined : req.body,
    headers: isProduction ? undefined : req.headers
  });

  // --- Validation ---
  if (!purchaseId || purchaseId === "undefined" || (typeof purchaseId === 'string' && purchaseId.trim() === '')) {
    if (!isProduction) {
      console.log(`[${requestId}] ❌ VALIDATION ERROR: Missing or invalid purchase ID`);
      console.log(`[${requestId}] 📦 Full request body received:`, req.body);
      console.log(`[${requestId}] 📦 Body is empty:`, !req.body || Object.keys(req.body).length === 0);
      console.log(`[${requestId}] 📦 PurchaseId value: "${purchaseId}" (type: ${typeof purchaseId})`);
      console.log(`[${requestId}] 📦 Is literal "undefined":`, purchaseId === "undefined");
      console.log(`[${requestId}] 📦 Is empty string:`, purchaseId === '');
    }
    logger.warn(`⚠️ [${requestId}] Missing purchase ID`);

    const errorResponse = {
      success: false,
      error: 'Missing required parameter',
      missingParameter: 'purchaseId',
      requestId,
      timestamp: new Date().toISOString(),
      debugInfo: isProduction ? undefined : {
        requestBody: req.body,
        headers: req.headers,
        bodyKeys: Object.keys(req.body || {}),
        purchaseIdValue: purchaseId,
        purchaseIdType: typeof purchaseId,
        purchaseUuidValue: purchaseUuid,
        purchaseUuidType: typeof purchaseUuid,
        isLiteralUndefined: purchaseId === "undefined",
        isEmptyString: purchaseId === '',
        isTrimmedEmpty: typeof purchaseId === 'string' && purchaseId.trim() === ''
      },
      suggestions: [
        'Ensure purchaseId is included in request body',
        'Check frontend code for purchaseId parameter',
        'Verify addTripDetails returned a purchase ID',
        'Check if frontend is sending JSON with correct Content-Type header',
        'Expected format: {"purchaseId": "your-purchase-id", "purchaseUuid": "optional-uuid"}',
        'If you see purchaseId as "undefined", check frontend for: purchaseId: purchaseId.toString() when purchaseId is undefined'
      ]
    };

    return res.status(400).json(errorResponse);
  }


  // Additional validation for purchaseId format
  if (typeof purchaseId !== 'string') {
    if (!isProduction) {
      console.log(`[${requestId}] ❌ VALIDATION ERROR: Invalid purchase ID format`);
      console.log(`[${requestId}] 📦 PurchaseId type: ${typeof purchaseId}, value: "${purchaseId}"`);
    }

    const errorResponse = {
      success: false,
      error: 'Invalid purchase ID format',
      details: 'purchaseId must be a string',
      requestId,
      timestamp: new Date().toISOString(),
      debugInfo: isProduction ? undefined : {
        purchaseIdValue: purchaseId,
        purchaseIdType: typeof purchaseId
      },
      suggestions: [
        'purchaseId must be a valid string identifier',
        'Check that addTripDetails returned a proper purchase ID',
        'Ensure frontend is not sending null or undefined values'
      ]
    };

    return res.status(400).json(errorResponse);
  }

  console.log(`[${requestId}] ✅ Validation passed - purchaseId: ${purchaseId}`);

  try {
    console.log(`[${requestId}] 🚀 Calling completePurchase function...`);
    const h = req.headers || {};
    const modeHdr = (req.get && req.get('x-agent-mode')) || h['x-agent-mode'];
    const nameHdr = (req.get && req.get('x-agent-name')) || h['x-agent-name'];
    const emailHdr = (req.get && req.get('x-agent-email')) || h['x-agent-email'];
    const idHdr = (req.get && req.get('x-agent-id')) || h['x-agent-id'];
    const resolvedMode = String(modeHdr).toLowerCase() === 'true';
    const extraMeta = {
      agentMode: resolvedMode,
      agentName: nameHdr || null,
      agentEmail: emailHdr || null,
      agentId: idHdr || null,
    };
    const result = await completePurchase(purchaseId, purchaseUuid, requestId, startTime, extraMeta);

    console.log(`[${requestId}] 📤 Final response:`, JSON.stringify(result, null, 2));

    if (result.success) {
      res.json(result);
    } else {
      console.log(`[${requestId}] ❌ Function returned error:`, JSON.stringify(result.error, null, 2));
      res.status(result.statusCode || 500).json(result.error);
    }
  } catch (error) {
    console.log(`[${requestId}] 💥 UNEXPECTED ERROR in route handler:`);
    console.log(`[${requestId}] Error Name:`, error.name);
    console.log(`[${requestId}] Error Message:`, error.message);
    console.log(`[${requestId}] Error Stack:`, error.stack);

    logger.error(`💥 [${requestId}] Unexpected error in purchase route:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      purchaseId,
      purchaseUuid,
      requestBody: req.body
    });

    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error occurred',
        type: 'INTERNAL_SERVER_ERROR',
        details: error.message
      },
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// ----------------------------
// 📊 GET /api/purchase/:purchaseId/status
// Polls purchase status using BusbudService.getPurchaseStatus()
// Enhanced logging: Shows API responses, errors with stack traces
// Query params: ?purchaseUuid=string (optional)
// ----------------------------
router.get('/:purchaseId/status', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { purchaseId } = req.params;
  const { purchaseUuid } = req.query;

  // 📊 Enhanced logging - Show request details
  console.log(`\n=== STATUS REQUEST ===`);
  console.log(`[${requestId}] 📨 HTTP Method: ${req.method}`);
  console.log(`[${requestId}] 🔗 URL: ${req.originalUrl}`);
  console.log(`[${requestId}] 📦 Params:`, JSON.stringify(req.params, null, 2));
  console.log(`[${requestId}] 📦 Query:`, JSON.stringify(req.query, null, 2));

  logger.info(`📊 [${requestId}] Purchase status request`, {
    purchaseId,
    purchaseUuid,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    params: req.params,
    query: req.query
  });

  if (!purchaseId) {
    console.log(`[${requestId}] ❌ VALIDATION ERROR: Missing purchase ID`);
    return res.status(400).json({
      success: false,
      error: 'Missing purchase ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Ensure purchaseId is included in URL path',
        'Check frontend code for purchaseId parameter'
      ]
    });
  }

  try {
    console.log(`[${requestId}] 📞 Calling BusbudService.getPurchaseStatus(${purchaseId}, ${purchaseUuid})`);
    const purchaseStatus = await BusbudService.getPurchaseStatus(purchaseId, purchaseUuid);

    console.log(`[${requestId}] 📥 Busbud API Response:`, JSON.stringify(purchaseStatus, null, 2));
    console.log(`[${requestId}] ✅ Purchase status retrieved successfully`);

    const responseTime = Date.now() - startTime;
    logger.info(`✅ [${requestId}] Purchase status retrieved successfully in ${responseTime}ms`);

    res.json({
      success: true,
      purchase: {
        id: purchaseId,
        uuid: purchaseUuid,
        status: purchaseStatus.status,
        totalPrice: purchaseStatus.charges?.total,
        currency: purchaseStatus.charges?.currency || 'USD'
      },
      booking: purchaseStatus.booking ? {
        id: purchaseStatus.booking.id,
        reference: purchaseStatus.booking.reference,
        status: purchaseStatus.booking.status
      } : null,
      requestId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`[${requestId}] ❌ Purchase status error after ${responseTime}ms:`);
    console.log(`[${requestId}] Error Name:`, error.name);
    console.log(`[${requestId}] Error Message:`, error.message);
    console.log(`[${requestId}] Error Stack:`, error.stack);

    if (error.response) {
      console.log(`[${requestId}] 📥 Busbud API Error:`, JSON.stringify(error.response.data, null, 2));
    }

    logger.error(`❌ [${requestId}] Purchase status error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      purchaseId,
      purchaseUuid
    });

    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        type: 'PURCHASE_STATUS_ERROR'
      },
      requestId,
      timestamp: new Date().toISOString()
    };

    const statusCode = error.response?.status === 404 ? 404 :
                      error.response?.status === 401 ? 401 :
                      error.response?.status === 403 ? 403 : 500;

    return res.status(statusCode).json(errorResponse);
  }
});

// ----------------------------
// 📋 GET /api/purchase/:purchaseId
// Gets complete purchase details using BusbudService.getPurchase()
// Enhanced logging: Shows API responses, errors with stack traces
// Query params: ?purchaseUuid=string (optional)
// ----------------------------
router.get('/:purchaseId', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { purchaseId } = req.params;
  const { purchaseUuid } = req.query;

  // 📊 Enhanced logging - Show request details
  console.log(`\n=== DETAILS REQUEST ===`);
  console.log(`[${requestId}] 📨 HTTP Method: ${req.method}`);
  console.log(`[${requestId}] 🔗 URL: ${req.originalUrl}`);
  console.log(`[${requestId}] 📦 Params:`, JSON.stringify(req.params, null, 2));
  console.log(`[${requestId}] 📦 Query:`, JSON.stringify(req.query, null, 2));

  logger.info(`📋 [${requestId}] Purchase details request`, {
    purchaseId,
    purchaseUuid,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    params: req.params,
    query: req.query
  });

  if (!purchaseId) {
    console.log(`[${requestId}] ❌ VALIDATION ERROR: Missing purchase ID`);
    return res.status(400).json({
      success: false,
      error: 'Missing purchase ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Ensure purchaseId is included in URL path',
        'Check frontend code for purchaseId parameter'
      ]
    });
  }

  try {
    console.log(`[${requestId}] 📞 Calling BusbudService.getPurchase(${purchaseId}, ${purchaseUuid})`);
    const purchaseDetails = await BusbudService.getPurchase(purchaseId, purchaseUuid);

    console.log(`[${requestId}] 📥 Purchase details retrieved successfully:`, JSON.stringify(purchaseDetails, null, 2));

    const responseTime = Date.now() - startTime;
    logger.info(`✅ [${requestId}] Purchase details retrieved successfully in ${responseTime}ms`);

    res.json({
      success: true,
      purchase: {
        id: purchaseId,
        uuid: purchaseUuid,
        status: purchaseDetails.status,
        totalPrice: purchaseDetails.charges?.total,
        currency: purchaseDetails.charges?.currency || 'USD',
        createdAt: purchaseDetails.created_at,
        updatedAt: purchaseDetails.updated_at,
      },
      booking: purchaseDetails.booking ? {
        id: purchaseDetails.booking.id,
        reference: purchaseDetails.booking.reference,
        status: purchaseDetails.booking.status,
        tickets: purchaseDetails.booking.tickets
      } : null,
      requestId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`[${requestId}] ❌ Purchase details error after ${responseTime}ms:`);
    console.log(`[${requestId}] Error Name:`, error.name);
    console.log(`[${requestId}] Error Message:`, error.message);
    console.log(`[${requestId}] Error Stack:`, error.stack);

    if (error.response) {
      console.log(`[${requestId}] 📥 Busbud API Error:`, JSON.stringify(error.response.data, null, 2));
    }

    logger.error(`❌ [${requestId}] Purchase details error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      purchaseId,
      purchaseUuid
    });

    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        type: 'PURCHASE_DETAILS_ERROR'
      },
      requestId,
      timestamp: new Date().toISOString()
    };

    const statusCode = error.response?.status === 404 ? 404 :
                      error.response?.status === 401 ? 401 :
                      error.response?.status === 403 ? 403 : 500;

    return res.status(statusCode).json(errorResponse);
  }
});

// ----------------------------
// 🔧 POST /api/purchase/debug
// Debug endpoint to see exactly what frontend is sending
// Shows request body, headers, and validates required parameters
// Proper validation: Strict validation without fallbacks
// Expected request body: { purchaseId: "string", purchaseUuid?: "string" }
// Useful for troubleshooting frontend integration issues
// ----------------------------
router.post('/debug', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  console.log(`\n=== DEBUG REQUEST ===`);
  console.log(`[${requestId}] 📨 HTTP Method: ${req.method}`);
  console.log(`[${requestId}] 🔗 URL: ${req.originalUrl}`);
  console.log(`[${requestId}] 📦 Raw Request Body:`, JSON.stringify(req.body, null, 2));
  console.log(`[${requestId}] 📦 Request Keys:`, Object.keys(req.body || {}));
  console.log(`[${requestId}] 📦 Query Params:`, JSON.stringify(req.query, null, 2));

  // Extract purchaseId and purchaseUuid from expected locations only
  const purchaseId = req.body.purchaseId;
  const purchaseUuid = req.body.purchaseUuid;

  console.log(`[${requestId}] 🔍 Extracted purchaseId:`, purchaseId);
  console.log(`[${requestId}] 🔍 Extracted purchaseUuid:`, purchaseUuid);

  // Validate that required fields are present
  if (!purchaseId) {
    console.log(`[${requestId}] ❌ DEBUG VALIDATION ERROR: Missing purchase ID`);
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter in debug request',
      missingParameter: 'purchaseId',
      requestId,
      timestamp: new Date().toISOString(),
      debugInfo: {
        requestBody: req.body,
        queryParams: req.query,
        headers: req.headers,
        bodyKeys: Object.keys(req.body || {}),
        queryKeys: Object.keys(req.query || {}),
        purchaseIdValue: purchaseId,
        purchaseIdType: typeof purchaseId,
        purchaseUuidValue: purchaseUuid,
        purchaseUuidType: typeof purchaseUuid
      },
      suggestions: [
        'Ensure purchaseId is included in request body as {"purchaseId": "your-id"}',
        'Check frontend code for correct field names',
        'Use this endpoint to test your frontend requests before using main endpoint'
      ]
    });
  }

  res.json({
    success: true,
    message: 'Debug info logged to console',
    requestBody: req.body,
    queryParams: req.query,
    headers: req.headers,
    extracted: {
      purchaseId: purchaseId,
      purchaseUuid: purchaseUuid
    },
    suggestions: [
      'Check console logs for detailed request information',
      'If purchaseId is missing, check frontend code',
      'Verify addTripDetails returned purchase information'
    ],
    requestId,
    timestamp: new Date().toISOString()
  });
});

export default router;
