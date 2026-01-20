import express from 'express';
import { body } from 'express-validator';
import { validateRequest } from '../../../middlewares/validateRequest.js';
import { requireAgentApi } from '../../../middleware/agentAuth.js';
import { createUser, getUserByEmail, updateUser } from '../../../services/user.service.js';
import { getAgentByEmail, upsertAgentForUser } from '../../../services/agent.service.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../../../config/firebase.config.mjs';
import drizzleDb, { payments, carts as cartsPgTable, agents as agentsTable, branches as branchesTable } from '../../../db/drizzleClient.js';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import { Parser as Json2CsvParser } from 'json2csv';
import logger from '../../../utils/logger.js';
import { generatePdfFromHtml } from '../../../utils/ticketPdf.js';
import verifyFirebaseAuth from '../../../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../../../middleware/adminAccess.js';
import bcrypt from 'bcryptjs';
import { createAdminNotificationForAll, createAgentNotificationForEmail } from '../../../services/notification.service.js';

const router = express.Router();

const DEFAULT_BRANCHES = [
  { code: '01', name: 'Online' },
  { code: '02', name: 'Chatbot' },
  { code: '03', name: 'Harare' },
  { code: '04', name: 'Gweru' },
];

async function ensureDefaultBranches() {
  for (const b of DEFAULT_BRANCHES) {
    const existing = await drizzleDb.select().from(branchesTable).where(eq(branchesTable.code, b.code)).limit(1);
    if (existing && existing.length) continue;
    try {
      await drizzleDb.insert(branchesTable).values({ code: b.code, name: b.name, active: true });
    } catch (_) {
    }
  }
}

router.get('/branches', async (_req, res) => {
  try {
    await ensureDefaultBranches();
    const rows = await drizzleDb
      .select()
      .from(branchesTable)
      .where(eq(branchesTable.active, true))
      .orderBy(asc(branchesTable.code));
    const data = (rows || [])
      .filter((r) => !['01', '02'].includes(String(r.code || '').trim()))
      .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      active: r.active,
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'LIST_BRANCHES_FAILED', message: err.message });
  }
});

router.get('/', verifyFirebaseAuth, requireRegisteredAdminApi, async (req, res) => {
  try {
    const rows = await drizzleDb
      .select()
      .from(agentsTable)
      .orderBy(desc(agentsTable.createdAt));
    const data = (rows || []).map((r) => ({
      id: r.id,
      email: r.emailLower || null,
      firstName: r.firstName || null,
      lastName: r.lastName || null,
      branchId: r.branchId || null,
      active: r.active,
      createdAt: r.createdAt || null,
    }));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('List agents failed', { message: error.message });
    return res.status(500).json({ success: false, error: 'LIST_AGENTS_FAILED', message: error.message });
  }
});

router.patch(
  '/:id/branch',
  verifyFirebaseAuth,
  requireRegisteredAdminApi,
  async (req, res) => {
    try {
      const agentId = String(req.params.id || '').trim();
      const branchId = req.body && req.body.branchId != null ? String(req.body.branchId).trim() : '';
      if (!agentId) return res.status(400).json({ success: false, error: 'INVALID_AGENT_ID' });
      if (!branchId) return res.status(400).json({ success: false, error: 'INVALID_BRANCH_ID' });

      const branchRows = await drizzleDb.select().from(branchesTable).where(eq(branchesTable.id, branchId)).limit(1);
      const branch = branchRows && branchRows.length ? branchRows[0] : null;
      if (!branch) return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND' });
      if (branch.active === false) return res.status(400).json({ success: false, error: 'BRANCH_INACTIVE' });

      const updated = await drizzleDb
        .update(agentsTable)
        .set({ branchId })
        .where(eq(agentsTable.id, agentId))
        .returning();

      const agent = updated && updated.length ? updated[0] : null;
      if (!agent) {
        return res.status(404).json({ success: false, error: 'AGENT_NOT_FOUND' });
      }

      try {
        const fs = await getFirestore();
        await fs.collection('agents').doc(String(agentId)).set({ branchId }, { merge: true });
      } catch (_) {
      }

      return res.status(200).json({
        success: true,
        data: {
          agentId: agent.id,
          branchId: agent.branchId || null,
          branchCode: branch.code || null,
          branchName: branch.name || null,
        }
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'ASSIGN_BRANCH_FAILED', message: err.message });
    }
  }
);

function normalizeEmailLocal(email) {
  return String(email || '').trim().toLowerCase();
}

function extractEmailFromTextLocal(value) {
  try {
    const s = String(value || '').trim().toLowerCase();
    if (!s) return '';
    const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return m ? String(m[0] || '').trim().toLowerCase() : '';
  } catch (_) {
    return '';
  }
}

