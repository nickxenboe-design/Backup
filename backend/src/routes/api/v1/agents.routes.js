import express from 'express';
import { body } from 'express-validator';
import { validateRequest } from '../../../middlewares/validateRequest.js';
import { requireAgentApi } from '../../../middleware/agentAuth.js';
import { createUser, getUserByEmail, updateUser } from '../../../services/user.service.js';
import { getAgentByEmail, upsertAgentForUser } from '../../../services/agent.service.js';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../../../config/firebase.config.mjs';
import drizzleDb, { payments, carts as cartsPgTable, agents as agentsTable, tripSelections } from '../../../db/drizzleClient.js';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { Parser as Json2CsvParser } from 'json2csv';
import logger from '../../../utils/logger.js';
import verifyFirebaseAuth from '../../../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../../../middleware/adminAccess.js';
import bcrypt from 'bcryptjs';

const router = express.Router();

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
      active: r.active,
      createdAt: r.createdAt || null,
    }));
    return res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error('List agents failed', { message: error.message });
    return res.status(500).json({ success: false, error: 'LIST_AGENTS_FAILED', message: error.message });
  }
});

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
  return [
    'awaiting_payment',
    'awaitingpay',
    'pending_payment',
    'payment_pending',
    'pending',
    'unpaid',
    'invoice_due',
    'processed',
    'processing',
  ].includes(s);
}

