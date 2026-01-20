function normalizeId(value) {
  return String(value || '').trim();
}

const reservations = new Map();

function computeStatus(res) {
  if (!res) return 'unknown';
  if (res.status === 'paid' || res.status === 'cancelled') return res.status;

  const expiresAtMs = Number(res.expiresAtMs || 0);
  if (expiresAtMs > 0 && Date.now() >= expiresAtMs) return 'expired';

  return res.status || 'reserved';
}

export function listReservations() {
  const out = [];
  for (const r of reservations.values()) {
    const status = computeStatus(r);
    if (status !== r.status) {
      r.status = status;
      reservations.set(r.reservationId, r);
    }
    out.push(r);
  }

  out.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0));
  return out;
}

export function getReservation(reservationId) {
  const id = normalizeId(reservationId);
  if (!id) return null;
  const r = reservations.get(id) || null;
  if (!r) return null;

  const status = computeStatus(r);
  if (status !== r.status) {
    r.status = status;
    reservations.set(id, r);
  }

  return r;
}

export function upsertReservation(input) {
  const id = normalizeId(input && input.reservationId);
  if (!id) return null;

  const prev = reservations.get(id) || {};
  const next = {
    ...prev,
    ...input,
    reservationId: id,
  };

  const createdAtMs = Number(next.createdAtMs || 0) || Date.now();
  next.createdAtMs = createdAtMs;

  const leaseSeconds = Number(next.leaseSeconds || 0) || 0;
  next.leaseSeconds = leaseSeconds;

  if (!next.expiresAtMs && leaseSeconds > 0) {
    next.expiresAtMs = createdAtMs + leaseSeconds * 1000;
  }

  next.status = computeStatus(next);

  reservations.set(id, next);
  return next;
}

export function markCancelled(reservationId) {
  const r = getReservation(reservationId);
  if (!r) return null;
  r.status = 'cancelled';
  r.cancelledAtMs = Date.now();
  reservations.set(r.reservationId, r);
  return r;
}

export function markPaid(reservationId, paymentResult) {
  const r = getReservation(reservationId);
  if (!r) return null;
  r.payment = paymentResult || null;
  if (paymentResult && paymentResult.Success) {
    r.status = 'paid';
    r.paidAtMs = Date.now();
  }
  reservations.set(r.reservationId, r);
  return r;
}