function normalizeStatusLocal(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function isAwaitingPaymentStatus(value) {
  const s = normalizeStatusLocal(value);
  if (!s) return false;
  return s === 'awaiting_payment';
}

function isAwaitingPaymentOrFailedStatus(value) {
  const s = normalizeStatusLocal(value);
  if (!s) return false;
  return s === 'awaiting_payment' || s === 'failed';
}

function isCompletedPaymentStatus(value) {
  const s = normalizeStatusLocal(value);
  if (!s) return false;
  return s === 'paid' || s === 'completed' || s === 'success' || s === 'succeeded' || s === 'confirmed' || s === 'booked';
}

function parseNumericLocal(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (!value.trim()) return NaN;
    const m = value.match(/[0-9]+(?:\.[0-9]+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }
  try {
    const s = String(value);
    const m = s.match(/[0-9]+(?:\.[0-9]+)?/);
    return m ? parseFloat(m[0]) : NaN;
  } catch (_) {
    return NaN;
  }
}

function computeRetailFromPgCartRow(row) {
  const directRetail = parseNumericLocal(row && row.retailPrice);
  if (Number.isFinite(directRetail) && directRetail > 0) return directRetail;

  const base = parseNumericLocal(row && row.costPrice);
  if (!Number.isFinite(base) || base <= 0) return 0;

  const markup = parseNumericLocal(row && row.markup);
  const discount = parseNumericLocal(row && row.discount);
  const charges = parseNumericLocal(row && row.charges);
  const roundDiff = parseNumericLocal(row && row.roundDiff);

  let total = base;
  if (Number.isFinite(markup)) total += markup;
  if (Number.isFinite(charges)) total += charges;
  if (Number.isFinite(discount)) total -= discount;
  if (Number.isFinite(roundDiff)) total += roundDiff;

  if (!Number.isFinite(total) || total < 0) return 0;
  return total;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const REPORT_TIMEZONE = String(process.env.REPORT_TIMEZONE || 'Africa/Johannesburg');

function toDateKeyInTimezone(value, timeZone = REPORT_TIMEZONE) {
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    // en-CA produces YYYY-MM-DD, which is safe for lexicographic comparisons.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch (_) {
    return null;
  }
}

// Agent self-registration (Postgres-first with Firestore fallback)
router.post(
  '/register',
  validateRequest([
    body('email').trim().notEmpty().isEmail().withMessage('Valid email is required'),
    body('branchId').trim().notEmpty().withMessage('Branch is required'),
    body('firstName').optional().isString(),
    body('lastName').optional().isString(),
    body('password').optional().isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('phone').optional().isString()
  ]),
  async (req, res) => {
    try {
      const { email, firstName = '', lastName = '', phone = '', password, branchId: branchIdRaw } = req.body || {};
      const emailLower = normalizeEmailLocal(email);
      const rawPassword = typeof password === 'string' ? password : '';
      const passwordHash = rawPassword && rawPassword.length >= 8
        ? await bcrypt.hash(String(rawPassword), 12)
        : null;

      const branchId = typeof branchIdRaw === 'string' ? branchIdRaw.trim() : String(branchIdRaw || '').trim();
      if (!branchId || !isUuid(branchId)) {
        return res.status(400).json({ success: false, error: 'INVALID_BRANCH_ID', message: 'Branch is required' });
      }
      await ensureDefaultBranches();
      const branchRows = await drizzleDb.select().from(branchesTable).where(eq(branchesTable.id, branchId)).limit(1);
      const branch = branchRows && branchRows.length ? branchRows[0] : null;
      if (!branch) {
        return res.status(404).json({ success: false, error: 'BRANCH_NOT_FOUND', message: 'Selected branch was not found' });
      }
      if (branch.active === false) {
        return res.status(400).json({ success: false, error: 'BRANCH_INACTIVE', message: 'Selected branch is inactive' });
      }

      const existingRows = await drizzleDb
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.emailLower, emailLower))
        .limit(1);
      const existing = existingRows && existingRows.length ? existingRows[0] : null;
      if (existing) {
        if (branchId && isUuid(branchId) && existing.branchId !== branchId) {
          try {
            await drizzleDb.update(agentsTable).set({ branchId }).where(eq(agentsTable.id, existing.id));
          } catch (_) {
          }
          try {
            const fs = await getFirestore();
            await fs.collection('agents').doc(String(existing.id)).set({ branchId }, { merge: true });
          } catch (_) {
          }
        }
        let passwordSet = false;
        try {
          const existingUser = await getUserByEmail(emailLower);
          if (existingUser?.id && isUuid(existingUser.id)) {
            const roleLower = String(existingUser.role || '').toLowerCase();
            if (roleLower !== 'agent') {
              try {
                await updateUser(existingUser.id, { role: 'agent' });
              } catch (_) {
              }
            }
            if (passwordHash && !existingUser.passwordHash) {
              await updateUser(existingUser.id, {
                passwordHash,
                role: 'agent',
                firstName: firstName || existingUser.firstName || '',
                lastName: lastName || existingUser.lastName || '',
                phone: phone || existingUser.phone || ''
              });
              passwordSet = true;
            }
          }
        } catch (_) {
        }
        return res.status(200).json({ success: true, agent: existing, duplicated: true, passwordSet });
      }

      // Ensure a backing user record exists (Postgres-first). If provided, set password for new users
      // and for existing users that currently have no password.
      let userId = req.user?.id && isUuid(req.user.id) ? req.user.id : null;
      if (!userId) {
        const existingUser = await getUserByEmail(emailLower);
        if (existingUser?.id && isUuid(existingUser.id)) {
          userId = existingUser.id;
          // Ensure the user role is agent for agent registration
          if (String(existingUser.role || '').toLowerCase() !== 'agent') {
            try {
              await updateUser(existingUser.id, { role: 'agent' });
            } catch (_) {
            }
          }
          // If account exists without a password and one was provided, set it now
          if (passwordHash && !existingUser.passwordHash) {
            try {
              await updateUser(existingUser.id, {
                passwordHash,
                role: 'agent',
                firstName: firstName || existingUser.firstName || '',
                lastName: lastName || existingUser.lastName || '',
                phone: phone || existingUser.phone || ''
              });
            } catch (_) {
            }
          }
        } else {
          const created = await createUser({ email: emailLower, passwordHash, firstName, lastName, phone, role: 'agent' });
          userId = created?.id || null;
        }
      } else {
        // If an authenticated user is registering as an agent, ensure role is agent
        if (req.user && String(req.user.role || '').toLowerCase() !== 'agent') {
          try {
            await updateUser(userId, { role: 'agent' });
          } catch (_) {
          }
        }
      }

      const agent = await upsertAgentForUser({
        id: userId,
        email: emailLower,
        firstName,
        lastName,
        phone,
        branchId
      });

      try {
        await createAdminNotificationForAll({
          title: 'New agent registration',
          message: `${[firstName, lastName].filter(Boolean).join(' ') || emailLower} registered and is awaiting approval.`,
          category: 'agent_approval',
          level: 'info',
          meta: {
            agentId: agent?.id || null,
            email: emailLower,
            firstName,
            lastName,
          }
        });
      } catch (_) {
      }

      return res.status(201).json({ success: true, agent });
    } catch (error) {
      logger.error('Agent registration failed', { message: error.message });
      return res.status(500).json({
        success: false,
        error: 'AGENT_REGISTRATION_FAILED',
        message: error.message || 'Agent registration failed'
      });
    }
  }
);

// Admin-approve agent (sets active=true)
router.post(
  '/:id/approve',
  verifyFirebaseAuth,
  requireRegisteredAdminApi,
  async (req, res) => {
    try {
      const agentId = req.params.id;
      const updated = await drizzleDb
        .update(agentsTable)
        .set({ active: true })
        .where(eq(agentsTable.id, agentId))
        .returning();
      const agent = updated && updated.length ? updated[0] : null;
      if (!agent) {
        return res.status(404).json({ success: false, error: 'AGENT_NOT_FOUND' });
      }
      // Best-effort Firestore update
      try {
        const fs = await getFirestore();
        await fs.collection('agents').doc(String(agentId)).set({ active: true }, { merge: true });
      } catch (e) {
        // ignore FS errors
      }

      try {
        await createAgentNotificationForEmail(agent.emailLower || '', {
          title: 'Your agent account is approved',
          message: 'Your agent account has been activated. You can now use the Agent Dashboard.',
          category: 'agent_approval',
          level: 'success',
          meta: { agentId: agent.id }
        });
      } catch (_) {
      }

      return res.status(200).json({ success: true, agent });
    } catch (error) {
      logger.error('Agent approval failed', { message: error.message });
      return res.status(500).json({ success: false, error: error.message || 'Agent approval failed' });
    }
  }
);

