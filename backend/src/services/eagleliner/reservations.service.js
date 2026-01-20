import { createEaglelinerClient } from './eaglelinerClient.js';
import { logger } from '../../utils/logger.js';

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value == null) return fallback;
  const s = String(value).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return fallback;
}

function normalizeGender(value, title) {
  const raw = value == null ? '' : String(value).trim();
  const upper = raw.toUpperCase();
  if (upper === 'M' || upper === 'F') return upper;

  const t = title == null ? '' : String(title).trim().toLowerCase();
  if (t === 'mr' || t === 'mister') return 'M';
  if (t === 'mrs' || t === 'ms' || t === 'miss') return 'F';
  return 'M';
}

function normalizePassengerType(value) {
  const n = asNumber(value, NaN);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

function pickUpstreamPassengerDetail(detail) {
  const d = detail && typeof detail === 'object' ? detail : {};
  const allowedKeys = [
    'PassengerNo',
    'Type',
    'Title',
    'Firstname',
    'Surname',
    'Gender',
    'Telephone',
    'Seat',
    'SeatNo',
    'WithInfant',
    'IDNumber',
    'PassportNo',
  ];

  const out = {};
  for (const k of allowedKeys) {
    const v = d[k];
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    out[k] = v;
  }
  return out;
}

function normalizePassengerDetail(detail, idx) {
  const d = detail && typeof detail === 'object' ? detail : {};

  const base = pickUpstreamPassengerDetail(d);

  const passengerNo = asNumber(d.PassengerNo ?? d.passengerNo ?? idx + 1, idx + 1);
  const type = normalizePassengerType(d.Type ?? d.type ?? d.TypeID ?? d.typeId);
  const title = d.Title ?? d.title ?? 'Mr';
  const gender = normalizeGender(d.Gender ?? d.gender, title);
  const withInfant = asBoolean(d.WithInfant ?? d.withInfant, false);

  return {
    ...base,
    PassengerNo: passengerNo,
    Type: type,
    Title: title,
    Gender: gender,
    WithInfant: withInfant,
  };
}

export async function makePayment({ username, password, reservationId, amountReceived, paymentMethod }) {
  const client = createEaglelinerClient();
  const resolvedId = String(reservationId || '').trim();
  const resolvedAmount = asNumber(amountReceived, NaN);
  const resolvedPaymentMethod = asNumber(paymentMethod ?? 1, 1);
  const requestId = `eagle-upstream-makepay-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  if (!resolvedId) {
    const err = new Error('reservationId is required');
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isFinite(resolvedAmount) || resolvedAmount <= 0) {
    const err = new Error('amountReceived must be a positive number');
    err.statusCode = 400;
    throw err;
  }

  if (resolvedPaymentMethod !== 1) {
    const err = new Error('paymentMethod must be 1');
    err.statusCode = 400;
    throw err;
  }

  logger.info('[eagleliner.upstream.make_payment] request', {
    requestId,
    at: new Date().toISOString(),
    path: '/api/v2/reservation/make_payment',
    body: {
      ReservationID: resolvedId,
      AmountReceived: resolvedAmount,
      PaymentMethod: resolvedPaymentMethod,
    },
  });

  const res = await client.request({
    method: 'POST',
    path: '/api/v2/reservation/make_payment',
    username,
    password,
    data: {
      ReservationID: resolvedId,
      AmountReceived: resolvedAmount,
      PaymentMethod: resolvedPaymentMethod,
    },
  });

  logger.info('[eagleliner.upstream.make_payment] response', {
    requestId,
    at: new Date().toISOString(),
    reservationId: resolvedId,
    success: Boolean(res && res.Success !== false),
    error: res && (res.Error || res.error || res.message) ? String(res.Error || res.error || res.message) : null,
    response: res || null,
  });

  return res;
}

export async function printTickets({ username, password, reservationId }) {
  const client = createEaglelinerClient();
  const resolvedId = String(reservationId || '').trim();

  if (!resolvedId) {
    const err = new Error('reservationId is required');
    err.statusCode = 400;
    throw err;
  }

  return client.request({
    method: 'POST',
    path: '/api/v2/reservation/print_tickets',
    username,
    password,
    data: {
      ReservationID: resolvedId,
    },
  });
}

export async function cancelReservation({ username, password, reservationId }) {
  const client = createEaglelinerClient();
  const resolvedId = String(reservationId || '').trim();

  if (!resolvedId) {
    const err = new Error('reservationId is required');
    err.statusCode = 400;
    throw err;
  }

  return client.request({
    method: 'POST',
    path: '/api/v2/reservation/cancel_reservation',
    username,
    password,
    data: {
      ReservationID: resolvedId,
    },
  });
}

export async function reserveSeats({
  username,
  password,
  tripId,
  departureStopId,
  destinationStopId,
  departureDate,
  passengers,
  reservationTime,
  passengerDetails,
  correlationId,
}) {
  const client = createEaglelinerClient();
  const requestId = `eagle-upstream-reserve-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const resolvedTripId = asNumber(tripId, 0);
  const resolvedDepartureStopId = asNumber(departureStopId, 0);
  const resolvedDestinationStopId = asNumber(destinationStopId, 0);
  const resolvedPassengers = asNumber(passengers, 0);
  const resolvedReservationTime = asNumber(reservationTime, 0);

  if (!resolvedTripId) {
    const err = new Error('tripId is required');
    err.statusCode = 400;
    throw err;
  }

  if (!resolvedDepartureStopId) {
    const err = new Error('departureStopId is required');
    err.statusCode = 400;
    throw err;
  }

  if (!resolvedDestinationStopId) {
    const err = new Error('destinationStopId is required');
    err.statusCode = 400;
    throw err;
  }

  if (!departureDate) {
    const err = new Error('departureDate is required');
    err.statusCode = 400;
    throw err;
  }

  if (!resolvedPassengers || resolvedPassengers <= 0) {
    const err = new Error('passengers must be >= 1');
    err.statusCode = 400;
    throw err;
  }

  if (resolvedReservationTime < 30 || resolvedReservationTime > 900) {
    const err = new Error('reservationTime must be between 30 and 900 seconds');
    err.statusCode = 400;
    throw err;
  }

  const details = Array.isArray(passengerDetails)
    ? passengerDetails.map((d, idx) => normalizePassengerDetail(d, idx))
    : null;

  const payload = {
    ReservationTime: resolvedReservationTime,
    TripReservationDetails: {
      Trip1: {
        DestinationStopID: resolvedDestinationStopId,
        TripID: resolvedTripId,
        Passengers: resolvedPassengers,
        PassengerDetails: details,
        DepartureDate: String(departureDate),
        DepartureStopID: resolvedDepartureStopId,
      },
    },
  };

  const logBody = {
    ReservationTime: resolvedReservationTime,
    TripReservationDetails: {
      Trip1: {
        DestinationStopID: resolvedDestinationStopId,
        TripID: resolvedTripId,
        Passengers: resolvedPassengers,
        PassengerDetails: Array.isArray(details)
          ? {
              count: details.length,
              sample: details.slice(0, 10).map((d) => ({
                PassengerNo: d?.PassengerNo ?? null,
                Type: d?.Type ?? null,
                Gender: d?.Gender ?? null,
                WithInfant: d?.WithInfant ?? null,
                Title: d?.Title ?? null,
                Seat: d?.Seat ?? d?.SeatNo ?? null,
              })),
            }
          : null,
        DepartureDate: String(departureDate),
        DepartureStopID: resolvedDepartureStopId,
      },
    },
  };

  logger.info('[eagleliner.upstream.reserve_seats] request', {
    requestId,
    correlationId: correlationId || null,
    at: new Date().toISOString(),
    path: '/api/v2/trips/reserve_seats',
    body: logBody,
  });

  try {
    const res = await client.request({
      method: 'POST',
      path: '/api/v2/trips/reserve_seats',
      username,
      password,
      data: payload,
    });

    logger.info('[eagleliner.upstream.reserve_seats] response', {
      requestId,
      correlationId: correlationId || null,
      at: new Date().toISOString(),
      tripId: resolvedTripId,
      success: Boolean(res && res.Success !== false),
      error: res && (res.Error || res.error || res.message) ? String(res.Error || res.error || res.message) : null,
      response: res || null,
    });

    return res;
  } catch (err) {
    logger.error('[eagleliner.upstream.reserve_seats] error', {
      requestId,
      correlationId: correlationId || null,
      at: new Date().toISOString(),
      tripId: resolvedTripId,
      error: err && err.message ? err.message : String(err),
      details: err && err.details ? err.details : null,
    });
    throw err;
  }
}
