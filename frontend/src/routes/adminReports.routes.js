import express from 'express';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';
import logger from '../utils/logger.js';
import drizzleDb, { payments } from '../db/drizzleClient.js';
import { desc } from 'drizzle-orm';
import { Parser as Json2CsvParser } from 'json2csv';
import PDFDocument from 'pdfkit';

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

    function deriveRawAndAdjustedFromRow(row) {
      const purchase = row.rawResponse || {};
      const summary = purchase.summary || {};
      const charges = purchase.charges || {};
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
      const adjusted = Number(row.amount || 0);
      return { busbudRaw, adjusted };
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
    if (specificDate) {
      allowedDateKeys = new Set([specificDate]);
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

    const paymentRows = await drizzleDb
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
      .limit(limit);

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const dayKey = toDateKeyUTC(createdAt);

      const n = 1;

      const revenue = Number(row.amount || 0);
      const currency = 'USD';
      const cost = 0;
      const profit = revenue - cost;
      const margin = revenue > 0 ? profit / revenue : 0;

      const purchase = row.rawResponse || {};
      const branch = deriveBranchFromId(row.transactionRef);
      const operatorName = deriveOperatorFromPurchase(purchase);
      const paymentType = String(row.method || 'online');

      // All-time aggregates (within loaded window)
      totalTicketsAll += n;
      if (!perBranchAll[branch]) perBranchAll[branch] = 0;
      perBranchAll[branch] += n;
      if (revenue > 0) {
        totalRevenueAll += revenue;
        revenueByCurrencyAll[currency] = (revenueByCurrencyAll[currency] || 0) + revenue;
      }

      // Range filter check
      let inRange = true;
      if (allowedDateKeys && dayKey) {
        inRange = allowedDateKeys.has(dayKey);
      } else if (allowedDateKeys && !dayKey) {
        inRange = false;
      }
      if (specificDate && dayKey && dayKey !== specificDate) {
        inRange = false;
      }
      if (!inRange) continue;

      // Range aggregates
      totalTicketsInRange += n;
      if (revenue > 0) {
        totalRevenueInRange += revenue;
        revenueByCurrencyInRange[currency] = (revenueByCurrencyInRange[currency] || 0) + revenue;
      }
      if (!perBranchInRange[branch]) perBranchInRange[branch] = 0;
      perBranchInRange[branch] += n;

      // Daily
      if (dayKey) {
        if (!dailyMap[dayKey]) dailyMap[dayKey] = { date: dayKey, tickets: 0, revenue: 0 };
        dailyMap[dayKey].tickets += n;
        dailyMap[dayKey].revenue += revenue;
      }

      // Branch summary (respect branchFilter only for summary table)
      if (!branchFilter || String(branch) === String(branchFilter)) {
        if (!summaryByBranch[branch]) summaryByBranch[branch] = { tickets: 0, revenue: 0 };
        summaryByBranch[branch].tickets += n;
        summaryByBranch[branch].revenue += revenue;
      }

      // Operator summary (respect operatorFilter)
      const operatorCanonical = normalizeKey(operatorName);
      if (!operatorFilter || operatorCanonical.includes(operatorFilter)) {
        if (!summaryByOperator[operatorName]) summaryByOperator[operatorName] = { tickets: 0, revenue: 0 };
        summaryByOperator[operatorName].tickets += n;
        summaryByOperator[operatorName].revenue += revenue;
      }

      // Payment type summary (respect paymentTypeFilter)
      const paymentCanonical = normalizeKey(paymentType);
      if (!paymentTypeFilter || paymentCanonical.includes(paymentTypeFilter)) {
        if (!summaryByPaymentType[paymentType]) summaryByPaymentType[paymentType] = { tickets: 0, revenue: 0 };
        summaryByPaymentType[paymentType].tickets += n;
        summaryByPaymentType[paymentType].revenue += revenue;
      }

      rows.push({
        cartId: row.transactionRef || null,
        busbudCartId: null,
        reference: row.transactionRef || null,
        createdAt,
        userId: null,
        purchaserEmail: null,
        operator: operatorName,
        origin: null,
        destination: null,
        branch,
        paymentType,
        status: row.status || null,
        passengers: n,
        revenue,
        currency,
        cost,
        profit,
        margin,
      });
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
    const limit = Math.min(Number(req.query.limit || 500), 5000);

    function toDateKeyUTC(d) {
      if (!d || isNaN(d.getTime())) return null;
      const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      return u.toISOString().slice(0, 10);
    }

    let allowedDateKeys = null;
    if (specificDate) {
      allowedDateKeys = new Set([specificDate]);
    } else if (rangeKey === 'today') {
      const now = new Date();
      allowedDateKeys = new Set([now.toISOString().slice(0, 10)]);
    } else if (rangeKey === '7d') {
      allowedDateKeys = new Set(buildDateRange(7));
    } else if (rangeKey === '30d') {
      allowedDateKeys = new Set(buildDateRange(30));
    }

    const rows = [];

    const paymentRows = await drizzleDb
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
      .limit(limit);

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const paidOn = createdAt;
      const paidDayKey = toDateKeyUTC(paidOn);

      let inRange = true;
      if (allowedDateKeys && paidDayKey) {
        inRange = allowedDateKeys.has(paidDayKey);
      } else if (allowedDateKeys && !paidDayKey) {
        inRange = false;
      }
      if (specificDate && paidDayKey && paidDayKey !== specificDate) {
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

        const amount = Number(row.amount || 0);
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

        rows.push({
          paidOn,
          paidBy,
          ticket: ticketRef,
          name: fullName,
          departure,
          destination,
          departureDate,
          passengerType,
          amount,
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

    const paymentRows = await drizzleDb
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
  return res.status(400).json({
    success: false,
    error: 'UNKNOWN_REPORT_TYPE',
    message: `Unsupported report type: ${type}`,
  });
});

export default router;