// Admin-deactivate agent (sets active=false)
router.post(
  '/:id/deactivate',
  verifyFirebaseAuth,
  requireRegisteredAdminApi,
  async (req, res) => {
    try {
      const agentId = req.params.id;
      const updated = await drizzleDb
        .update(agentsTable)
        .set({ active: false })
        .where(eq(agentsTable.id, agentId))
        .returning();
      const agent = updated && updated.length ? updated[0] : null;
      if (!agent) {
        return res.status(404).json({ success: false, error: 'AGENT_NOT_FOUND' });
      }
      // Best-effort Firestore update
      try {
        const fs = await getFirestore();
        await fs.collection('agents').doc(String(agentId)).set({ active: false }, { merge: true });
      } catch (e) {
        // ignore FS errors
      }

      try {
        await createAgentNotificationForEmail(agent.emailLower || '', {
          title: 'Your agent account was deactivated',
          message: 'Your agent account has been deactivated. Please contact an administrator if you believe this is a mistake.',
          category: 'agent_approval',
          level: 'warning',
          meta: { agentId: agent.id }
        });
      } catch (_) {
      }
      return res.status(200).json({ success: true, agent });
    } catch (error) {
      logger.error('Agent deactivation failed', { message: error.message });
      return res.status(500).json({ success: false, error: error.message || 'Agent deactivation failed' });
    }
  }
);

router.delete('/:id', verifyFirebaseAuth, requireRegisteredAdminApi, async (req, res) => {
  try {
    const agentId = req.params.id;
    const deleted = await drizzleDb
      .delete(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .returning();
    if (!deleted || !deleted.length) {
      return res.status(404).json({ success: false, error: 'AGENT_NOT_FOUND' });
    }
    try {
      const fs = await getFirestore();
      await fs.collection('agents').doc(String(agentId)).delete();
    } catch (e) {}
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Agent delete failed', { message: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Agent delete failed' });
  }
});

function toDateKeyUTC(d) {
  if (!d || isNaN(d.getTime())) return null;
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return u.toISOString().slice(0, 10);
}

function derivePurchaserEmail(purchase) {
  try {
    if (!purchase || typeof purchase !== 'object') return null;
    const user = purchase.user || purchase.purchaser || {};
    const email = user.email || null;
    if (!email) return null;
    return normalizeEmailLocal(email);
  } catch (e) {
    return null;
  }
}

function deriveCartPassengersCount(cart) {
  try {
    if (!cart || typeof cart !== 'object') return 0;
    const direct = Number(cart.passengerCount || 0);
    if (direct > 0) return direct;
    if (Array.isArray(cart.requiredPassengers)) return cart.requiredPassengers.length;
    if (Array.isArray(cart.selectedPassengers)) return cart.selectedPassengers.length;
    if (Array.isArray(cart.passengers)) return cart.passengers.length;
    const details = cart.details || cart.bookingDetails || {};
    if (Array.isArray(details.passengers)) return details.passengers.length;
    return 0;
  } catch (_) {
    return 0;
  }
}

function deriveCartOriginDestination(cart) {
  try {
    if (!cart || typeof cart !== 'object') return { origin: null, destination: null };
    const origin =
      cart.origin ||
      cart.originName ||
      cart.from ||
      (cart.trip && (cart.trip.origin || cart.trip.from)) ||
      (cart.selectedTrip && (cart.selectedTrip.origin || cart.selectedTrip.from)) ||
      null;
    const destination =
      cart.destination ||
      cart.destinationName ||
      cart.to ||
      (cart.trip && (cart.trip.destination || cart.trip.to)) ||
      (cart.selectedTrip && (cart.selectedTrip.destination || cart.selectedTrip.to)) ||
      null;
    return {
      origin: origin ? String(origin) : null,
      destination: destination ? String(destination) : null,
    };
  } catch (_) {
    return { origin: null, destination: null };
  }
}

