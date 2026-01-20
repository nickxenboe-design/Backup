import express from 'express';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';
import logger from '../utils/logger.js';
import drizzleDb, { payments, carts } from '../db/drizzleClient.js';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';

const getPassengerRetailPrice = (p) => {
  if (!p || typeof p !== 'object') return null;
  const pricing = p.pricing && typeof p.pricing === 'object' ? p.pricing : null;
  const raw =
    (pricing && (pricing.retail_price ?? pricing.retailPrice ?? pricing.cost_price ?? pricing.costPrice)) ??
    p.retail_price ??
    p.retailPrice ??
    p.price ??
    p.fare ??
    null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const getPassengerIdLike = (p) => {
  if (!p || typeof p !== 'object') return null;
  const pid = p.id ?? p.passengerId ?? p.passenger_id ?? (p.passenger && p.passenger.id) ?? null;
  return pid != null ? String(pid) : null;
};

const router = express.Router();

// All report routes require an authenticated, registered admin
router.use(verifyFirebaseAuth, requireRegisteredAdminApi);

// Helper to build an array of date strings (YYYY-MM-DD) for the given range
function buildDateRange(days) {
  const out = [];
  const today = new Date();
  const baseUtcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseUtcMidnight);
    d.setUTCDate(baseUtcMidnight.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function computeUtcRangeBounds({ rangeKey, specificDate, dateFrom, dateTo } = {}) {
  try {
    const rk = String(rangeKey || 'all').toLowerCase();
    const now = new Date();
    const utcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    if (specificDate) {
      const day = String(specificDate).slice(0, 10);
      return {
        start: new Date(`${day}T00:00:00.000Z`),
        end: new Date(`${day}T23:59:59.999Z`),
      };
    }

    if (dateFrom && dateTo) {
      const df = String(dateFrom).slice(0, 10);
      const dt = String(dateTo).slice(0, 10);
      return {
        start: new Date(`${df}T00:00:00.000Z`),
        end: new Date(`${dt}T23:59:59.999Z`),
      };
    }

    if (rk === 'today') {
      return { start: utcMidnight(now), end: now };
    }
    if (rk === '7d') {
      const start = utcMidnight(now);
      start.setUTCDate(start.getUTCDate() - 6);
      return { start, end: now };
    }
    if (rk === '30d') {
      const start = utcMidnight(now);
      start.setUTCDate(start.getUTCDate() - 29);
      return { start, end: now };
    }
    return { start: null, end: null };
  } catch (_) {
    return { start: null, end: null };
  }
}

function deriveOperatorFromPurchase(purchase) {
  if (!purchase || typeof purchase !== 'object') return 'unknown';
  try {
    const booking = purchase.booking || {};
    const items = Array.isArray(purchase.items) ? purchase.items : [];
    let operatorName = null;

    const firstItem = items[0] || null;
    if (firstItem && firstItem.trip) {
      const tripKey = firstItem.trip.id || firstItem.trip.trip_id || firstItem.trip.tripId;
      const tripsMap = purchase.trips && typeof purchase.trips === 'object' ? purchase.trips : {};
      const trip = tripKey && tripsMap[tripKey] ? tripsMap[tripKey] : null;
      if (trip && Array.isArray(trip.segments) && trip.segments.length) {
        const seg = trip.segments[0] || {};
        const segOperator = seg.operator || {};
        operatorName =
          seg.operator_name ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOperator.name ||
          segOperator.label ||
          segOperator.operator_name ||
          operatorName;
      }
    }

    if (!operatorName && Array.isArray(booking.tickets)) {
      const ticketsArr = booking.tickets;
      if (ticketsArr.length > 0) {
        const firstTicket = ticketsArr[0] || {};
        const seg = firstTicket.segment || firstTicket.trip || {};
        const segOp = seg.operator || {};
        operatorName =
          seg.operator_name ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOp.name ||
          segOp.label ||
          segOp.operator_name ||
          operatorName;
      }
    }

    if (!operatorName) {
      operatorName =
        booking.operator_name ||
        (typeof booking.operator === 'string' ? booking.operator : null) ||
        (purchase.operator && (purchase.operator.name || purchase.operator.label || purchase.operator.operator_name)) ||
        purchase.operator_name ||
        null;
    }

    if (!operatorName) return 'unknown';
    return String(operatorName).trim() || 'unknown';
  } catch (_) {
    return 'unknown';
  }
}

function deriveRawAndAdjustedFromRow(row) {
  const purchase = row && row.rawResponse ? row.rawResponse : {};
  const summary = purchase && purchase.summary ? purchase.summary : {};
  const charges = purchase && purchase.charges ? purchase.charges : {};
  let baseTotal = null;
  if (typeof summary.total === 'number') {
    baseTotal = summary.total;
  } else if (typeof charges.total === 'number') {
    baseTotal = charges.total;
  } else if (typeof charges.amount === 'number') {
    baseTotal = charges.amount;
  }
  let busbudRaw = null;
  if (baseTotal != null && Number.isFinite(baseTotal)) {
    busbudRaw = baseTotal / 100;
  }
  const adjusted = Number((row && row.amount) || 0);
  return { busbudRaw, adjusted };
}

// GET /api/admin/reports/sales-summary
// Returns a high-level summary of ticket sales based on the Postgres `payments`
// table, which stores Busbud purchase snapshots. Response shape is preserved
// for the existing admin dashboard.
// Supports optional:
//   ?range=all|today|7d|30d (default: all)
//   ?operator=<string> (matched case-insensitively against operator label)
//   ?branch=<branchCode>
//   ?paymentType=<string>
//   ?date=YYYY-MM-DD (overrides range for a specific payment date)
router.get('/sales-summary', async (req, res) => {
  try {
    // Prevent caching for frequently-updated reporting data
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    // Force a fresh ETag on each request to avoid 304 Not Modified responses
    res.set('ETag', `${Date.now()}`);

    const rangeKey = String(req.query.range || 'all').toLowerCase();
    const operatorFilter = req.query.operator ? String(req.query.operator).trim().toLowerCase() : null;
    const branchFilter = req.query.branch ? String(req.query.branch).trim() : null;
    const paymentTypeFilter = req.query.paymentType ? String(req.query.paymentType).trim().toLowerCase() : null;
    const specificDate = req.query.date ? String(req.query.date).slice(0, 10) : null;
    const dateFrom = req.query.dateFrom
      ? String(req.query.dateFrom).slice(0, 10)
      : (req.query.startDate ? String(req.query.startDate).slice(0, 10) : null);
    const dateTo = req.query.dateTo
      ? String(req.query.dateTo).slice(0, 10)
      : (req.query.endDate ? String(req.query.endDate).slice(0, 10) : null);
    const limit = Math.min(Number(req.query.limit || 500), 5000);

    function toDateKeyUTC(d) {
      if (!d || isNaN(d.getTime())) return null;
      const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return u.toISOString().slice(0, 10);
    }

    function normalizeKey(v) {
      return String(v || '').trim().toLowerCase();
    }

    function deriveBranchFromId(id) {
      const s = String(id || '').trim();
      if (!s) return 'unknown';
      if (/^[1-3][0-9]{8,}$/.test(s)) return s.slice(1, 3);
      if (/^[A-Za-z][0-9]{8,}$/.test(s)) return s.slice(1, 3);
      if (/^[0-9]{8,}$/.test(s)) return s.slice(0, 2);
      return 'unknown';
    }

    function deriveOperatorFromPurchase(purchase) {
      if (!purchase || typeof purchase !== 'object') return 'unknown';
      try {
        const booking = purchase.booking || {};
        const items = Array.isArray(purchase.items) ? purchase.items : [];
        let operatorName = null;

        const firstItem = items[0] || null;
        if (firstItem && firstItem.trip) {
          const tripKey = firstItem.trip.id || firstItem.trip.trip_id || firstItem.trip.tripId;
          const tripsMap = purchase.trips && typeof purchase.trips === 'object' ? purchase.trips : {};
          const trip = tripKey && tripsMap[tripKey] ? tripsMap[tripKey] : null;
          if (trip && Array.isArray(trip.segments) && trip.segments.length) {
            const seg = trip.segments[0] || {};
            const segOperator = seg.operator || {};
            operatorName =
              seg.operator_name ||
              (typeof seg.operator === 'string' ? seg.operator : null) ||
              segOperator.name ||
              segOperator.label ||
              segOperator.operator_name ||
              operatorName;
          }
        }

        if (!operatorName && Array.isArray(booking.tickets)) {
          const ticketsArr = booking.tickets;
          if (ticketsArr.length > 0) {
            const firstTicket = ticketsArr[0] || {};
            const seg = firstTicket.segment || firstTicket.trip || {};
            const segOp = seg.operator || {};
            operatorName =
              seg.operator_name ||
              (typeof seg.operator === 'string' ? seg.operator : null) ||
              segOp.name ||
              segOp.label ||
              segOp.operator_name ||
              operatorName;
          }
        }

        if (!operatorName) {
          operatorName =
            booking.operator_name ||
            (typeof booking.operator === 'string' ? booking.operator : null) ||
            (purchase.operator && (purchase.operator.name || purchase.operator.label || purchase.operator.operator_name)) ||
            purchase.operator_name ||
            null;
        }

        if (!operatorName) return 'unknown';
        return String(operatorName).trim() || 'unknown';
      } catch (_) {
        return 'unknown';
      }
    }

    // Precompute allowed date keys for the selected range
    let allowedDateKeys = null; // null means all dates
    let rangeStartKey = null;
    let rangeEndKey = null;
    if (specificDate) {
      rangeStartKey = specificDate;
      rangeEndKey = specificDate;
    } else if (dateFrom && dateTo) {
      rangeStartKey = dateFrom;
      rangeEndKey = dateTo;
    } else if (rangeKey === 'today') {
      const now = new Date();
      allowedDateKeys = new Set([now.toISOString().slice(0, 10)]);
    } else if (rangeKey === '7d') {
      allowedDateKeys = new Set(buildDateRange(7));
    } else if (rangeKey === '30d') {
      allowedDateKeys = new Set(buildDateRange(30));
    }

    // All-time aggregates (within the loaded window)
    let totalTicketsAll = 0;
    let totalRevenueAll = 0;
    const revenueByCurrencyAll = {};
    const perBranchAll = {};

    // Range aggregates
    let totalTicketsInRange = 0;
    let totalRevenueInRange = 0;
    const revenueByCurrencyInRange = {};
    const perBranchInRange = {};
    const dailyMap = {};
    const summaryByBranch = {};
    const summaryByOperator = {};
    const summaryByPaymentType = {};

    // Detailed per-payment rows for reporting (mapped to cart-like rows)
    const rows = [];

    const bounds = computeUtcRangeBounds({ rangeKey, specificDate, dateFrom: rangeStartKey, dateTo: rangeEndKey });
    const whereParts = [];
    if (bounds && bounds.start) whereParts.push(gte(payments.createdAt, bounds.start));
    if (bounds && bounds.end) whereParts.push(lte(payments.createdAt, bounds.end));
    const whereClause = whereParts.length ? and(...whereParts) : undefined;

    let paymentQuery = drizzleDb
      .select({
        createdAt: payments.createdAt,
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        transactionRef: payments.transactionRef,
        bookedBy: payments.bookedBy,
        rawResponse: payments.rawResponse,
        cartPassengers: carts.passengers,
      })
      .from(payments)
      .leftJoin(carts, eq(payments.transactionRef, carts.cartId))
      .orderBy(desc(payments.createdAt))
      .limit(limit);
    if (whereClause) paymentQuery = paymentQuery.where(whereClause);
    const paymentRows = await paymentQuery;

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const dayKey = toDateKeyUTC(createdAt);

      const purchase = row.rawResponse || {};
      const cartPassengers = row.cartPassengers || [];
      const items = Array.isArray(purchase.items) ? purchase.items : [];
      
      // Try to get per-passenger pricing from cart first, then fallback to purchase items
      let passengerPricing = [];
      if (Array.isArray(cartPassengers) && cartPassengers.length > 0) {
        passengerPricing = cartPassengers.map(p => ({
          firstName: p.first_name || p.firstName || '',
          lastName: p.last_name || p.lastName || '',
          type: p.category || p.type || 'adult',
          price: getPassengerRetailPrice(p) ?? 0
        }));
      } else if (items.length > 0) {
        passengerPricing = items.map(item => ({
          firstName: (item.passenger && (item.passenger.first_name || item.passenger.firstName)) || '',
          lastName: (item.passenger && (item.passenger.last_name || item.passenger.lastName)) || '',
          type: (item.passenger && (item.passenger.category || item.passenger.type)) || 'adult',
          price: Number(item.price || item.fare || 0)
        }));
      }
      
      const passengerCount = passengerPricing.length || 1;
      const totalRevenue = Number(row.amount || 0);
      const currency = 'USD';

      const branch = deriveBranchFromId(row.transactionRef);
      const operatorName = deriveOperatorFromPurchase(purchase);
      const paymentType = String(row.method || 'online');

      // All-time aggregates (within loaded window)
      totalTicketsAll += passengerCount;
      if (!perBranchAll[branch]) perBranchAll[branch] = 0;
      perBranchAll[branch] += passengerCount;
      if (totalRevenue > 0) {
        totalRevenueAll += totalRevenue;
        revenueByCurrencyAll[currency] = (revenueByCurrencyAll[currency] || 0) + totalRevenue;
      }

      // Range filter check
      let inRange = true;
      if (rangeStartKey && rangeEndKey) {
        if (dayKey) {
          inRange = dayKey >= rangeStartKey && dayKey <= rangeEndKey;
        } else {
          inRange = false;
        }
      } else if (allowedDateKeys && dayKey) {
        inRange = allowedDateKeys.has(dayKey);
      } else if (allowedDateKeys && !dayKey) {
        inRange = false;
      }
      if (!inRange) continue;

      // Range aggregates
      totalTicketsInRange += passengerCount;
      if (totalRevenue > 0) {
        totalRevenueInRange += totalRevenue;
        revenueByCurrencyInRange[currency] = (revenueByCurrencyInRange[currency] || 0) + totalRevenue;
      }
      if (!perBranchInRange[branch]) perBranchInRange[branch] = 0;
      perBranchInRange[branch] += passengerCount;

      // Daily
      if (dayKey) {
        if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, tickets: 0, revenue: 0 };
        dailyMap[dayKey].tickets += passengerCount;
        dailyMap[dayKey].revenue += totalRevenue;
      }

      // Branch summary (respect branchFilter only for summary table)
      if (!branchFilter || String(branch) === String(branchFilter)) {
        if (!summaryByBranch[branch]) summaryByBranch[branch] = { tickets: 0, revenue: 0 };
        summaryByBranch[branch].tickets += passengerCount;
        summaryByBranch[branch].revenue += totalRevenue;
      }

      // Operator summary (respect operatorFilter)
      const operatorCanonical = normalizeKey(operatorName);
      if (!operatorFilter || operatorCanonical.includes(operatorFilter)) {
        if (!summaryByOperator[operatorName]) summaryByOperator[operatorName] = { tickets: 0, revenue: 0 };
        summaryByOperator[operatorName].tickets += passengerCount;
        summaryByOperator[operatorName].revenue += totalRevenue;
      }

      // Payment type summary (respect paymentTypeFilter)
      const paymentCanonical = normalizeKey(paymentType);
      if (!paymentTypeFilter || paymentCanonical.includes(paymentTypeFilter)) {
        if (!summaryByPaymentType[paymentType]) summaryByPaymentType[paymentType] = { tickets: 0, revenue: 0 };
        summaryByPaymentType[paymentType].tickets += passengerCount;
        summaryByPaymentType[paymentType].revenue += totalRevenue;
      }

      // Create individual rows for each passenger with their actual price
      for (const passenger of passengerPricing) {
        rows.push({
          cartId: row.transactionRef || null,
          busbudCartId: null,
          reference: row.transactionRef || null,
          createdAt,
          userId: null,
          purchaserEmail: null,
          bookedBy: (() => {
            if (row.bookedBy) return row.bookedBy;
            // fallback: derive simple purchaser name/email from raw purchase
            const purchase = row.rawResponse || {};
            const user = purchase.user || purchase.purchaser || {};
            const first = user.first_name || user.firstName || '';
            const last = user.last_name || user.lastName || '';
            const name = [first, last].filter(Boolean).join(' ').trim();
            return name || user.email || null;
          })(),
          operator: operatorName,
          origin: null,
          destination: null,
          branch,
          paymentType,
          status: row.status || null,
          passengers: 1, // Each row represents 1 passenger
          revenue: passenger.price, // Actual individual passenger price
          currency,
          cost: 0,
          profit: passenger.price,
          margin: 1,
        });
      }
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    const summaryTable = {
      byBranch: Object.entries(summaryByBranch).map(([key, value]) => ({
        scope: 'branch',
        key,
        label: key,
        tickets: Number(value.tickets || 0),
        revenue: Number(value.revenue || 0),
      })),
      byOperator: Object.entries(summaryByOperator).map(([key, value]) => ({
        scope: 'operator',
        key,
        label: key,
        tickets: Number(value.tickets || 0),
        revenue: Number(value.revenue || 0),
      })),
      byPaymentType: Object.entries(summaryByPaymentType).map(([key, value]) => ({
        scope: 'paymentType',
        key,
        label: key,
        tickets: Number(value.tickets || 0),
        revenue: Number(value.revenue || 0),
      })),
    };

    const responseData = {
      totalTicketsSold: totalTicketsAll,
      totalRevenue: totalRevenueAll,
      revenueByCurrency: revenueByCurrencyAll,
      perBranch: perBranchAll,
      updatedAt: null,
      range: {
        key: rangeKey,
        dateFrom,
        dateTo,
        date: specificDate,
      },
      rangeTotals: {
        totalTickets: totalTicketsInRange,
        totalRevenue: totalRevenueInRange,
        revenueByCurrency: revenueByCurrencyInRange,
        perBranch: perBranchInRange,
      },
      daily,
      summaryTable,
      rows,
      rawCarts: paymentRows,
    };

    // No Firestore counters available in Postgres-backed flow; keep shape for
    // backwards compatibility by returning null.
    responseData.countersSummary = null;

    if (String(req.query.debug || '').toLowerCase() === '1' || String(req.query.debug || '').toLowerCase() === 'true') {
      responseData.debug = {
        paymentsCount: paymentRows.length,
        rangeKey,
        limit,
      };
    }

    return res.json({
      success: true,
      data: responseData,
    });
  } catch (err) {
    logger.error('Failed to load sales summary', {
      error: err?.message,
      stack: err?.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'SALES_SUMMARY_FAILED',
      message: err?.message || 'Failed to load sales summary',
    });
  }
});

// GET /api/admin/reports/transactions
// Returns a per-passenger view of transactions derived from the Postgres `payments`
// table's raw Busbud purchase snapshots.
// Supports the same range/date/limit params as /sales-summary:
//   ?range=all|today|7d|30d (default: all)
//   ?date=YYYY-MM-DD (overrides range)
//   ?limit=<number> (default: 500, max: 5000)
router.get('/transactions', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('ETag', `${Date.now()}`);

    const rangeKey = String(req.query.range || 'all').toLowerCase();
    const specificDate = req.query.date ? String(req.query.date).slice(0, 10) : null;
    const dateFrom = req.query.dateFrom
      ? String(req.query.dateFrom).slice(0, 10)
      : (req.query.startDate ? String(req.query.startDate).slice(0, 10) : null);
    const dateTo = req.query.dateTo
      ? String(req.query.dateTo).slice(0, 10)
      : (req.query.endDate ? String(req.query.endDate).slice(0, 10) : null);
    const limit = Math.min(Number(req.query.limit || 500), 5000);

    function toDateKeyUTC(d) {
      if (!d || isNaN(d.getTime())) return null;
      const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return u.toISOString().slice(0, 10);
    }

    let allowedDateKeys = null;
    let rangeStartKey = null;
    let rangeEndKey = null;
    if (specificDate) {
      rangeStartKey = specificDate;
      rangeEndKey = specificDate;
    } else if (dateFrom && dateTo) {
      rangeStartKey = dateFrom;
      rangeEndKey = dateTo;
    } else if (rangeKey === 'today') {
      const now = new Date();
      allowedDateKeys = new Set([now.toISOString().slice(0, 10)]);
    } else if (rangeKey === '7d') {
      allowedDateKeys = new Set(buildDateRange(7));
    } else if (rangeKey === '30d') {
      allowedDateKeys = new Set(buildDateRange(30));
    }

    const rows = [];

    const bounds = computeUtcRangeBounds({ rangeKey, specificDate, dateFrom: rangeStartKey, dateTo: rangeEndKey });
    const whereParts = [];
    if (bounds && bounds.start) whereParts.push(gte(payments.createdAt, bounds.start));
    if (bounds && bounds.end) whereParts.push(lte(payments.createdAt, bounds.end));
    const whereClause = whereParts.length ? and(...whereParts) : undefined;

    let paymentQuery = drizzleDb
      .select({
        createdAt: payments.createdAt,
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        transactionRef: payments.transactionRef,
        bookedBy: payments.bookedBy,
        rawResponse: payments.rawResponse,
        cartPassengers: carts.passengers,
      })
      .from(payments)
      .leftJoin(carts, eq(payments.transactionRef, carts.cartId))
      .orderBy(desc(payments.createdAt))
      .limit(limit);

    if (whereClause) paymentQuery = paymentQuery.where(whereClause);
    const paymentRows = await paymentQuery;

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const paidOn = createdAt;
      const paidDayKey = toDateKeyUTC(paidOn);

      let inRange = true;
      if (rangeStartKey && rangeEndKey) {
        if (paidDayKey) {
          inRange = paidDayKey >= rangeStartKey && paidDayKey <= rangeEndKey;
        } else {
          inRange = false;
        }
      } else if (allowedDateKeys && paidDayKey) {
        inRange = allowedDateKeys.has(paidDayKey);
      } else if (allowedDateKeys && !paidDayKey) {
        inRange = false;
      }
      if (!inRange) continue;

      const purchase = row.rawResponse || {};
      const operatorName = deriveOperatorFromPurchase(purchase);
      const user = purchase.user || purchase.purchaser || {};
      const paidByNameParts = [];
      if (user.first_name || user.firstName) paidByNameParts.push(user.first_name || user.firstName);
      if (user.last_name || user.lastName) paidByNameParts.push(user.last_name || user.lastName);
      const paidByName = paidByNameParts.join(' ').trim();
      const paidByEmail = user.email || null;
      const paidBy = paidByName || paidByEmail || null;

      const items = Array.isArray(purchase.items) ? purchase.items : [];
      const cartPassengers = Array.isArray(row.cartPassengers) ? row.cartPassengers : [];

      for (const item of items) {
        const passenger = item.passenger || {};
        const firstName = passenger.first_name || passenger.firstName || '';
        const lastName = passenger.last_name || passenger.lastName || '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ') || null;

        const passengerType =
          passenger.category ||
          passenger.source_passenger_category ||
          (typeof passenger.type === 'string' ? passenger.type : null) ||
          null;

        const ticketRef =
          (item.fields && (item.fields.booking_reference || item.fields.reference)) ||
          item.reference ||
          null;

        const tripKey = item.trip && (item.trip.id || item.trip.trip_id || item.trip.tripId);
        const tripsMap = purchase.trips && typeof purchase.trips === 'object' ? purchase.trips : {};
        const trip = (tripKey && tripsMap[tripKey]) || null;

        let departure = null;
        let destination = null;
        let departureDate = null;

        if (trip) {
          const segments = Array.isArray(trip.segments) ? trip.segments : [];
          const seg = segments[0] || {};

          const origin = seg.origin || {};
          const destinationObj = seg.destination || {};

          const originCity = origin.city || {};
          const destinationCity = destinationObj.city || {};

          departure = origin.name || originCity.name || null;
          destination = destinationObj.name || destinationCity.name || null;

          // Try multiple locations for departure date/time
          const segDepartureTime = seg.departure_time || seg.departureTime || null;

          if (trip.departure_time && trip.departure_time.timestamp) {
            departureDate = trip.departure_time.timestamp;
          } else if (trip.departure_time) {
            departureDate = trip.departure_time;
          } else if (trip.departure_time_utc) {
            departureDate = trip.departure_time_utc;
          } else if (segDepartureTime && segDepartureTime.timestamp) {
            departureDate = segDepartureTime.timestamp;
          } else if (segDepartureTime) {
            departureDate = segDepartureTime;
          } else if (seg.departure_time_utc) {
            departureDate = seg.departure_time_utc;
          }
        }

        // As a last resort, fall back to purchase timestamps if no structured
        // departure time was found.
        if (!departureDate) {
          if (purchase.completed_at) {
            departureDate = purchase.completed_at;
          } else if (purchase.created_at) {
            departureDate = purchase.created_at;
          }
        }

        const passengerAmount = (() => {
          const pid = getPassengerIdLike(passenger);
          const idx = items.indexOf(item);
          const cartMatch = pid
            ? cartPassengers.find((cp) => getPassengerIdLike(cp) === pid)
            : (idx >= 0 ? cartPassengers[idx] : null);
          const fromCart = getPassengerRetailPrice(cartMatch);
          if (fromCart != null) return fromCart;
          const fromItem = getPassengerRetailPrice(item) ?? getPassengerRetailPrice(passenger);
          if (fromItem != null) return fromItem;
          if (items.length === 1) {
            const single = Number(row.amount || 0);
            return Number.isFinite(single) ? single : 0;
          }
          return 0;
        })();

        let currency = null;
        try {
          if (purchase.stats && purchase.stats.customer_value && purchase.stats.customer_value.currency) {
            currency = purchase.stats.customer_value.currency;
          } else if (purchase.charges && purchase.charges.currency) {
            currency = purchase.charges.currency;
          }
        } catch (_) {
          // ignore JSON shape issues
        }
        if (!currency) {
          try {
            const pid = getPassengerIdLike(passenger);
            const idx = items.indexOf(item);
            const cartMatch = pid
              ? cartPassengers.find((cp) => getPassengerIdLike(cp) === pid)
              : (idx >= 0 ? cartPassengers[idx] : null);
            const pricing = cartMatch && cartMatch.pricing && typeof cartMatch.pricing === 'object' ? cartMatch.pricing : null;
            currency = pricing && pricing.currency ? pricing.currency : null;
          } catch (_) {
            // ignore
          }
        }

        rows.push({
          paidOn,
          paidBy,
          bookedBy: row.bookedBy || paidBy || null,
          ticket: ticketRef,
          name: fullName,
          departure,
          destination,
          departureDate,
          passengerType,
          amount: passengerAmount,
          currency,
          operator: operatorName,
          status: row.status || null,
          paymentMethod: row.method || null,
          transactionRef: row.transactionRef || null,
        });
      }
    }

    return res.json({
      success: true,
      data: {
        range: {
          key: rangeKey,
          dateFrom,
          dateTo,
          date: specificDate,
        },
        totalRows: rows.length,
        rows,
      },
    });
  } catch (err) {
    logger.error('Failed to load transactions report', {
      error: err?.message,
      stack: err?.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'TRANSACTIONS_REPORT_FAILED',
      message: err?.message || 'Failed to load transactions report',
    });
  }
});

