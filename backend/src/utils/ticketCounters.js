import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../config/firebase.config.mjs';

function parseBranchFromId(id) {
  const s = String(id || '').trim();
  if (!s) return '00';
  if (/^[1-3][0-9]{8,}$/.test(s)) return s.slice(1, 3);
  if (/^[A-Za-z][0-9]{8,}$/.test(s)) return s.slice(1, 3);
  if (/^[0-9]{8,}$/.test(s)) return s.slice(0, 2);
  return '00';
}

function countPassengers(cart) {
  const cpItemsLen = cart?.passengerDetails?.completePurchase?.items?.length;
  if (typeof cpItemsLen === 'number' && cpItemsLen > 0) return cpItemsLen;
  const sum = cart?.summary?.passengerCount || cart?.summary?.passengers;
  if (typeof sum === 'number' && sum > 0) return sum;
  const tripLen = Array.isArray(cart?.trip?.passengers) ? cart.trip.passengers.length : 0;
  if (tripLen > 0) return tripLen;
  const bbLen = Array.isArray(cart?.busbudResponse?.passengers) ? cart.busbudResponse.passengers.length : 0;
  if (bbLen > 0) return bbLen;
  return 1;
}

function getCartRevenue(cart) {
  try {
    if (typeof cart.totalAmount === 'number') return cart.totalAmount;
    if (cart.invoice && typeof cart.invoice.amount_total === 'number') return cart.invoice.amount_total;
    if (cart.invoice_data && typeof cart.invoice_data.amount_total === 'number') return cart.invoice_data.amount_total;
    if (typeof cart.totalPrice === 'number') return cart.totalPrice;
    if (typeof cart.total === 'number') return cart.total;
    if (cart.summary && typeof cart.summary.total === 'number') return cart.summary.total;
  } catch (_) {
    // ignore parse errors and fall back to null
  }
  return null;
}

function getCartCurrency(cart) {
  return (
    (cart.invoice && cart.invoice.currency) ||
    (cart.invoice_data && cart.invoice_data.currency) ||
    (cart.summary && cart.summary.currency) ||
    (cart.trip && cart.trip.currency) ||
    (cart.apiMetadata && cart.apiMetadata.currency) ||
    'USD'
  );
}

// Crude but safe key normaliser for Firestore field paths
function normalizeBucketKey(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

function getCartOperatorName(cart) {
  try {
    if (cart.trip && cart.trip.operator) {
      const op = cart.trip.operator;
      return op.name || op.operator_name || op.code || null;
    }
    if (cart.tripDetails && cart.tripDetails.operator) {
      return cart.tripDetails.operator;
    }
    if (cart.operator && cart.operator.name) {
      return cart.operator.name;
    }

    // Fallback: try first segment operator from Busbud structures
    const rawTripItem = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items)
      ? cart.trip._raw.items[0]
      : null;
    const segments = rawTripItem && Array.isArray(rawTripItem.segments)
      ? rawTripItem.segments
      : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);

    if (Array.isArray(segments) && segments.length) {
      const seg0 = segments[0];
      if (seg0 && seg0.operator) {
        const op = seg0.operator;
        return op.name || op.operator_name || op.xid || null;
      }
    }
  } catch (_) {
    // ignore
  }
  return null;
}

function getCartPaymentType(cart) {
  try {
    const direct = cart.paymentMethod || cart.payment_type || cart.paymentType;
    if (direct) return direct;

    if (cart.invoice) {
      const inv = cart.invoice;
      if (inv.payment_method) return inv.payment_method;
      if (inv.journal && inv.journal.name) return inv.journal.name;
      if (inv.journal && inv.journal.code) return inv.journal.code;
    }

    if (cart.payment && (cart.payment.method || cart.payment.type)) {
      return cart.payment.method || cart.payment.type;
    }
  } catch (_) {
    // ignore and fall back to default
  }
  return 'online';
}

function countPassengersFromTicket(ticket) {
  try {
    const purchase = ticket && ticket.busbudPurchase;
    if (!purchase || typeof purchase !== 'object') return null;

    if (Array.isArray(purchase.passengers) && purchase.passengers.length > 0) {
      return purchase.passengers.length;
    }

    if (purchase.booking && Array.isArray(purchase.booking.tickets) && purchase.booking.tickets.length > 0) {
      return purchase.booking.tickets.length;
    }
  } catch (_) {
    // ignore and fall back
  }
  return null;
}

function getTicketOperatorName(ticket) {
  try {
    const purchase = ticket && ticket.busbudPurchase;
    if (!purchase || typeof purchase !== 'object') return null;

    const segments =
      (Array.isArray(purchase.segments) && purchase.segments.length && purchase.segments) ||
      (purchase.trip && Array.isArray(purchase.trip.segments) && purchase.trip.segments) ||
      [];

    if (Array.isArray(segments) && segments.length) {
      const seg0 = segments[0];
      if (seg0 && seg0.operator) {
        const op = seg0.operator;
        return op.name || op.operator_name || op.code || op.xid || null;
      }
    }
  } catch (_) {
    // ignore
  }
  return null;
}