async function loadCartInfoById(cartIds) {
  const ids = Array.from(new Set((cartIds || []).map((v) => String(v || '').trim()).filter(Boolean)));
  if (!ids.length) return new Map();

  const info = new Map();

  try {
    const rows = await drizzleDb
      .select({
        cartId: cartsPgTable.cartId,
        busbudCartId: cartsPgTable.busbudCartId,
        currency: cartsPgTable.currency,
        retailPrice: cartsPgTable.retailPrice,
        bookedBy: cartsPgTable.bookedBy,
        passengerCount: cartsPgTable.passengerCount,
        origin: cartsPgTable.origin,
        destination: cartsPgTable.destination,
      })
      .from(cartsPgTable)
      .where(or(inArray(cartsPgTable.cartId, ids), inArray(cartsPgTable.busbudCartId, ids)));

    for (const r of rows || []) {
      const payload = {
        cartId: r.cartId || null,
        busbudCartId: r.busbudCartId || null,
        currency: r.currency || null,
        revenue: computeRetailFromPgCartRow(r),
        passengerCount: r.passengerCount != null ? Number(r.passengerCount) : null,
        origin: r.origin || null,
        destination: r.destination || null,
        bookedBy: r.bookedBy || null,
      };

      const k1 = String(r.cartId || '').trim();
      const k2 = String(r.busbudCartId || '').trim();
      if (k1) info.set(k1, payload);
      if (k2) info.set(k2, payload);
    }
  } catch (_) {
  }

  return info;
}
function deriveCurrencyFromPurchase(purchase) {
  try {
    if (!purchase || typeof purchase !== 'object') return null;
    if (purchase.stats && purchase.stats.customer_value && purchase.stats.customer_value.currency) {
      return purchase.stats.customer_value.currency;
    }
    if (purchase.charges && purchase.charges.currency) {
      return purchase.charges.currency;
    }
    if (purchase.summary && purchase.summary.currency) {
      return purchase.summary.currency;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function buildAgentSalesSummary(agentEmail, query, extras = {}) {
  const normalizedAgent = normalizeEmailLocal(agentEmail);
  if (!normalizedAgent) {
    return {
      totalTicketsSold: 0,
      totalRevenue: 0,
      revenueByCurrency: {},
      perBranch: {},
      updatedAt: null,
      range: { key: String(query.range || 'all').toLowerCase() },
      rangeTotals: {
        totalBookings: 0,
        totalTickets: 0,
        totalRevenue: 0,
        revenueByCurrency: {},
        perBranch: {},
      },
      daily: [],
      summaryTable: { byBranch: [], byOperator: [], byPaymentType: [] },
      rows: [],
      rawCarts: [],
      countersSummary: null,
    };
  }

  const allowFirestoreFallback =
    (String(process.env.AGENT_REPORTS_USE_FIRESTORE_FALLBACK || '').trim().toLowerCase() === 'true') &&
    !(extras && extras.skipFirestoreFallback);

  const rangeKey = String(query.range || 'all').toLowerCase();
  const specificDate = query.date ? String(query.date).slice(0, 10) : null;
  const limit = Math.min(Number(query.limit || 500), 2000);

  let allowedDateKeys = null;
  let minAllowedDateKey = null;
  let maxAllowedDateKey = null;
  if (specificDate) {
    allowedDateKeys = new Set([specificDate]);
    minAllowedDateKey = specificDate;
    maxAllowedDateKey = specificDate;
  } else if (rangeKey === 'today') {
    const now = new Date();
    const key = toDateKeyInTimezone(now);
    allowedDateKeys = new Set([key]);
    minAllowedDateKey = key;
    maxAllowedDateKey = key;
  } else if (rangeKey === '7d') {
    allowedDateKeys = new Set();
    const today = new Date();
    const baseUtcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (let i = 7 - 1; i >= 0; i--) {
      const d = new Date(baseUtcMidnight);
      d.setUTCDate(baseUtcMidnight.getUTCDate() - i);
      const key = toDateKeyInTimezone(d);
      allowedDateKeys.add(key);
      if (!minAllowedDateKey || key < minAllowedDateKey) minAllowedDateKey = key;
      if (!maxAllowedDateKey || key > maxAllowedDateKey) maxAllowedDateKey = key;
    }
  } else if (rangeKey === '30d') {
    allowedDateKeys = new Set();
    const today = new Date();
    const baseUtcMidnight = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (let i = 30 - 1; i >= 0; i--) {
      const d = new Date(baseUtcMidnight);
      d.setUTCDate(baseUtcMidnight.getUTCDate() - i);
      const key = toDateKeyInTimezone(d);
      allowedDateKeys.add(key);
      if (!minAllowedDateKey || key < minAllowedDateKey) minAllowedDateKey = key;
      if (!maxAllowedDateKey || key > maxAllowedDateKey) maxAllowedDateKey = key;
    }
  }

  let totalTicketsAll = 0;
  let totalRevenueAll = 0;
  const revenueByCurrencyAll = {};
  const rows = [];

  const includeDebug = String((query && query.debug) || '').toLowerCase() === '1' || String((query && query.debug) || '').toLowerCase() === 'true';
  const debug = includeDebug
    ? {
      paymentsMatched: [],
      paymentsMatchedPaid: [],
      paymentsCounted: [],
    }
    : null;

  let cartAgentEmailMap = new Map();
  const seenPaymentRefs = new Set();

  const agentNameLower = (extras && typeof extras.agentNameLower === 'string')
    ? extras.agentNameLower.trim().toLowerCase()
    : '';

  let totalBookingsFromCarts = 0;
  try {
    const bookedByExpr = sql`lower(${cartsPgTable.bookedBy})`;
    const bookedByConds = [eq(bookedByExpr, normalizedAgent)];
    if (agentNameLower) bookedByConds.push(eq(bookedByExpr, agentNameLower));

    const filters = [or(...bookedByConds)];
    const createdAtDateExpr = sql`((${cartsPgTable.createdAt} AT TIME ZONE ${REPORT_TIMEZONE})::date)`;
    if (specificDate) {
      filters.push(eq(createdAtDateExpr, specificDate));
    } else if (minAllowedDateKey && maxAllowedDateKey) {
      filters.push(gte(createdAtDateExpr, minAllowedDateKey));
      filters.push(lte(createdAtDateExpr, maxAllowedDateKey));
    }

    const countRows = await drizzleDb
      .select({ count: sql`count(*)` })
      .from(cartsPgTable)
      .where(and(...filters));

    const rawCount = countRows && countRows[0] ? countRows[0].count : 0;
    const n = Number(rawCount);
    totalBookingsFromCarts = Number.isFinite(n) ? n : (parseInt(String(rawCount || '0'), 10) || 0);
  } catch (_) {
    totalBookingsFromCarts = 0;
  }

  const pageSize = Math.min(limit, 2000);
  const maxPages = 50;
  let exhaustedRange = false;

  for (let page = 0; page < maxPages && !exhaustedRange; page++) {
    const paymentRows = await drizzleDb
      .select({
        createdAt: payments.createdAt,
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        bookedBy: payments.bookedBy,
        transactionRef: payments.transactionRef,
        rawResponse: payments.rawResponse,
      })
      .from(payments)
      .orderBy(desc(payments.createdAt))
      .limit(pageSize)
      .offset(page * pageSize);

    if (!paymentRows || !paymentRows.length) break;

    // Postgres carts lookup (preferred) to improve agent matching + passengers count.
    let pagePgCartMap = new Map();
    try {
      const refs = Array.from(new Set((paymentRows || []).map((r) => r.transactionRef).filter(Boolean))).map((v) => String(v));
      if (refs.length) {
        const cartRows = await drizzleDb
          .select({
            cartId: cartsPgTable.cartId,
            busbudCartId: cartsPgTable.busbudCartId,
            bookedBy: cartsPgTable.bookedBy,
            passengerCount: cartsPgTable.passengerCount,
            origin: cartsPgTable.origin,
            destination: cartsPgTable.destination,
          })
          .from(cartsPgTable)
          .where(or(inArray(cartsPgTable.cartId, refs), inArray(cartsPgTable.busbudCartId, refs)));

        pagePgCartMap = new Map();
        for (const c of cartRows || []) {
          const ids = [c.cartId, c.busbudCartId].map((x) => String(x || '').trim()).filter(Boolean);
          for (const id of ids) {
            pagePgCartMap.set(id, c);
          }
        }
      }
    } catch (_) {
      pagePgCartMap = new Map();
    }

    // Best-effort Firestore cart agentEmail lookup for additional matching
    let pageCartAgentEmailMap = new Map();
    if (allowFirestoreFallback) {
      try {
        const fs = await getFirestore();
        const refs = Array.from(new Set((paymentRows || []).map((r) => r.transactionRef).filter(Boolean)));
        const snaps = await Promise.all(
          refs.map(async (ref) => {
            try {
              const snap = await fs.collection('carts').doc(String(ref)).get();
              if (!snap.exists) return { ref, email: null };
              const cart = snap.data() || {};
              const email = (cart.agentEmail || (cart.agent && cart.agent.agentEmail) || '').trim().toLowerCase();
              return { ref, email: email || null };
            } catch (_) {
              return { ref, email: null };
            }
          })
        );
        pageCartAgentEmailMap = new Map(snaps.map((s) => [s.ref, s.email]));
        for (const [k, v] of pageCartAgentEmailMap.entries()) {
          cartAgentEmailMap.set(k, v);
        }
      } catch (_) {}
    }

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const dayKey = toDateKeyInTimezone(createdAt);

      if (minAllowedDateKey && dayKey && dayKey < minAllowedDateKey) {
        exhaustedRange = true;
        break;
      }

      const purchase = row.rawResponse || {};
      const purchaserEmail = derivePurchaserEmail(purchase);
      const bookedByNorm = normalizeEmailLocal(row.bookedBy || '');

      const refKey = row.transactionRef ? String(row.transactionRef) : '';
      const pgCart = refKey ? (pagePgCartMap.get(refKey) || null) : null;
      const cartBookedByRaw = pgCart && pgCart.bookedBy ? String(pgCart.bookedBy) : '';
      const cartBookedByNorm = normalizeEmailLocal(cartBookedByRaw);
      const cartBookedByEmail = extractEmailFromTextLocal(cartBookedByRaw);

      const matchesAgent =
        (bookedByNorm && bookedByNorm === normalizedAgent) ||
        (cartBookedByEmail && cartBookedByEmail === normalizedAgent) ||
        (cartBookedByNorm && cartBookedByNorm === normalizedAgent) ||
        (agentNameLower && row.bookedBy && String(row.bookedBy).trim().toLowerCase() === agentNameLower) ||
        (agentNameLower && cartBookedByRaw && String(cartBookedByRaw).trim().toLowerCase() === agentNameLower) ||
        (row.transactionRef && pageCartAgentEmailMap.get(row.transactionRef) === normalizedAgent);

      if (!matchesAgent) {
        continue;
      }

      let inRange = true;
      if (allowedDateKeys && dayKey) {
        inRange = allowedDateKeys.has(dayKey);
      } else if (allowedDateKeys && !dayKey) {
        inRange = false;
      }
      if (specificDate && dayKey && dayKey !== specificDate) {
        inRange = false;
      }
      if (!inRange) {
        continue;
      }

      const booking = purchase && typeof purchase === 'object' ? (purchase.booking || {}) : {};
      const ticketsArr = booking && Array.isArray(booking.tickets) ? booking.tickets : null;
      const pgPassengers = pgCart && pgCart.passengerCount != null ? Number(pgCart.passengerCount) : 0;
      const fallbackPassengers = Array.isArray(purchase.items) ? purchase.items.length : 0;
      const passengersCount =
        ticketsArr && ticketsArr.length
          ? ticketsArr.length
          : (Number.isFinite(pgPassengers) && pgPassengers > 0 ? pgPassengers : fallbackPassengers);
      const revenue = Number(row.amount || 0);
      const currency = deriveCurrencyFromPurchase(purchase) || 'USD';
      const isPaid = isCompletedPaymentStatus(row.status);

      if (debug) {
        const snapshot = {
          transactionRef: row.transactionRef || null,
          status: row.status || null,
          dayKey: dayKey || null,
          passengersCount,
          cartBookedBy: cartBookedByRaw || null,
          cartPassengerCount: Number.isFinite(pgPassengers) ? pgPassengers : null,
          isPaid,
          amount: revenue,
        };
        if (debug.paymentsMatched.length < 50) debug.paymentsMatched.push(snapshot);
        if (isPaid && debug.paymentsMatchedPaid.length < 50) debug.paymentsMatchedPaid.push(snapshot);
      }

      const firstTime = refKey ? !seenPaymentRefs.has(refKey) : true;
      if (refKey) seenPaymentRefs.add(refKey);

      if (firstTime && isPaid) {
        totalTicketsAll += passengersCount;
        if (revenue > 0) {
          totalRevenueAll += revenue;
          revenueByCurrencyAll[currency] = (revenueByCurrencyAll[currency] || 0) + revenue;
        }

        if (debug && debug.paymentsCounted.length < 50) {
          debug.paymentsCounted.push({
            transactionRef: row.transactionRef || null,
            passengersCount,
            amount: revenue,
            currency,
          });
        }
      }

      if (rows.length < limit) {
        const origin = pgCart && pgCart.origin ? String(pgCart.origin) : null;
        const destination = pgCart && pgCart.destination ? String(pgCart.destination) : null;
        rows.push({
          cartId: row.transactionRef || null,
          busbudCartId: pgCart && pgCart.busbudCartId ? String(pgCart.busbudCartId) : null,
          reference: row.transactionRef || null,
          createdAt,
          userId: null,
          purchaserEmail: purchaserEmail,
          operator: null,
          origin,
          destination,
          branch: null,
          paymentType: row.method || null,
          status: row.status || null,
          passengers: passengersCount,
          revenue,
          currency,
          cost: 0,
          profit: revenue,
          margin: revenue > 0 ? 1 : 0,
        });
      }
    }
  }

  // Best-effort enrichment to ensure the exported CSV includes origin/destination.
  // This looks up carts in Postgres first, then falls back to Firestore carts.
  if (!(extras && extras.skipExportEnrichment)) {
    try {
      const refs = Array.from(
        new Set(
          (rows || [])
            .map((r) => String((r && (r.reference || r.cartId)) || '').trim())
            .filter(Boolean)
        )
      );
      const cartInfoById = await loadCartInfoById(refs);
      for (const r of rows || []) {
        const ref = String((r && (r.reference || r.cartId)) || '').trim();
        if (!ref) continue;
        if (r && r.origin && r.destination) continue;
        const info = cartInfoById.get(ref);
        if (!info) continue;
        if (r && !r.origin && info.origin) r.origin = info.origin;
        if (r && !r.destination && info.destination) r.destination = info.destination;
      }
    } catch (_) {}
  }

  if (allowFirestoreFallback) {
    try {
      const fs = await getFirestore();
      const take = limit;
      const failedSnap = await fs.collection('failed_tickets').orderBy('createdAt', 'desc').limit(take).get();
      const okSnap = await fs.collection('tickets').orderBy('createdAt', 'desc').limit(take).get();
      const docs = [
        ...failedSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}), __kind: 'failed' })),
        ...okSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}), __kind: 'ok' })),
      ];

      const seen = new Set(seenPaymentRefs);
      const extraRefs = Array.from(new Set(docs.map((d) => String(d.paymentRef || d.cartId || d.id || '')).filter(Boolean))).filter((ref) => !seen.has(ref));
      if (extraRefs.length) {
        const checks = await Promise.all(
          extraRefs.map(async (ref) => {
            try {
              const snap = await fs.collection('carts').doc(String(ref)).get();
              if (!snap.exists) return { ref, email: null };
              const cart = snap.data() || {};
              const email = (cart.agentEmail || (cart.agent && cart.agent.agentEmail) || '').trim().toLowerCase();
              return { ref, email: email || null };
            } catch (_) {
              return { ref, email: null };
            }
          })
        );
        for (const c of checks) {
          if (c && c.ref) cartAgentEmailMap.set(c.ref, c.email || null);
        }
      }

      for (const d of docs) {
        const ref = String(d.paymentRef || d.cartId || d.id || '');
        if (!ref || seen.has(ref)) continue;
        const agentForRef = cartAgentEmailMap.get(ref) || '';
        if (!agentForRef || agentForRef !== normalizedAgent) continue;

        const createdAtRaw = d.paymentDate || d.createdAt || new Date().toISOString();
        const createdAt = new Date(createdAtRaw);
        const dateKey = toDateKeyInTimezone(createdAt);
        let inRange = true;
        if (allowedDateKeys && dateKey) inRange = allowedDateKeys.has(dateKey);
        if (specificDate && dateKey && dateKey !== specificDate) inRange = false;
        if (!inRange) continue;

        const busbud = d.busbudPurchase || {};
        const ticketsArr = busbud && busbud.booking && Array.isArray(busbud.booking.tickets) ? busbud.booking.tickets : [];
        const passengersCount = ticketsArr.length || 0;
        const revenue = Number(d.adjustedTotal || d.originalTotal || 0) || 0;
        const currency = d.currency || 'USD';
        const status = (d.status || (busbud && busbud.status) || (d.__kind === 'failed' ? 'failed' : 'completed')) || null;

        // Firestore fallback rows are not used for paid totals; paid metrics come from Postgres payments.

        if (rows.length < limit) {
          rows.push({
            cartId: d.cartId || null,
            busbudCartId: d.cartId || null,
            reference: ref,
            createdAt,
            userId: null,
            purchaserEmail: normalizedAgent,
            operator: null,
            origin: null,
            destination: null,
            branch: null,
            paymentType: null,
            status,
            passengers: passengersCount,
            revenue,
            currency,
            cost: 0,
            profit: revenue,
            margin: revenue > 0 ? 1 : 0,
          });
        }
        seen.add(ref);
      }
    } catch (_) {}
  }

  try {
    rows.sort((a, b) => {
      const ad = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bd = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bd - ad;
    });
  } catch (_) {}

  const rangeTotals = {
    totalBookings: totalBookingsFromCarts,
    totalTickets: totalTicketsAll,
    totalRevenue: totalRevenueAll,
    revenueByCurrency: revenueByCurrencyAll,
    perBranch: {},
  };

  return {
    totalTicketsSold: totalTicketsAll,
    totalRevenue: totalRevenueAll,
    revenueByCurrency: revenueByCurrencyAll,
    perBranch: {},
    updatedAt: null,
    range: {
      key: rangeKey,
    },
    rangeTotals,
    daily: [],
    summaryTable: { byBranch: [], byOperator: [], byPaymentType: [] },
    rows,
    rawCarts: [],
    countersSummary: null,
    ...(debug ? { debug } : {}),
  };
}