// GET /api/admin/reports/profitability
// Paginated profitability report based on Postgres `payments` table.
// Query params:
//   ?range=all|today|7d|30d|custom (default: 7d)
//   ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD (only for range=custom)
//   ?page=1 (default)
//   ?pageSize=25 (default, max 100)
//   ?status=<string> (optional)
//   ?paymentType=<string> (optional)
//   ?bookedBy=<string> (optional, contains)
router.get('/profitability', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('ETag', `${Date.now()}`);

    const rangeKey = String(req.query.range || '7d').toLowerCase();
    const dateFrom = req.query.dateFrom ? String(req.query.dateFrom).slice(0, 10) : null;
    const dateTo = req.query.dateTo ? String(req.query.dateTo).slice(0, 10) : null;

    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));
    const offset = (page - 1) * pageSize;

    const statusFilter = req.query.status ? String(req.query.status).trim() : 'paid';
    const paymentTypeFilter = req.query.paymentType ? String(req.query.paymentType).trim() : null;
    const bookedByFilter = req.query.bookedBy ? String(req.query.bookedBy).trim() : null;

    const now = new Date();
    const utcMidnight = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    let startDate = null;
    let endDate = null;
    if (rangeKey === 'today') {
      startDate = utcMidnight(now);
      endDate = now;
    } else if (rangeKey === '7d') {
      const start = utcMidnight(now);
      start.setUTCDate(start.getUTCDate() - 6);
      startDate = start;
      endDate = now;
    } else if (rangeKey === '30d') {
      const start = utcMidnight(now);
      start.setUTCDate(start.getUTCDate() - 29);
      startDate = start;
      endDate = now;
    } else if (rangeKey === 'custom' && dateFrom && dateTo) {
      startDate = new Date(`${dateFrom}T00:00:00.000Z`);
      endDate = new Date(`${dateTo}T23:59:59.999Z`);
    }

    const whereParts = [];
    if (startDate) whereParts.push(gte(payments.createdAt, startDate));
    if (endDate) whereParts.push(lte(payments.createdAt, endDate));
    if (statusFilter) whereParts.push(eq(payments.status, statusFilter));
    if (paymentTypeFilter) whereParts.push(eq(payments.method, paymentTypeFilter));
    if (bookedByFilter) whereParts.push(ilike(payments.bookedBy, `%${bookedByFilter}%`));

    const whereClause = whereParts.length ? and(...whereParts) : undefined;

    const unroundedAdjustedTotalSql = sql`(
      coalesce(${payments.costPrice}, 0)
      + coalesce(${payments.markup}, 0)
      + coalesce(${payments.charges}, 0)
      - coalesce(${payments.discount}, 0)
    )`;

    const roundDiffSql = sql`(
      case
        when ${payments.costPrice} is null then 0
        else (${payments.amount} - ${unroundedAdjustedTotalSql})
      end
    )`;

    let totalsQuery = drizzleDb
      .select({
        totalRows: sql`count(*)`,
        totalRetail: sql`coalesce(sum(${payments.amount}), 0)`,
        totalCost: sql`coalesce(sum(${payments.costPrice}), 0)`,
        totalMarkup: sql`coalesce(sum(${payments.markup}), 0)`,
        totalDiscount: sql`coalesce(sum(${payments.discount}), 0)`,
        totalCharges: sql`coalesce(sum(${payments.charges}), 0)`,
        totalCommission: sql`coalesce(sum(${payments.commission}), 0)`,
        totalRoundDiff: sql`coalesce(sum(${roundDiffSql}), 0)`,
      })
      .from(payments);
    if (whereClause) totalsQuery = totalsQuery.where(whereClause);
    const totalsRows = await totalsQuery;

    const totals0 = totalsRows && totalsRows.length ? totalsRows[0] : {};
    const totalRows = Number(totals0.totalRows || 0);

    const toNum = (v) => {
      if (v == null) return 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const totals = {
      rows: totalRows,
      retailPrice: toNum(totals0.totalRetail),
      costPrice: toNum(totals0.totalCost),
      markup: toNum(totals0.totalMarkup),
      discount: toNum(totals0.totalDiscount),
      charges: toNum(totals0.totalCharges),
      commission: toNum(totals0.totalCommission),
      round_diff: toNum(totals0.totalRoundDiff),
    };
    totals.profit = totals.markup - totals.discount;
    totals.margin = totals.retailPrice > 0 ? totals.profit / totals.retailPrice : 0;
    totals.profitability = totals.markup + totals.charges - totals.discount;

    let pageQuery = drizzleDb
      .select({
        createdAt: payments.createdAt,
        amount: payments.amount,
        costPrice: payments.costPrice,
        discount: payments.discount,
        markup: payments.markup,
        charges: payments.charges,
        commission: payments.commission,
        method: payments.method,
        status: payments.status,
        transactionRef: payments.transactionRef,
        bookedBy: payments.bookedBy,
        rawResponse: payments.rawResponse,
        round_diff: roundDiffSql,
      })
      .from(payments)
      .orderBy(desc(payments.createdAt))
      .limit(pageSize)
      .offset(offset);
    if (whereClause) pageQuery = pageQuery.where(whereClause);
    const paymentRows = await pageQuery;

    const rows = (paymentRows || []).map((row) => {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const retailPrice = toNum(row.amount);
      const costPrice = toNum(row.costPrice);
      const markup = toNum(row.markup);
      const discount = toNum(row.discount);
      const charges = toNum(row.charges);
      const commission = toNum(row.commission);
      const profit = markup - discount;
      const margin = retailPrice > 0 ? profit / retailPrice : 0;
      const round_diff = toNum(row.round_diff);

      const purchase = row.rawResponse || {};

      const branch = (() => {
        const s = String(row.transactionRef || '').trim();
        if (!s) return 'unknown';
        if (/^[1-3][0-9]{8,}$/.test(s)) return s.slice(1, 3);
        if (/^[A-Za-z][0-9]{8,}$/.test(s)) return s.slice(1, 3);
        if (/^[0-9]{8,}$/.test(s)) return s.slice(0, 2);
        return 'unknown';
      })();

      const operator = deriveOperatorFromPurchase(purchase);

      return {
        transactionRef: row.transactionRef || null,
        createdAt,
        status: row.status || null,
        paymentType: row.method || null,
        bookedBy: row.bookedBy || null,
        branch,
        operator,

        costPrice,
        markup,
        discount,
        charges,
        commission,
        retailPrice,
        round_diff,

        profit,
        margin,
        profitability: markup + charges - discount,
      };
    });

    const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;

    return res.json({
      success: true,
      data: {
        range: {
          key: rangeKey,
          dateFrom,
          dateTo,
        },
        filters: {
          status: statusFilter,
          paymentType: paymentTypeFilter,
          bookedBy: bookedByFilter,
        },
        page,
        pageSize,
        totalRows,
        totalPages,
        totals,
        rows,
      },
    });
  } catch (err) {
    logger.error('Failed to load profitability report', {
      error: err?.message,
      stack: err?.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'PROFITABILITY_REPORT_FAILED',
      message: err?.message || 'Failed to load profitability report',
    });
  }
});