function isCompletedPaymentStatus(value) {
  const s = normalizeStatusLocal(value);
  if (!s) return false;

  // Known explicit statuses
  if (
    [
      'paid',
      'success',
      'successful',
      'succeeded',
      'complete',
      'completed',
      'confirmed',
      'confirm_registered',
      // Production typo variants
      'confrim_registerd',
      'confirm_registerd',
    ].includes(s)
  ) {
    return true;
  }

  // Heuristic: some statuses contain both words (and may be misspelled)
  if (s.includes('confirm') && (s.includes('register') || s.includes('registerd'))) return true;

  return false;
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
    body('firstName').optional().isString(),
    body('lastName').optional().isString(),
    body('password').optional().isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('phone').optional().isString()
  ]),
  async (req, res) => {
    try {
      const { email, firstName = '', lastName = '', phone = '', password } = req.body || {};
      const emailLower = normalizeEmailLocal(email);
      const rawPassword = typeof password === 'string' ? password : '';
      const passwordHash = rawPassword && rawPassword.length >= 8
        ? await bcrypt.hash(String(rawPassword), 12)
        : null;

      const existing = await getAgentByEmail(emailLower);
      if (existing) {
        let passwordSet = false;
        if (passwordHash) {
          try {
            const existingUser = await getUserByEmail(emailLower);
            if (existingUser && !existingUser.passwordHash) {
              await updateUser(existingUser.id, {
                passwordHash,
                firstName: firstName || existingUser.firstName || '',
                lastName: lastName || existingUser.lastName || '',
                phone: phone || existingUser.phone || ''
              });
              passwordSet = true;
            }
          } catch (_) {}
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
          // If account exists without a password and one was provided, set it now
          if (passwordHash && !existingUser.passwordHash) {
            try {
              await updateUser(existingUser.id, {
                passwordHash,
                firstName: firstName || existingUser.firstName || '',
                lastName: lastName || existingUser.lastName || '',
                phone: phone || existingUser.phone || ''
              });
            } catch (_) {
            }
          }
        } else {
          const created = await createUser({ email: emailLower, passwordHash, firstName, lastName, phone });
          userId = created?.id || null;
        }
      }

      const agent = await upsertAgentForUser({
        id: userId,
        email: emailLower,
        firstName,
        lastName,
        phone
      });

      return res.status(201).json({ success: true, agent });
    } catch (error) {
      logger.error('Agent registration failed', { message: error.message });
      return res.status(500).json({
        success: false,
        error: error.message || 'Agent registration failed'
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

  // Postgres carts lookup
  try {
    const pgRows = await drizzleDb
      .select({
        cartId: cartsPgTable.cartId,
        firestoreCartId: cartsPgTable.firestoreCartId,
        origin: cartsPgTable.origin,
        destination: cartsPgTable.destination,
        passengerCount: cartsPgTable.passengerCount,
        passengers: cartsPgTable.passengers,
        purchaser: cartsPgTable.purchaser,
        currency: cartsPgTable.currency,
        retailPrice: cartsPgTable.retailPrice,
        costPrice: cartsPgTable.costPrice,
        discount: cartsPgTable.discount,
        markup: cartsPgTable.markup,
        charges: cartsPgTable.charges,
        roundDiff: cartsPgTable.roundDiff,
      })
      .from(cartsPgTable)
      .where(or(inArray(cartsPgTable.cartId, ids), inArray(cartsPgTable.firestoreCartId, ids)));

    for (const r of pgRows || []) {
      const key = String(r.cartId || '').trim();
      if (!key) continue;
      const passengers =
        typeof r.passengerCount === 'number'
          ? r.passengerCount
          : Array.isArray(r.passengers)
            ? r.passengers.length
            : 0;
      const revenue = computeRetailFromPgCartRow(r);
      const payload = {
        origin: r.origin || null,
        destination: r.destination || null,
        passengers,
        purchaserEmail: (r.purchaser && r.purchaser.email) ? normalizeEmailLocal(r.purchaser.email) : null,
        revenue,
        currency: r.currency || null,
      };

      // Index by both identifiers so callers can lookup using either the Busbud cart id
      // or the Firestore cart id (PNR) depending on flow.
      info.set(key, payload);
      const fsKey = String(r.firestoreCartId || '').trim();
      if (fsKey) info.set(fsKey, payload);
    }
  } catch (_) {
    // ignore
  }

  // Firestore carts lookup (fills any gaps)
  try {
    const fs = await getFirestore();
    const missing = ids.filter((id) => !info.has(id));
    if (missing.length) {
      const snaps = await Promise.all(
        missing.map(async (id) => {
          try {
            const snap = await fs.collection('carts').doc(String(id)).get();
            if (!snap.exists) return null;
            return { id: String(id), data: snap.data() || {} };
          } catch (_) {
            return null;
          }
        })
      );

      for (const s of snaps) {
        if (!s || !s.id) continue;
        const cart = s.data || {};
        const { origin, destination } = deriveCartOriginDestination(cart);
        const passengers = deriveCartPassengersCount(cart);
        const purchaserEmail = cart.purchaserEmail ? normalizeEmailLocal(cart.purchaserEmail) : null;
        info.set(s.id, {
          origin,
          destination,
          passengers,
          purchaserEmail,
        });
      }
    }
  } catch (_) {
    // ignore
  }

  return info;
}

async function fetchAgentRecentBookings(agentEmail, limit, extras = {}) {
  const normalizedAgent = normalizeEmailLocal(agentEmail);
  if (!normalizedAgent) return [];

  const agentNameLower = (extras && typeof extras.agentNameLower === 'string')
    ? extras.agentNameLower.trim().toLowerCase()
    : '';

  const take = Math.min(Math.max(Number(limit || 5) || 5, 1), 50);
  const pageSize = 2000;
  const maxPages = 20;

  const maxCollect = Math.max(take * 4, 50);

  const seenRefs = new Set();

  const paidRows = [];
  const unpaidRows = [];

  for (let page = 0; page < maxPages && paidRows.length < maxCollect; page++) {
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

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const dayKey = toDateKeyInTimezone(createdAt);

      const purchase = row.rawResponse || {};
      const bookedByNorm = normalizeEmailLocal(row.bookedBy || '');
      const bookedByEmail = extractEmailFromTextLocal(row.bookedBy || '');
      const matchesAgent =
        (bookedByEmail && bookedByEmail === normalizedAgent) ||
        (bookedByNorm && bookedByNorm === normalizedAgent) ||
        (agentNameLower && row.bookedBy && String(row.bookedBy).trim().toLowerCase() === agentNameLower);

      if (!matchesAgent) continue;

      // Only treat completed payment records as bookings; pending/processing lives in carts.
      // This prevents completed+non-completed payment rows from crowding out awaiting-payment carts.
      if (!isCompletedPaymentStatus(row.status)) continue;

      const passengersCount = Array.isArray(purchase.items) ? purchase.items.length : 0;
      const revenue = Number(row.amount || 0);
      const currency = deriveCurrencyFromPurchase(purchase) || 'USD';

      const base = {
        cartId: row.transactionRef || null,
        busbudCartId: null,
        reference: row.transactionRef || null,
        createdAt,
        userId: null,
        purchaserEmail: null,
        operator: null,
        origin: null,
        destination: null,
        branch: null,
        paymentType: row.method || null,
        status: row.status || null,
        bookingType: 'paid',
        source: 'payments',
        passengers: passengersCount,
        revenue,
        currency,
        cost: 0,
        profit: revenue,
        margin: revenue > 0 ? 1 : 0,
      };

      paidRows.push(base);

      if (row.transactionRef) {
        seenRefs.add(String(row.transactionRef).trim());
      }

      if (paidRows.length >= maxCollect) break;
    }
  }

  // Enrich paid (payments-based) rows with cart origin/destination/passengers where possible.
  // This makes paid and awaiting-payment rows consistent.
  try {
    const refs = paidRows
      .map((m) => m && m.reference)
      .filter(Boolean)
      .map((v) => String(v));
    const cartInfoById = await loadCartInfoById(refs);

    for (const row of paidRows) {
      const ref = row && row.reference ? String(row.reference) : '';
      const cartInfo = ref ? cartInfoById.get(ref) : null;
      const origin = cartInfo && cartInfo.origin ? cartInfo.origin : null;
      const destination = cartInfo && cartInfo.destination ? cartInfo.destination : null;
      const paxFromCart = cartInfo && typeof cartInfo.passengers === 'number' ? cartInfo.passengers : 0;

      // Prefer cart passengers when present; otherwise fall back to purchase.items.
      // Avoid showing 0 passengers for completed rows.
      let passengers = typeof row.passengers === 'number' ? row.passengers : 0;
      if (paxFromCart > 0) passengers = paxFromCart;
      if ((!passengers || passengers < 1) && !isAwaitingPaymentStatus(row.status)) passengers = 1;

      row.origin = origin || row.origin || null;
      row.destination = destination || row.destination || null;
      row.passengers = passengers;
      row.purchaserEmail = row.purchaserEmail || (cartInfo && cartInfo.purchaserEmail) || null;
    }
  } catch (_) {
    // ignore
  }

  // Unpaid (awaiting-payment) from Postgres carts
  try {
    const indexByCanonicalRef = new Map();
    const cartRows = await drizzleDb
      .select({
        cartId: cartsPgTable.cartId,
        firestoreCartId: cartsPgTable.firestoreCartId,
        createdAt: cartsPgTable.createdAt,
        status: cartsPgTable.status,
        bookedBy: cartsPgTable.bookedBy,
        passengerCount: cartsPgTable.passengerCount,
        currency: cartsPgTable.currency,
        origin: cartsPgTable.origin,
        destination: cartsPgTable.destination,
        retailPrice: cartsPgTable.retailPrice,
        costPrice: cartsPgTable.costPrice,
        discount: cartsPgTable.discount,
        markup: cartsPgTable.markup,
        charges: cartsPgTable.charges,
        roundDiff: cartsPgTable.roundDiff,
        passengers: cartsPgTable.passengers,
        purchaser: cartsPgTable.purchaser,
      })
      .from(cartsPgTable)
      .orderBy(desc(cartsPgTable.createdAt))
      .limit(1000);

    const resolvedFirestoreIdByCartId = new Map();
    try {
      const missingCartIds = (cartRows || [])
        .filter((r) => r && r.cartId && !r.firestoreCartId)
        .map((r) => String(r.cartId).trim())
        .filter(Boolean);

      if (missingCartIds.length) {
        const rows = await drizzleDb
          .select({ cartId: tripSelections.cartId, firestoreCartId: tripSelections.firestoreCartId })
          .from(tripSelections)
          .where(inArray(tripSelections.cartId, missingCartIds))
          .orderBy(desc(tripSelections.createdAt))
          .limit(5000);

        for (const r of rows || []) {
          const k = r && r.cartId ? String(r.cartId).trim() : '';
          const v = r && r.firestoreCartId ? String(r.firestoreCartId).trim() : '';
          if (!k || !v) continue;
          if (!resolvedFirestoreIdByCartId.has(k)) resolvedFirestoreIdByCartId.set(k, v);
        }
      }
    } catch (_) {
      // ignore
    }

    for (const row of cartRows || []) {
      if (unpaidRows.length >= maxCollect) break;
      const rawCartId = String(row.cartId || '').trim();
      const rawFirestoreId = String(row.firestoreCartId || '').trim();
      const resolvedFirestoreId = rawFirestoreId || (rawCartId ? (resolvedFirestoreIdByCartId.get(rawCartId) || '') : '');
      const canonicalRef = resolvedFirestoreId || rawCartId;
      if (!canonicalRef) continue;

      const isPreferredRow = Boolean(resolvedFirestoreId && rawCartId && resolvedFirestoreId === rawCartId);

      const existing = indexByCanonicalRef.get(canonicalRef);
      if (existing) {
        if (!existing.isPreferred && isPreferredRow) {
          // Replace an earlier busbud-cart-id row with the canonical PNR/internal-id row
          unpaidRows[existing.index] = existing.buildRow();
          indexByCanonicalRef.set(canonicalRef, {
            index: existing.index,
            isPreferred: true,
            buildRow: () => existing.buildRow()
          });
        }
        continue;
      }

      if (seenRefs.has(canonicalRef)) continue;
      const statusRaw = row.status || '';
      if (!isAwaitingPaymentStatus(statusRaw)) continue;

      const bookedByNorm = normalizeEmailLocal(row.bookedBy || '');
      const bookedByEmail = extractEmailFromTextLocal(row.bookedBy || '');
      const matchesAgent =
        (bookedByEmail && bookedByEmail === normalizedAgent) ||
        (bookedByNorm && bookedByNorm === normalizedAgent);
      if (!matchesAgent) continue;

      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const passengersCount =
        typeof row.passengerCount === 'number'
          ? row.passengerCount
          : Array.isArray(row.passengers)
            ? row.passengers.length
            : 0;
      const revenue = computeRetailFromPgCartRow(row);
      const currency = row.currency || 'USD';

      const buildRow = () => ({
        cartId: canonicalRef,
        busbudCartId: null,
        reference: canonicalRef,
        createdAt,
        userId: null,
        purchaserEmail: (row.purchaser && row.purchaser.email) ? normalizeEmailLocal(row.purchaser.email) : null,
        operator: null,
        origin: row.origin || null,
        destination: row.destination || null,
        branch: null,
        paymentType: null,
        status: statusRaw || 'awaiting_payment',
        bookingType: 'unpaid',
        source: 'carts_pg',
        passengers: passengersCount,
        revenue,
        currency,
        cost: 0,
        profit: revenue,
        margin: revenue > 0 ? 1 : 0,
      });

      const idx = unpaidRows.length;
      unpaidRows.push(buildRow());
      indexByCanonicalRef.set(canonicalRef, { index: idx, isPreferred: isPreferredRow, buildRow });
      seenRefs.add(canonicalRef);
    }
  } catch (e) {
    logger.warn('Failed to load awaiting-payment carts (pg) for agent recent bookings', { error: e && e.message });
  }

  // Firestore carts fallback: ensures a just-created cart shows up immediately after redirect
  try {
    if (unpaidRows.length < maxCollect) {
      const fs = await getFirestore();

      const toMillis = (v) => {
        try {
          if (!v) return null;
          if (typeof v.toDate === 'function') return v.toDate().getTime();
          const d = v instanceof Date ? v : new Date(v);
          const t = d.getTime();
          return Number.isNaN(t) ? null : t;
        } catch (_) {
          return null;
        }
      };

      let snap;
      try {
        snap = await fs.collection('carts').orderBy('createdAt', 'desc').limit(200).get();
      } catch (_) {
        snap = await fs.collection('carts').limit(200).get();
      }

      const docsSorted = (snap && snap.docs ? snap.docs : []).slice().sort((a, b) => {
        const da = a && typeof a.data === 'function' ? (a.data() || {}) : {};
        const db = b && typeof b.data === 'function' ? (b.data() || {}) : {};
        const ta = toMillis(da.createdAt || da.created_at || da.timestamp) || 0;
        const tb = toMillis(db.createdAt || db.created_at || db.timestamp) || 0;
        return tb - ta;
      });

      for (const doc of docsSorted) {
        if (unpaidRows.length >= maxCollect) break;
        const cartId = String(doc.id || '').trim();
        if (!cartId || seenRefs.has(cartId)) continue;

        const cart = doc.data() || {};
        const statusRaw = cart.status || cart.state || '';
        if (!isAwaitingPaymentStatus(statusRaw)) continue;

        const agentEmailNorm = normalizeEmailLocal(cart.agentEmail || (cart.agent && cart.agent.agentEmail) || '');
        const bookedByNorm = normalizeEmailLocal(cart.bookedBy || '');
        const matchesAgent =
          (agentEmailNorm && agentEmailNorm === normalizedAgent) ||
          (bookedByNorm && bookedByNorm === normalizedAgent) ||
          (agentNameLower && cart.bookedBy && String(cart.bookedBy).trim().toLowerCase() === agentNameLower);
        if (!matchesAgent) continue;

        const rawCreated = cart.createdAt || cart.created_at || cart.timestamp || null;
        const createdAt = rawCreated && typeof rawCreated.toDate === 'function'
          ? rawCreated.toDate()
          : rawCreated
            ? new Date(rawCreated)
            : new Date();

        const { origin, destination } = deriveCartOriginDestination(cart);
        const passengersCount = deriveCartPassengersCount(cart);
        const revenue = Number(cart.retailPrice || cart.total || cart.amount || 0);
        const currency = cart.currency || 'USD';

        unpaidRows.push({
          cartId,
          busbudCartId: null,
          reference: cartId,
          createdAt,
          userId: null,
          purchaserEmail: null,
          operator: null,
          origin,
          destination,
          branch: null,
          paymentType: null,
          status: statusRaw || 'awaiting_payment',
          bookingType: 'unpaid',
          source: 'carts_fs',
          passengers: passengersCount,
          revenue,
          currency,
          cost: 0,
          profit: revenue,
          margin: revenue > 0 ? 1 : 0,
        });
        seenRefs.add(cartId);
      }

      // Enrich Firestore-fallback rows using Postgres carts pricing when available.
      // This keeps price display consistent and avoids relying on Firestore pricing shapes.
      try {
        const fsRefs = unpaidRows
          .filter((r) => r && r.source === 'carts_fs' && r.reference)
          .map((r) => String(r.reference));
        const cartInfoById = await loadCartInfoById(fsRefs);
        for (const r of unpaidRows) {
          if (!r || r.source !== 'carts_fs' || !r.reference) continue;
          const info = cartInfoById.get(String(r.reference));
          if (!info) continue;
          if ((!r.revenue || r.revenue <= 0) && typeof info.revenue === 'number' && info.revenue > 0) {
            r.revenue = info.revenue;
          }
          if ((!r.currency || r.currency === 'USD') && info.currency) {
            r.currency = info.currency;
          }
        }
      } catch (_) {
        // ignore
      }
    }
  } catch (e) {
    // Firestore query may fail if createdAt isn't indexed/consistent; ignore.
  }

  const merged = [...paidRows, ...unpaidRows]
    .filter((r) => r && r.reference)
    .sort((a, b) => {
      const ta = a && a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(a && a.createdAt).getTime();
      const tb = b && b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(b && b.createdAt).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

  return merged.slice(0, take);
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

  const rangeKey = String(query.range || 'all').toLowerCase();
  const specificDate = query.date ? String(query.date).slice(0, 10) : null;
  const limit = Math.min(Number(query.limit || 500), 2000);

  let allowedDateKeys = null;
  let minAllowedDateKey = null;
  if (specificDate) {
    allowedDateKeys = new Set([specificDate]);
    minAllowedDateKey = specificDate;
  } else if (rangeKey === 'today') {
    const now = new Date();
    const key = toDateKeyInTimezone(now);
    allowedDateKeys = new Set([key]);
    minAllowedDateKey = key;
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
    }
  }

  let totalBookingsAll = 0;
  let totalTicketsAll = 0;
  let totalRevenueAll = 0;
  const revenueByCurrencyAll = {};
  const rows = [];

  let cartAgentEmailMap = new Map();
  const seenPaymentRefs = new Set();

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

    // Best-effort Firestore cart agentEmail lookup for additional matching
    let pageCartAgentEmailMap = new Map();
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

    const agentNameLower = (extras && typeof extras.agentNameLower === 'string')
      ? extras.agentNameLower.trim().toLowerCase()
      : '';

    for (const row of paymentRows) {
      const createdAt = row.createdAt ? new Date(row.createdAt) : new Date();
      const dayKey = toDateKeyUTC(createdAt);

      if (minAllowedDateKey && dayKey && dayKey < minAllowedDateKey) {
        exhaustedRange = true;
        break;
      }

      const purchase = row.rawResponse || {};
      const purchaserEmail = derivePurchaserEmail(purchase);
      const bookedByNorm = normalizeEmailLocal(row.bookedBy || '');
      const purchaserEmailNorm = normalizeEmailLocal(purchaserEmail || '');
      const matchesAgent =
        (purchaserEmailNorm && purchaserEmailNorm === normalizedAgent) ||
        (bookedByNorm && bookedByNorm === normalizedAgent) ||
        (agentNameLower && row.bookedBy && String(row.bookedBy).trim().toLowerCase() === agentNameLower) ||
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

      const passengersCount = Array.isArray(purchase.items) ? purchase.items.length : 0;
      const revenue = Number(row.amount || 0);
      const currency = deriveCurrencyFromPurchase(purchase) || 'USD';

      const refKey = row.transactionRef ? String(row.transactionRef) : '';
      const firstTime = refKey ? !seenPaymentRefs.has(refKey) : true;
      if (refKey) seenPaymentRefs.add(refKey);

      if (firstTime) {
        totalBookingsAll += 1;
        totalTicketsAll += passengersCount;
        if (revenue > 0) {
          totalRevenueAll += revenue;
          revenueByCurrencyAll[currency] = (revenueByCurrencyAll[currency] || 0) + revenue;
        }
      }

      if (rows.length < limit) {
        rows.push({
          cartId: row.transactionRef || null,
          busbudCartId: null,
          reference: row.transactionRef || null,
          createdAt,
          userId: null,
          purchaserEmail: purchaserEmail,
          operator: null,
          origin: null,
          destination: null,
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

      totalBookingsAll += 1;
      totalTicketsAll += passengersCount;
      if (revenue > 0) {
        totalRevenueAll += revenue;
        revenueByCurrencyAll[currency] = (revenueByCurrencyAll[currency] || 0) + revenue;
      }

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

  try {
    rows.sort((a, b) => {
      const ad = a && a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bd = b && b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bd - ad;
    });
  } catch (_) {}

  const rangeTotals = {
    totalBookings: totalBookingsAll,
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
  };
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
    const data = await buildAgentSalesSummary(email, req.query || {}, { agentNameLower: (agentName || '').toLowerCase() });

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

export default router;