async function fetchAgentRecentBookings(agentEmail, limit = 5, extras = {}) {
  const safeLimit = Math.min(Math.max(Number(limit || 5) || 5, 1), 50);
  const normalizedAgent = normalizeEmailLocal(agentEmail);
  const agentNameLower = (extras && typeof extras.agentNameLower === 'string') ? extras.agentNameLower.trim().toLowerCase() : '';

  if (!normalizedAgent) return [];

  const byRef = new Map();
  const upsertRow = (row) => {
    try {
      if (!row) return;
      const ref = String(row.reference || row.cartId || '').trim();
      if (!ref) return;
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date(0);
      const existing = byRef.get(ref);
      if (!existing) {
        byRef.set(ref, { ...row, reference: ref, createdAt });
        return;
      }
      const existingAt = existing.createdAt ? new Date(existing.createdAt) : new Date(0);
      if (createdAt.getTime() >= existingAt.getTime()) {
        byRef.set(ref, { ...existing, ...row, reference: ref, createdAt });
      }
    } catch (_) {
    }
  };

  const buildBookedByLike = (s) => `%${String(s || '').trim().toLowerCase()}%`;

  const paymentBookedByExpr = sql`lower(${payments.bookedBy})`;
  const cartBookedByExpr = sql`lower(${cartsPgTable.bookedBy})`;

  // 1) Paid bookings: filter payments in SQL by bookedBy
  try {
    const paymentBookedByConds = [
      eq(paymentBookedByExpr, normalizedAgent),
      sql`${paymentBookedByExpr} like ${buildBookedByLike(normalizedAgent)}`,
    ];
    if (agentNameLower) {
      paymentBookedByConds.push(eq(paymentBookedByExpr, agentNameLower));
      paymentBookedByConds.push(sql`${paymentBookedByExpr} like ${buildBookedByLike(agentNameLower)}`);
    }

    const paymentRows = await drizzleDb
      .select({
        createdAt: payments.createdAt,
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        bookedBy: payments.bookedBy,
        transactionRef: payments.transactionRef,
        rawResponse: payments.rawResponse,
      })
      .from(payments)
      .where(or(...paymentBookedByConds))
      .orderBy(desc(payments.createdAt))
      .limit(200);

    const refs = Array.from(new Set((paymentRows || []).map((r) => String(r && r.transactionRef ? r.transactionRef : '').trim()).filter(Boolean)));
    let pgCartMap = new Map();
    try {
      if (refs.length) {
        const cartRows = await drizzleDb
          .select({
            cartId: cartsPgTable.cartId,
            busbudCartId: cartsPgTable.busbudCartId,
            bookedBy: cartsPgTable.bookedBy,
            passengerCount: cartsPgTable.passengerCount,
            origin: cartsPgTable.origin,
            destination: cartsPgTable.destination,
            currency: cartsPgTable.currency,
            retailPrice: cartsPgTable.retailPrice,
            costPrice: cartsPgTable.costPrice,
            markup: cartsPgTable.markup,
            discount: cartsPgTable.discount,
            charges: cartsPgTable.charges,
            roundDiff: cartsPgTable.roundDiff,
          })
          .from(cartsPgTable)
          .where(or(inArray(cartsPgTable.cartId, refs), inArray(cartsPgTable.busbudCartId, refs)));

        for (const c of cartRows || []) {
          const ids = [c.cartId, c.busbudCartId].map((x) => String(x || '').trim()).filter(Boolean);
          for (const id of ids) {
            pgCartMap.set(id, c);
          }
        }
      }
    } catch (_) {
      pgCartMap = new Map();
    }

    for (const r of paymentRows || []) {
      const ref = String(r && r.transactionRef ? r.transactionRef : '').trim();
      if (!ref) continue;

      const pgCart = pgCartMap.get(ref) || null;
      const createdAt = r.createdAt ? new Date(r.createdAt) : new Date();
      const purchase = r.rawResponse || {};
      const currency = deriveCurrencyFromPurchase(purchase) || (pgCart && pgCart.currency) || 'USD';
      const passengers = (() => {
        const n = pgCart && pgCart.passengerCount != null ? Number(pgCart.passengerCount) : 0;
        return Number.isFinite(n) && n > 0 ? n : 0;
      })();

      upsertRow({
        cartId: ref,
        busbudCartId: pgCart && pgCart.busbudCartId ? String(pgCart.busbudCartId) : null,
        reference: ref,
        createdAt,
        userId: null,
        purchaserEmail: derivePurchaserEmail(purchase),
        operator: null,
        origin: pgCart && pgCart.origin ? String(pgCart.origin) : null,
        destination: pgCart && pgCart.destination ? String(pgCart.destination) : null,
        branch: null,
        paymentType: r.method || null,
        status: r.status || null,
        passengers,
        revenue: Number(r.amount || 0),
        currency,
        cost: 0,
        profit: Number(r.amount || 0),
        margin: Number(r.amount || 0) > 0 ? 1 : 0,
      });
    }
  } catch (_) {
  }

  // 2) Recent carts: filter carts in SQL by bookedBy then bulk lookup payments for those refs
  try {
    const cartBookedByConds = [
      eq(cartBookedByExpr, normalizedAgent),
      sql`${cartBookedByExpr} like ${buildBookedByLike(normalizedAgent)}`,
    ];
    if (agentNameLower) {
      cartBookedByConds.push(eq(cartBookedByExpr, agentNameLower));
      cartBookedByConds.push(sql`${cartBookedByExpr} like ${buildBookedByLike(agentNameLower)}`);
    }

    const cartRows = await drizzleDb
      .select({
        cartId: cartsPgTable.cartId,
        busbudCartId: cartsPgTable.busbudCartId,
        createdAt: cartsPgTable.createdAt,
        updatedAt: cartsPgTable.updatedAt,
        status: cartsPgTable.status,
        bookedBy: cartsPgTable.bookedBy,
        passengerCount: cartsPgTable.passengerCount,
        origin: cartsPgTable.origin,
        destination: cartsPgTable.destination,
        currency: cartsPgTable.currency,
        retailPrice: cartsPgTable.retailPrice,
        costPrice: cartsPgTable.costPrice,
        markup: cartsPgTable.markup,
        discount: cartsPgTable.discount,
        charges: cartsPgTable.charges,
        roundDiff: cartsPgTable.roundDiff,
      })
      .from(cartsPgTable)
      .where(or(...cartBookedByConds))
      .orderBy(desc(cartsPgTable.createdAt))
      .limit(Math.max(200, safeLimit * 10));

    const refs = Array.from(new Set((cartRows || []).map((c) => String(c && c.cartId ? c.cartId : '').trim()).filter(Boolean)));

    let paymentMap = new Map();
    try {
      if (refs.length) {
        const payRows = await drizzleDb
          .select({
            createdAt: payments.createdAt,
            amount: payments.amount,
            method: payments.method,
            status: payments.status,
            transactionRef: payments.transactionRef,
            rawResponse: payments.rawResponse,
          })
          .from(payments)
          .where(inArray(payments.transactionRef, refs))
          .orderBy(desc(payments.createdAt));

        paymentMap = new Map();
        for (const p of payRows || []) {
          const ref = p && p.transactionRef ? String(p.transactionRef).trim() : '';
          if (!ref) continue;
          if (!paymentMap.has(ref)) paymentMap.set(ref, p);
        }
      }
    } catch (_) {
      paymentMap = new Map();
    }

    for (const c of cartRows || []) {
      const ref = String(c && c.cartId ? c.cartId : '').trim();
      if (!ref) continue;

      const pay = paymentMap.get(ref) || null;
      const createdAt = pay && pay.createdAt
        ? new Date(pay.createdAt)
        : (c.createdAt ? new Date(c.createdAt) : (c.updatedAt ? new Date(c.updatedAt) : new Date()));

      const passengers = (() => {
        const n = c && c.passengerCount != null ? Number(c.passengerCount) : 0;
        return Number.isFinite(n) && n > 0 ? n : 0;
      })();

      const purchase = pay && pay.rawResponse ? (pay.rawResponse || {}) : {};
      const revenue = pay ? Number(pay.amount || 0) : computeRetailFromPgCartRow(c);
      const currency = (pay ? deriveCurrencyFromPurchase(purchase) : null) || c.currency || 'USD';

      upsertRow({
        cartId: ref,
        busbudCartId: c && c.busbudCartId ? String(c.busbudCartId) : null,
        reference: ref,
        createdAt,
        userId: null,
        purchaserEmail: pay ? derivePurchaserEmail(purchase) : null,
        operator: null,
        origin: c.origin || null,
        destination: c.destination || null,
        branch: null,
        paymentType: pay ? (pay.method || null) : null,
        status: pay ? (pay.status || null) : (c.status || 'awaiting_payment'),
        passengers,
        revenue,
        currency,
        cost: 0,
        profit: revenue,
        margin: revenue > 0 ? 1 : 0,
      });
    }
  } catch (_) {
  }

  try {
    const rows = Array.from(byRef.values());
    rows.sort((a, b) => {
      const ta = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    return rows.slice(0, safeLimit);
  } catch (_) {
    return Array.from(byRef.values()).slice(0, safeLimit);
  }
}

router.get('/me', requireAgentApi, (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }
  const { passwordHash, password, passwordConfirm, passwordResetToken, passwordResetExpires, ...safeUser } = req.user;
  return res.status(200).json({
    ...safeUser,
    agent: req.agent || null
  });
});

router.patch(
  '/me',
  requireAgentApi,
  validateRequest([
    body('firstName').optional().isString().trim(),
    body('lastName').optional().isString().trim(),
    body('phone').optional().isString().trim()
  ]),
  async (req, res, next) => {
    try {
      const user = req.user;
      const agent = req.agent;
      if (!user) {
        return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
      }

      const updates = {};
      if (typeof req.body.firstName === 'string') updates.firstName = req.body.firstName;
      if (typeof req.body.lastName === 'string') updates.lastName = req.body.lastName;
      if (typeof req.body.phone === 'string') updates.phone = req.body.phone;

      const updatedUser = Object.keys(updates).length ? await updateUser(user.id, updates) : user;

      if (agent && agent.id) {
        try {
          const db = await getFirestore();
          const ref = db.collection('agents').doc(String(agent.id));
          const agentUpdates = { ...updates };
          if (Object.keys(agentUpdates).length) {
            await ref.update({ ...agentUpdates, updatedAt: FieldValue.serverTimestamp() });
            const snap = await ref.get();
            req.agent = { id: snap.id, ...snap.data() };
          }
        } catch (err) {
        }
      }

      const { passwordHash, password, passwordConfirm, passwordResetToken, passwordResetExpires, ...safeUpdatedUser } = updatedUser;
      return res.status(200).json({
        ...safeUpdatedUser,
        agent: req.agent || agent || null
      });
    } catch (err) {
      next(err);
    }
  }
);

router.get('/reports/recent-bookings', requireAgentApi, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('ETag', `${Date.now()}`);

    const user = req.user;
    const email = user && user.email;
    if (!email) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }

    const limit = Math.min(Math.max(Number(req.query.limit || 5) || 5, 1), 50);

    const baseUser = req.user || {};
    const agentName =
      baseUser.name ||
      [baseUser.firstName || baseUser.first_name || '', baseUser.lastName || baseUser.last_name || '']
        .filter(Boolean)
        .join(' ');

    const rows = await fetchAgentRecentBookings(email, limit, { agentNameLower: (agentName || '').toLowerCase() });
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    logger.error('Failed to load agent recent bookings', {
      error: err && err.message,
      stack: err && err.stack,
    });
    return res.status(500).json({
      success: false,
      error: 'AGENT_RECENT_BOOKINGS_FAILED',
      message: (err && err.message) || 'Failed to load recent bookings',
    });
  }
});