router.post('/engine', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('ETag', `${Date.now()}`);

    const body = req.body || {};
    const rangeKey = String(body.range || 'all').toLowerCase();
    const dateFrom = body.dateFrom ? String(body.dateFrom).slice(0, 10) : null;
    const dateTo = body.dateTo ? String(body.dateTo).slice(0, 10) : null;
    const rawDimensions = Array.isArray(body.dimensions) ? body.dimensions : [];
    const rawMetrics = Array.isArray(body.metrics) ? body.metrics : [];
    const filters = Array.isArray(body.filters) ? body.filters : [];
    const sort = Array.isArray(body.sort) ? body.sort : [];
    const limit = Math.min(Number(body.limit || 100), 5000);
    const sourceLimit = Math.min(Number(body.sourceLimit || 5000), 20000);

    const allowedDimensions = new Set(['operator', 'branch', 'paymentType', 'status', 'day']);
    const allowedMetrics = new Set(['payments', 'tickets', 'revenue', 'busbudRaw', 'adjusted', 'profit', 'margin']);

    const dimensions = rawDimensions.length ? rawDimensions.map((d) => String(d)) : [];
    for (const d of dimensions) {
      if (!allowedDimensions.has(d)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_DIMENSION',
          message: `Unsupported dimension: ${d}`,
        });
      }
    }

    const metrics = rawMetrics.length ? rawMetrics.map((m) => String(m)) : ['payments', 'revenue'];
    for (const m of metrics) {
      if (!allowedMetrics.has(m)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_METRIC',
          message: `Unsupported metric: ${m}`,
        });
      }
    }

    const allowedFilterFields = new Set(['operator', 'branch', 'paymentType', 'status', 'day']);
    const allowedFilterOps = new Set(['eq', 'in', 'contains']);

    for (const rawFilter of filters) {
      const field = String((rawFilter && rawFilter.field) || '');
      const op = String((rawFilter && rawFilter.op) || 'eq').toLowerCase();
      if (!allowedFilterFields.has(field)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FILTER_FIELD',
          message: `Unsupported filter field: ${field}`,
        });
      }
      if (!allowedFilterOps.has(op)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FILTER_OP',
          message: `Unsupported filter op: ${op}`,
        });
      }
    }

    const allowedSortFields = new Set([...dimensions, ...metrics]);
    for (const rawSort of sort) {
      const field = String((rawSort && rawSort.field) || '');
      if (!allowedSortFields.has(field)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SORT_FIELD',
          message: `Unsupported sort field: ${field}`,
        });
      }
      const dir = String((rawSort && rawSort.direction) || 'desc').toLowerCase();
      if (dir !== 'asc' && dir !== 'desc') {
        return res.status(400).json({
          success: false,
          error: 'INVALID_SORT_DIRECTION',
          message: `Unsupported sort direction: ${rawSort.direction}`,
        });
      }
    }

    function normalizeValue(v) {
      return String(v || '').trim().toLowerCase();
    }

    function toDateKeyUTC(d) {
      if (!d || isNaN(d.getTime())) return null;
      const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return u.toISOString().slice(0, 10);
    }

    function deriveBranchFromIdLocal(id) {
      const s = String(id || '').trim();
      if (!s) return 'unknown';
      if (/^[1-3][0-9]{8,}$/.test(s)) return s.slice(1, 3);
      if (/^[A-Za-z][0-9]{8,}$/.test(s)) return s.slice(1, 3);
      if (/^[0-9]{8,}$/.test(s)) return s.slice(0, 2);
      return 'unknown';
    }

    function deriveOperatorFromPurchaseLocal(purchase) {
      if (!purchase || typeof purchase !== 'object') return 'unknown';
      try {
        const booking = purchase.booking || {};
        const items = Array.isArray(purchase.items) ? purchase.items : [];
        let operatorName = null;

        const firstItem = items[0] || null;
        if (firstItem && firstItem.trip) {
          const tripKey = firstItem.trip.id || firstItem.trip.trip_id || firstItem.trip.tripId;
          const tripsMap = purchase.trips && typeof purchase.trips === 'object' ? purchase.trips : {};
          const trip = tripKey && tripsMap[tripKey] ? tripsMap[tripKey] : null;
          if (trip && Array.isArray(trip.segments) && trip.segments.length) {
            const seg = trip.segments[0] || {};
            const segOperator = seg.operator || {};
            operatorName =
              seg.operator_name ||
              (typeof seg.operator === 'string' ? seg.operator : null) ||
              segOperator.name ||
              segOperator.label ||
              segOperator.operator_name ||
              operatorName;
          }
        }

        if (!operatorName && Array.isArray(booking.tickets)) {
          const ticketsArr = booking.tickets;
          if (ticketsArr.length > 0) {
            const firstTicket = ticketsArr[0] || {};
            const seg = firstTicket.segment || firstTicket.trip || {};
            const segOp = seg.operator || {};
            operatorName =
              seg.operator_name ||
              (typeof seg.operator === 'string' ? seg.operator : null) ||
              segOp.name ||
              segOp.label ||
              segOp.operator_name ||
              operatorName;
          }
        }

        if (!operatorName) {
          operatorName =
            booking.operator_name ||
            (typeof booking.operator === 'string' ? booking.operator : null) ||
            (purchase.operator && (purchase.operator.name || purchase.operator.label || purchase.operator.operator_name)) ||
            purchase.operator_name ||
            null;
        }

        if (!operatorName) return 'unknown';
        return String(operatorName).trim() || 'unknown';
      } catch (_) {
        return 'unknown';
      }
    }

    function rowMatchesFilters(ctx) {
      if (!filters.length) return true;
      for (const rawFilter of filters) {
        const field = String(rawFilter.field);
        const op = String(rawFilter.op || 'eq').toLowerCase();
        const value = rawFilter.value;
        const values = Array.isArray(rawFilter.values) ? rawFilter.values : null;
        const raw = ctx[field];
        if (raw == null) return false;
        const v = normalizeValue(raw);
        if (op === 'eq') {
          if (v !== normalizeValue(value)) return false;
        } else if (op === 'in') {
          if (!values || !values.length) return false;
          const set = new Set(values.map((x) => normalizeValue(x)));
          if (!set.has(v)) return false;
        } else if (op === 'contains') {
          if (!normalizeValue(value) || !v.includes(normalizeValue(value))) return false;
        }
      }
      return true;
    }

    const bounds = computeUtcRangeBounds({ rangeKey, specificDate: null, dateFrom, dateTo });
    const whereParts = [];
    if (bounds && bounds.start) whereParts.push(gte(payments.createdAt, bounds.start));
    if (bounds && bounds.end) whereParts.push(lte(payments.createdAt, bounds.end));
    const whereClause = whereParts.length ? and(...whereParts) : undefined;

    let paymentQuery = drizzleDb
      .select({
        createdAt: payments.createdAt,
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        transactionRef: payments.transactionRef,
        rawResponse: payments.rawResponse,
      })
      .from(payments)
      .orderBy(desc(payments.createdAt))
      .limit(sourceLimit);
    if (whereClause) paymentQuery = paymentQuery.where(whereClause);
    const paymentRows = await paymentQuery;

    const groups = new Map();
    const totals = { payments: 0, tickets: 0, revenue: 0, busbudRaw: 0, adjusted: 0, profit: 0 };

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const dayKey = toDateKeyUTC(createdAt);

      let inRange = true;
      if (rangeKey === 'today') {
        const now = new Date();
        const todayKey = now.toISOString().slice(0, 10);
        inRange = dayKey === todayKey;
      } else if (rangeKey === '7d') {
        const days = buildDateRange(7);
        inRange = !!dayKey && days.includes(dayKey);
      } else if (rangeKey === '30d') {
        const days = buildDateRange(30);
        inRange = !!dayKey && days.includes(dayKey);
      } else if (rangeKey === 'custom' && dateFrom && dateTo) {
        inRange = !!dayKey && dayKey >= dateFrom && dayKey <= dateTo;
      }
      if (!inRange) continue;

      const purchase = row.rawResponse || {};
      const branch = deriveBranchFromIdLocal(row.transactionRef);
      const operatorName = deriveOperatorFromPurchaseLocal(purchase);
      const paymentType = String(row.method || 'online');
      const status = row.status || null;
      const ticketsCount = Array.isArray(purchase.items) ? purchase.items.length : 0;
      const { busbudRaw, adjusted } = deriveRawAndAdjustedFromRow(row);
      const revenueValue = adjusted;
      const rawValue = busbudRaw != null ? busbudRaw : adjusted;
      const profitValue = revenueValue - rawValue;
      const marginValue = revenueValue > 0 ? profitValue / revenueValue : 0;

      const ctx = {
        day: dayKey,
        branch,
        operator: operatorName,
        paymentType,
        status,
        payments: 1,
        tickets: ticketsCount,
        revenue: revenueValue,
        busbudRaw: rawValue,
        adjusted: revenueValue,
        profit: profitValue,
        margin: marginValue,
      };

      if (!rowMatchesFilters(ctx)) continue;

      if (metrics.includes('payments')) totals.payments += ctx.payments;
      if (metrics.includes('tickets')) totals.tickets += ctx.tickets;
      if (metrics.includes('revenue')) totals.revenue += ctx.revenue;
      if (metrics.includes('busbudRaw')) totals.busbudRaw += ctx.busbudRaw;
      if (metrics.includes('adjusted')) totals.adjusted += ctx.adjusted;
      if (metrics.includes('profit')) totals.profit += ctx.profit;

      const dims = {};
      for (const d of dimensions) {
        dims[d] = ctx[d] != null ? ctx[d] : 'unknown';
      }
      const key = JSON.stringify(dims);
      let agg = groups.get(key);
      if (!agg) {
        const metricsInit = {};
        if (metrics.includes('payments')) metricsInit.payments = 0;
        if (metrics.includes('tickets')) metricsInit.tickets = 0;
        if (metrics.includes('revenue')) metricsInit.revenue = 0;
        if (metrics.includes('busbudRaw')) metricsInit.busbudRaw = 0;
        if (metrics.includes('adjusted')) metricsInit.adjusted = 0;
        if (metrics.includes('profit')) metricsInit.profit = 0;
        if (metrics.includes('margin')) metricsInit.margin = 0;
        agg = { dimensions: dims, metrics: metricsInit };
        groups.set(key, agg);
      }
      if (metrics.includes('payments')) agg.metrics.payments += ctx.payments;
      if (metrics.includes('tickets')) agg.metrics.tickets += ctx.tickets;
      if (metrics.includes('revenue')) agg.metrics.revenue += ctx.revenue;
      if (metrics.includes('busbudRaw')) agg.metrics.busbudRaw += ctx.busbudRaw;
      if (metrics.includes('adjusted')) agg.metrics.adjusted += ctx.adjusted;
      if (metrics.includes('profit')) agg.metrics.profit += ctx.profit;
    }

    let result = Array.from(groups.values());

    if (metrics.includes('margin')) {
      for (const row of result) {
        const m = row.metrics || {};
        const rev = typeof m.adjusted === 'number' ? m.adjusted : (m.revenue || 0);
        const prof = m.profit || 0;
        m.margin = rev > 0 ? prof / rev : 0;
      }
    }

    function getSortValue(row, field) {
      if (row.metrics && Object.prototype.hasOwnProperty.call(row.metrics, field)) {
        return row.metrics[field];
      }
      if (row.dimensions && Object.prototype.hasOwnProperty.call(row.dimensions, field)) {
        return row.dimensions[field];
      }
      return null;
    }

    if (sort.length) {
      result.sort((a, b) => {
        for (const s of sort) {
          const field = String(s.field);
          const dir = String(s.direction || 'desc').toLowerCase();
          const av = getSortValue(a, field);
          const bv = getSortValue(b, field);
          if (av == null && bv == null) continue;
          if (av == null) return dir === 'asc' ? 1 : -1;
          if (bv == null) return dir === 'asc' ? -1 : 1;
          if (av < bv) return dir === 'asc' ? -1 : 1;
          if (av > bv) return dir === 'asc' ? 1 : -1;
        }
        return 0;
      });
    } else if (metrics.includes('revenue')) {
      result.sort((a, b) => {
        const av = getSortValue(a, 'revenue') || 0;
        const bv = getSortValue(b, 'revenue') || 0;
        return bv - av;
      });
    }

    const limited = limit && result.length > limit ? result.slice(0, limit) : result;

    const totalsOut = {};
    if (metrics.includes('payments')) totalsOut.payments = totals.payments;
    if (metrics.includes('tickets')) totalsOut.tickets = totals.tickets;
    if (metrics.includes('revenue')) totalsOut.revenue = totals.revenue;
    if (metrics.includes('busbudRaw')) totalsOut.busbudRaw = totals.busbudRaw;
    if (metrics.includes('adjusted')) totalsOut.adjusted = totals.adjusted;
    if (metrics.includes('profit')) totalsOut.profit = totals.profit;
    if (metrics.includes('margin')) {
      const rev = totals.adjusted || totals.revenue || 0;
      const prof = totals.profit || 0;
      totalsOut.margin = rev > 0 ? prof / rev : 0;
    }

    return res.json({
      success: true,
      data: {
        range: {
          key: rangeKey,
          dateFrom,
          dateTo,
        },
        dimensions,
        metrics,
        filters,
        sort,
        totalGroups: limited.length,
        totals: totalsOut,
        rows: limited,
      },
    });
  } catch (err) {
    logger.error('Failed to execute dynamic report', {
      error: err?.message,
      stack: err?.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'REPORT_ENGINE_FAILED',
      message: err?.message || 'Failed to execute dynamic report',
    });
  }
});

// Unified reports endpoint at /api/admin/reports: dispatches sales-summary and transactions (and future reports) using Postgres
router.get('/', async (req, res) => {
  const type = String(req.query.type || 'sales-summary').toLowerCase();
  if (type === 'sales-summary') {
    req.url = '/sales-summary';
    return router.handle(req, res);
  }
  if (type === 'transactions') {
    req.url = '/transactions';
    return router.handle(req, res);
  }
  if (type === 'profitability') {
    req.url = '/profitability';
    return router.handle(req, res);
  }
  return res.status(400).json({
    success: false,
    error: 'UNKNOWN_REPORT_TYPE',
    message: `Unsupported report type: ${type}`,
  });
});

export default router;