function getTicketPaymentType(ticket) {
  try {
    if (!ticket || typeof ticket !== 'object') return null;
    if (ticket.paymentType || ticket.payment_type) return ticket.paymentType || ticket.payment_type;
  } catch (_) {
    // ignore and fall back
  }
  return null;
}

export async function incrementTicketCounters(reference) {
  const db = await getFirestore();
  const refStr = String(reference);

  let cartDoc = null;
  let ticketSnap = null;

  try {
    [cartDoc, ticketSnap] = await Promise.all([
      db.collection('carts').doc(refStr).get(),
      db.collection('tickets').doc(refStr).get(),
    ]);
  } catch (_) {
    // Fallback to individual reads if Promise.all fails for any reason
    try {
      cartDoc = await db.collection('carts').doc(refStr).get();
    } catch (_) {}
    try {
      ticketSnap = await db.collection('tickets').doc(refStr).get();
    } catch (_) {}
  }

  const cart = cartDoc && cartDoc.exists ? (cartDoc.data() || {}) : {};
  const ticket = ticketSnap && ticketSnap.exists ? (ticketSnap.data() || {}) : null;

  const rawId =
    (cartDoc && cartDoc.exists && (cartDoc.id || cart.firestoreCartId || cart.cartId || cart.cart_id)) ||
    (ticket && (ticket.cartId || ticket.firestoreCartId || ticket.paymentRef)) ||
    refStr;
  const branch = (ticket && ticket.branchCode) || parseBranchFromId(rawId);

  let n = countPassengers(cart);
  const nFromTicket = countPassengersFromTicket(ticket);
  if (typeof nFromTicket === 'number' && nFromTicket > 0) {
    n = nFromTicket;
  }
  if (!n || n <= 0) {
    n = 1;
  }

  let amount = null;
  let currency = null;

  // Prefer adjusted totals from the tickets collection (our main price totals)
  try {
    if (ticket) {
      if (typeof ticket.adjustedTotal === 'number' && !Number.isNaN(ticket.adjustedTotal)) {
        amount = ticket.adjustedTotal;
        currency = ticket.currency || null;
      } else if (typeof ticket.originalTotal === 'number' && !Number.isNaN(ticket.originalTotal)) {
        amount = ticket.originalTotal;
        currency = ticket.currency || null;
      }
    }
  } catch (_) {
    // Ignore read errors and fall back to legacy cart revenue logic
  }

  // Legacy / secondary fallback: derive amount/currency from cart document if tickets doc is missing or incomplete
  if (amount === null) {
    amount = getCartRevenue(cart);
  }
  if (!currency) {
    if (ticket && ticket.currency) {
      currency = ticket.currency;
    } else {
      currency = getCartCurrency(cart);
    }
  }

  const cartOperatorName = getCartOperatorName(cart);
  const ticketOperatorName = getTicketOperatorName(ticket);
  const operatorKey = normalizeBucketKey(ticketOperatorName || cartOperatorName);

  const cartPayment = getCartPaymentType(cart);
  const ticketPayment = getTicketPaymentType(ticket);
  const paymentTypeKey = normalizeBucketKey(ticketPayment || cartPayment);

  // Use payment date from ticket when available; otherwise fall back to server-side today
  const now = new Date();
  const dayKey = (ticket && typeof ticket.paymentDateKey === 'string' && ticket.paymentDateKey)
    ? ticket.paymentDateKey.slice(0, 10)
    : now.toISOString().slice(0, 10);

  const updates = {
    totalSold: FieldValue.increment(n),
    updatedAt: FieldValue.serverTimestamp(),
  };
  updates[`perBranch.${branch}`] = FieldValue.increment(n);

  // Per-day ticket counts
  updates[`byDate.${dayKey}.tickets`] = FieldValue.increment(n);
  updates[`byDateBranch.${dayKey}.${branch}`] = FieldValue.increment(n);

  // Per-day operator and payment type ticket counts
  if (operatorKey) {
    updates[`byDateOperator.${dayKey}.${operatorKey}.tickets`] = FieldValue.increment(n);
  }
  if (paymentTypeKey) {
    updates[`byDatePaymentType.${dayKey}.${paymentTypeKey}.tickets`] = FieldValue.increment(n);
  }

  if (typeof amount === 'number' && !Number.isNaN(amount) && amount > 0) {
    updates.totalRevenue = FieldValue.increment(amount);
    updates[`revenueByCurrency.${currency}`] = FieldValue.increment(amount);

    // Per-day revenue aggregates
    updates[`byDate.${dayKey}.revenue`] = FieldValue.increment(amount);
    updates[`byDateCurrency.${dayKey}.${currency}`] = FieldValue.increment(amount);

    // Per-day branch revenue
    updates[`byDateBranchRevenue.${dayKey}.${branch}`] = FieldValue.increment(amount);

    // Per-day operator and payment type revenue aggregates
    if (operatorKey) {
      updates[`byDateOperator.${dayKey}.${operatorKey}.revenue`] = FieldValue.increment(amount);
    }
    if (paymentTypeKey) {
      updates[`byDatePaymentType.${dayKey}.${paymentTypeKey}.revenue`] = FieldValue.increment(amount);
    }
  }

  await db.collection('counters').doc('tickets').set(updates, { merge: true });
  return true;
}