router.get('/reports/sales-summary', requireAgentApi, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('ETag', `${Date.now()}`);

    const user = req.user;
    const email = user && user.email;
    if (!email) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }

    const baseUser = req.user || {};
    const agentName =
      baseUser.name ||
      [baseUser.firstName || baseUser.first_name || '', baseUser.lastName || baseUser.last_name || '']
        .filter(Boolean)
        .join(' ');
    const data = await buildAgentSalesSummary(email, req.query || {}, {
      agentNameLower: (agentName || '').toLowerCase(),
      skipFirestoreFallback: true,
      skipExportEnrichment: true,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    logger.error('Failed to load agent sales summary', {
      error: err && err.message,
      stack: err && err.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'AGENT_SALES_SUMMARY_FAILED',
      message: (err && err.message) || 'Failed to load agent sales summary',
    });
  }
});

router.get('/reports/sales-summary.csv', requireAgentApi, async (req, res) => {
  try {
    const user = req.user;
    const email = user && user.email;
    if (!email) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }

    const data = await buildAgentSalesSummary(email, req.query || {});
    const rows = Array.isArray(data.rows) ? data.rows : [];

    const csvRows = rows.map((row) => {
      const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt || '';
      return {
        reference: row.reference || row.cartId || '',
        date: createdAt,
        origin: row.origin || '',
        destination: row.destination || '',
        passengers: row.passengers || 0,
        amount: row.revenue || 0,
        currency: row.currency || '',
        status: row.status || '',
      };
    });

    const parser = new Json2CsvParser({
      fields: [
        { label: 'Reference', value: 'reference' },
        { label: 'Date', value: 'date' },
        { label: 'Origin', value: 'origin' },
        { label: 'Destination', value: 'destination' },
        { label: 'Passengers', value: 'passengers' },
        { label: 'Amount', value: 'amount' },
        { label: 'Currency', value: 'currency' },
        { label: 'Status', value: 'status' },
      ],
    });

    const csv = parser.parse(csvRows);
    const suffix = (req.query.date && String(req.query.date).slice(0, 10)) || String(req.query.range || 'all');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="agent-sales-summary-${suffix}.csv"`);
    return res.status(200).send(csv);
  } catch (err) {
    logger.error('Failed to export agent sales summary CSV', {
      error: err && err.message,
      stack: err && err.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'AGENT_SALES_SUMMARY_CSV_FAILED',
      message: (err && err.message) || 'Failed to export agent sales summary CSV',
    });
  }
});

router.get('/reports/sales-summary.pdf', requireAgentApi, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('ETag', `${Date.now()}`);

    const user = req.user;
    const email = user && user.email;
    if (!email) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    }

    const baseUser = req.user || {};
    const agentName =
      baseUser.name ||
      [baseUser.firstName || baseUser.first_name || '', baseUser.lastName || baseUser.last_name || '']
        .filter(Boolean)
        .join(' ');

    const rangeKey = String(req.query.range || 'all').toLowerCase();
    const specificDate = req.query.date ? String(req.query.date).slice(0, 10) : null;
    const data = await buildAgentSalesSummary(email, req.query || {}, { agentNameLower: (agentName || '').toLowerCase() });

    const rows = Array.isArray(data.rows) ? data.rows : [];
    const totals = (data && data.rangeTotals) || {};

    const escapeHtml = (value) => {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const rangeLabel = specificDate
      ? `Date: ${specificDate}`
      : rangeKey === 'today'
        ? 'Today'
        : rangeKey === '7d'
          ? 'Last 7 days'
          : rangeKey === '30d'
            ? 'Last 30 days'
            : 'All time';

    const revenueByCurrency = (totals && totals.revenueByCurrency && typeof totals.revenueByCurrency === 'object')
      ? totals.revenueByCurrency
      : {};
    const currencyLines = Object.keys(revenueByCurrency || {}).length
      ? Object.keys(revenueByCurrency)
          .sort()
          .map((k) => {
            const v = revenueByCurrency[k];
            return `<div class="kv"><span class="k">Revenue (${escapeHtml(k)})</span><span class="v">${escapeHtml(v)}</span></div>`;
          })
          .join('')
      : '';

    const tableHtml = rows.length
      ? `
        <table class="table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Date</th>
              <th>Origin</th>
              <th>Destination</th>
              <th class="num">Passengers</th>
              <th class="num">Amount</th>
              <th>Currency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map((r) => {
                const createdAt = r && r.createdAt instanceof Date ? r.createdAt.toISOString() : (r && r.createdAt) || '';
                return `
                  <tr>
                    <td>${escapeHtml(r.reference || r.cartId || '')}</td>
                    <td>${escapeHtml(createdAt)}</td>
                    <td>${escapeHtml(r.origin || '')}</td>
                    <td>${escapeHtml(r.destination || '')}</td>
                    <td class="num">${escapeHtml(r.passengers || 0)}</td>
                    <td class="num">${escapeHtml(r.revenue || 0)}</td>
                    <td>${escapeHtml(r.currency || '')}</td>
                    <td>${escapeHtml(r.status || '')}</td>
                  </tr>`;
              })
              .join('')}
          </tbody>
        </table>`
      : '<div class="muted">No rows found for this filter.</div>';

    const generatedAt = new Date();
    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Agent Sales Summary</title>
          <style>
            :root { --text: #111827; --muted: #6b7280; --border: #e5e7eb; --bg: #ffffff; --head: #f3f4f6; }
            * { box-sizing: border-box; }
            body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; color: var(--text); background: var(--bg); margin: 0; }
            .page { padding: 18px; }
            .header { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
            .title { font-size: 18px; font-weight: 800; margin: 0; }
            .meta { font-size: 11px; color: var(--muted); text-align: right; }
            .cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 12px 0 14px; }
            .card { border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
            .kv { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 11px; margin: 2px 0; }
            .k { color: var(--muted); }
            .v { font-weight: 700; }
            .muted { font-size: 11px; color: var(--muted); }
            .table { width: 100%; border-collapse: collapse; font-size: 10px; }
            .table thead { display: table-header-group; }
            .table th { background: var(--head); text-align: left; padding: 6px 6px; border: 1px solid var(--border); font-weight: 800; }
            .table td { padding: 6px 6px; border: 1px solid var(--border); vertical-align: top; }
            .num { text-align: right; white-space: nowrap; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="header">
              <h1 class="title">Agent Sales Summary</h1>
              <div class="meta">
                <div>${escapeHtml(rangeLabel)}</div>
                <div>${escapeHtml(agentName || email || '')}</div>
                <div>Generated ${escapeHtml(generatedAt.toISOString())}</div>
              </div>
            </div>
            <div class="cards">
              <div class="card">
                <div class="kv"><span class="k">Total bookings</span><span class="v">${escapeHtml(totals.totalBookings || 0)}</span></div>
                <div class="kv"><span class="k">Total tickets</span><span class="v">${escapeHtml(totals.totalTickets || 0)}</span></div>
              </div>
              <div class="card">
                <div class="kv"><span class="k">Total revenue</span><span class="v">${escapeHtml(totals.totalRevenue || 0)}</span></div>
                ${currencyLines || '<div class="muted">Per-currency totals not available.</div>'}
              </div>
              <div class="card">
                <div class="muted">Rows included: ${escapeHtml(rows.length)}</div>
                <div class="muted">Filters: range=${escapeHtml(rangeKey)}${specificDate ? `, date=${escapeHtml(specificDate)}` : ''}</div>
              </div>
            </div>
            ${tableHtml}
          </div>
        </body>
      </html>
    `;

    const pdfBuffer = await generatePdfFromHtml(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });

    const suffix = specificDate || rangeKey || 'all';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="agent-sales-summary-${suffix}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    logger.error('Failed to export agent sales summary PDF', {
      error: err && err.message,
      stack: err && err.stack,
    });

    return res.status(500).json({
      success: false,
      error: 'AGENT_SALES_SUMMARY_PDF_FAILED',
      message: (err && err.message) || 'Failed to export agent sales summary PDF',
    });
  }
});

export default router;
