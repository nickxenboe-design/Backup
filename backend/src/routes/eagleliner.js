import express from 'express';
import { listPassengerTypes } from '../services/eagleliner/passengerTypes.service.js';
import { reserveSeats, cancelReservation, makePayment, printTickets } from '../services/eagleliner/reservations.service.js';
import {
  listReservations,
  markCancelled,
  markPaid,
  upsertReservation,
} from '../services/eagleliner/reservationStore.js';
import { requireAgentApi } from '../middleware/agentAuth.js';
import axios from 'axios';
import { generatePdfFromHtml } from '../utils/ticketPdf.js';
import { generateCartId } from '../utils/idGenerator.js';
import { getFirestore } from '../config/firebase.config.mjs';
import { FieldValue } from 'firebase-admin/firestore';
import { TravelMasterAPI } from '../integrations/odoo/travelMasterPayment.service.js';
import { createEaglelinerClient } from '../services/eagleliner/eaglelinerClient.js';
import drizzleDb, { carts as cartsPgTable, tickets as ticketsPgTable } from '../db/drizzleClient.js';
import { eq, or, sql } from 'drizzle-orm';
import { ensureCartsTableExists } from '../utils/postgresCarts.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

let travelMasterClient = null;
function getTravelMasterClient() {
  if (travelMasterClient) return travelMasterClient;

  const url = String(process.env.TRAVELMASTER_URL || '').trim();
  const db = String(process.env.TRAVELMASTER_DB || '').trim();
  const username = String(process.env.TRAVELMASTER_USERNAME || '').trim();
  const password = String(process.env.TRAVELMASTER_PASSWORD || process.env.TRAVELMASTER_API_KEY || '').trim();

  if (!url || !db || !username || !password) return null;

  travelMasterClient = new TravelMasterAPI({
    url,
    db,
    username,
    password,
  });

  return travelMasterClient;
}

async function upsertEaglelinerPnrMapping({
  pnr,
  reservationId,
  leaseSeconds,
  tripId,
  departureStopId,
  destinationStopId,
  departureDate,
  passengers,
  selectedSeatIds,
  passengerDetails,
  estimatedTotal,
  contactInfo,
}) {
  const resolvedPnr = String(pnr || '').trim();
  const resolvedReservationId = String(reservationId || '').trim();
  if (!resolvedPnr || !resolvedReservationId) return null;

  try {
    const fs = await getFirestore();

    const createdAtMs = Date.now();
    const lease = Number(leaseSeconds || 0) || 0;
    const expiresAtMs = lease > 0 ? createdAtMs + lease * 1000 : null;

    await fs.collection('carts').doc(resolvedPnr).set(
      {
        cartId: resolvedPnr,
        firestoreCartId: resolvedPnr,
        source: 'eagleliner',
        provider: 'eagleliner',
        status: 'awaiting_payment',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
        eaglelinerReservationId: resolvedReservationId,
        eagleliner: {
          reservationId: resolvedReservationId,
          leaseSeconds: lease,
          tripId,
          departureStopId,
          destinationStopId,
          departureDate,
          passengers,
          selectedSeatIds: Array.isArray(selectedSeatIds) ? selectedSeatIds : [],
          passengerDetails: Array.isArray(passengerDetails) ? passengerDetails : [],
          estimatedTotal: typeof estimatedTotal === 'number' ? estimatedTotal : Number(estimatedTotal),
          contactInfo: contactInfo && typeof contactInfo === 'object' ? contactInfo : null,
        },
      },
      { merge: true }
    );

    try {
      await ensureCartsTableExists();
      const lease = Number(leaseSeconds || 0) || 0;
      const expiresAt = expiresAtMs ? new Date(expiresAtMs) : null;
      const passengerArr = Array.isArray(passengerDetails) ? passengerDetails : [];
      const passengerCount = passengerArr.length ? passengerArr.length : (Number(passengers || 0) || null);
      const purchaser = contactInfo && typeof contactInfo === 'object' ? contactInfo : null;
      const estimatedNum = Number(estimatedTotal);
      const total = Number.isFinite(estimatedNum) ? estimatedNum : null;
      const bookedBy = (() => {
        if (!purchaser) return null;
        const firstName = String(purchaser.firstName || '').trim();
        const lastName = String(purchaser.lastName || '').trim();
        const name = [firstName, lastName].filter(Boolean).join(' ').trim();
        return name || (purchaser.email ? String(purchaser.email).trim() : null) || null;
      })();

      const providerPayload = {
        provider: 'eagleliner',
        eaglelinerReservationId: resolvedReservationId,
        eagleliner: {
          reservationId: resolvedReservationId,
          leaseSeconds: lease,
          tripId,
          departureStopId,
          destinationStopId,
          departureDate,
          passengers,
          selectedSeatIds: Array.isArray(selectedSeatIds) ? selectedSeatIds : [],
          passengerDetails: passengerArr,
          estimatedTotal: total,
          contactInfo: purchaser,
        },
      };

      await drizzleDb
        .insert(cartsPgTable)
        .values({
          cartId: resolvedPnr,
          firestoreCartId: resolvedPnr,
          bookedBy,
          status: 'awaiting_payment',
          origin: departureStopId != null ? String(departureStopId) : null,
          destination: destinationStopId != null ? String(destinationStopId) : null,
          departAt: departureDate != null ? String(departureDate) : null,
          passengerCount,
          purchaser,
          passengers: passengerArr.length ? passengerArr : null,
          busbudResponse: providerPayload,
          costPrice: total,
          retailPrice: total,
          expiresAt: expiresAt || undefined,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: cartsPgTable.cartId,
          set: {
            firestoreCartId: resolvedPnr,
            bookedBy,
            status: 'awaiting_payment',
            origin: departureStopId != null ? String(departureStopId) : null,
            destination: destinationStopId != null ? String(destinationStopId) : null,
            departAt: departureDate != null ? String(departureDate) : null,
            passengerCount,
            purchaser,
            passengers: passengerArr.length ? passengerArr : null,
            busbudResponse: providerPayload,
            costPrice: total,
            retailPrice: total,
            expiresAt: expiresAt ? expiresAt : sql`${cartsPgTable.expiresAt}`,
            updatedAt: new Date(),
          }
        });
    } catch (e) {
      logger.warn('[eagleliner] Failed to persist cart to Postgres', {
        pnr: resolvedPnr,
        reservationId: resolvedReservationId,
        error: e && e.message ? e.message : String(e),
      });
    }

    return { ok: true };
  } catch (e) {
    logger.warn('[eagleliner] upsertEaglelinerPnrMapping failed', {
      pnr: resolvedPnr,
      reservationId: resolvedReservationId,
      error: e && e.message ? e.message : String(e),
    });
    return null;
  }
}

async function resolveEaglelinerReservationId(value) {
  const raw = String(value || '').trim();
  if (!raw) return { reservationId: null, pnr: null };
  const found = await findEaglelinerReservationIdByPnr(raw);
  if (found && found.reservationId) {
    return { reservationId: String(found.reservationId), pnr: String(found.pnr || raw) };
  }
  return { reservationId: raw, pnr: null };
}

async function findEaglelinerReservationIdByPnr(pnr) {
  const resolved = String(pnr || '').trim();
  if (!resolved) return null;

  try {
    const fs = await getFirestore();
    const snap = await fs.collection('carts').doc(resolved).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const isEagle = data.source === 'eagleliner' || data.provider === 'eagleliner' || !!data.eaglelinerReservationId || !!(data.eagleliner && data.eagleliner.reservationId);
    if (!isEagle) return null;
    const reservationId = data.eaglelinerReservationId || (data.eagleliner && data.eagleliner.reservationId) || null;
    if (!reservationId) return null;
    return {
      pnr: resolved,
      reservationId: String(reservationId),
      record: data,
    };
  } catch (_) {
    return null;
  }
}

router.get('/passenger-types', async (req, res) => {
  try {
    const data = await listPassengerTypes();
    return res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to list passenger types' });
  }
});

function assertAgentKey(req) {
  const requiredKey = String(process.env.AGENT_API_KEY || '').trim();
  if (!requiredKey) return;
  const provided = String(req.headers['x-agent-key'] || '').trim();
  if (provided !== requiredKey) {
    const err = new Error('Unauthorized');
    err.statusCode = 401;
    throw err;
  }
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function asPositiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findAdultFarePrice(fairPrice) {
  const list = Array.isArray(fairPrice) ? fairPrice : [];
  const adult = list.find((p) => String(p?.name || '').toLowerCase().includes('adult'));
  const candidate = adult || list[0] || null;
  const price = candidate ? Number(candidate.price) : NaN;
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function computeEstimatedTotalFromTripsFind({ username, password, tripId, departureStopId, destinationStopId, departureDate, passengers }) {
  try {
    const resolvedTripId = Number(tripId);
    const resolvedDepartureStopId = Number(departureStopId);
    const resolvedDestinationStopId = Number(destinationStopId);
    const resolvedPassengers = Number(passengers);
    if (!Number.isFinite(resolvedTripId) || resolvedTripId <= 0) return null;
    if (!Number.isFinite(resolvedDepartureStopId) || resolvedDepartureStopId <= 0) return null;
    if (!Number.isFinite(resolvedDestinationStopId) || resolvedDestinationStopId <= 0) return null;
    if (!departureDate) return null;
    const pax = Number.isFinite(resolvedPassengers) && resolvedPassengers > 0 ? resolvedPassengers : 1;

    const client = createEaglelinerClient();
    const result = await client.request({
      method: 'POST',
      path: '/api/v2/trips/find',
      username,
      password,
      data: {
        TripDetails: {
          Trip1: {
            DepartureStopID: resolvedDepartureStopId,
            DestinationStopID: resolvedDestinationStopId,
            DepartureDate: String(departureDate),
            Passengers: pax,
            OperatorFilterID: Number(process.env.EAGLE_OPERATOR_ID || 2),
          },
        },
      },
    });

    const list = result && result.AvailableTrips && result.AvailableTrips.Trip1;
    const trips = Array.isArray(list) ? list : [];
    const match = trips.find((t) => Number(t?.TripID) === resolvedTripId) || trips[0] || null;
    if (!match) return null;

    const unit = findAdultFarePrice(match?.FairPrice);
    if (!unit) return null;

    const total = unit * pax;
    return Number.isFinite(total) && total > 0 ? total : null;
  } catch (_) {
    return null;
  }
}

function buildEaglelinerTicketsHtml({ reservationId, tickets }) {
  const list = Array.isArray(tickets) ? tickets : [];

  const cards = list
    .map((t, idx) => {
      const prints = Number(t?.Prints ?? t?.prints ?? 0) || 0;
      const isReprint = prints > 1;
      const passengerName = [t?.Title, t?.Firstname, t?.Surname].filter(Boolean).join(' ').trim() || '—';
      const phone = t?.Telephone || '—';
      const seat = t?.SeatNo || '—';
      const ticketNo = t?.TicketNumber || '—';
      const routeName = t?.RouteName || '—';
      const operator = t?.Operator || '—';
      const depStop = t?.DepartureStopName || t?.DepartureStopID || '—';
      const destStop = t?.DestinationStopName || t?.DestinationStopID || '—';
      const depDt = t?.DepartureDateTime || '—';
      const arrDt = t?.DestinationArrivalTime || '—';
      const amount = t?.Amount != null ? String(t.Amount) : '—';

      return `
        <div class="card">
          <div class="header">
            <div>
              <div class="brand">Eagleliner Ticket</div>
              <div class="sub">Reservation: <strong>${escapeHtml(reservationId || '')}</strong></div>
            </div>
            <div class="pill ${isReprint ? 'reprint' : 'print'}">
              ${isReprint ? `REPRINT (${prints})` : `PRINT (${prints || 1})`}
            </div>
          </div>

          <div class="section">
            <div class="grid">
              <div>
                <div class="label">Passenger</div>
                <div class="value">${escapeHtml(passengerName)}</div>
                <div class="muted">Phone: ${escapeHtml(phone)}</div>
                <div class="muted">Type: ${escapeHtml(t?.Type || '—')}</div>
              </div>
              <div>
                <div class="label">Ticket No</div>
                <div class="value">${escapeHtml(ticketNo)}</div>
                <div class="muted">Seat: ${escapeHtml(seat)}</div>
                <div class="muted">Amount: ${escapeHtml(amount)}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="label">Route</div>
            <div class="value">${escapeHtml(routeName)}</div>
            <div class="muted">Operator: ${escapeHtml(operator)}</div>
          </div>

          <div class="section">
            <div class="grid">
              <div>
                <div class="label">Depart</div>
                <div class="value">${escapeHtml(depStop)}</div>
                <div class="muted">${escapeHtml(depDt)}</div>
              </div>
              <div>
                <div class="label">Arrive</div>
                <div class="value">${escapeHtml(destStop)}</div>
                <div class="muted">${escapeHtml(arrDt)}</div>
              </div>
            </div>
          </div>

          <div class="footer">Ticket ${idx + 1} of ${list.length}. Present this ticket at boarding.</div>
        </div>
      `;
    })
    .join('\n');

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <title>Eagleliner Ticket ${escapeHtml(reservationId || '')}</title>
    <style>
      *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Inter',system-ui,sans-serif;}
      body{margin:0;padding:16px;background:#f6f7fb;}
      .wrap{max-width:820px;margin:0 auto;}
      .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 10px 25px rgba(0,0,0,0.08);overflow:hidden;margin-bottom:14px;}
      .header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 16px;background:#faf7fd;border-bottom:1px solid #e5e7eb;}
      .brand{font-weight:800;color:#652D8E;font-size:14px;}
      .sub{margin-top:2px;font-size:12px;color:#4b5563;}
      .pill{padding:4px 10px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;}
      .pill.print{background:#d1fae5;color:#065f46;}
      .pill.reprint{background:#fee2e2;color:#991b1b;}
      .section{padding:14px 16px;border-bottom:1px solid #e5e7eb;}
      .section:last-of-type{border-bottom:none;}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;}
      .label{font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;margin-bottom:3px;}
      .value{font-size:14px;font-weight:800;color:#111827;}
      .muted{font-size:12px;color:#6b7280;margin-top:2px;}
      .footer{padding:10px 16px;font-size:11px;color:#6b7280;background:#f9fafb;}
    </style>
  </head>
  <body>
    <div class="wrap">
      ${cards || `<div class="card"><div class="section"><div class="value">No tickets returned</div></div></div>`}
    </div>
  </body>
  </html>`;
}

router.post('/trips/reserve_seats', async (req, res) => {
  try {
    const correlationId = req.requestId || `eagle-reserve-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const {
      username,
      password,
      tripId,
      departureStopId,
      destinationStopId,
      departureDate,
      passengers,
      reservationTime,
      passengerDetails,
      selectedSeatIds,
      estimatedTotal,
      contactInfo,
    } = req.body || {};

    logger.info('[eagleliner.reserve_seats] incoming', {
      correlationId,
      at: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl || req.url,
      body: {
        tripId,
        departureStopId,
        destinationStopId,
        departureDate,
        passengers,
        reservationTime,
        passengerDetails: Array.isArray(passengerDetails) ? { count: passengerDetails.length } : null,
        selectedSeatIds: Array.isArray(selectedSeatIds) ? { count: selectedSeatIds.length } : null,
        estimatedTotal,
        hasContactInfo: Boolean(contactInfo),
      },
    });

    const data = await reserveSeats({
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
    });

    logger.info('[eagleliner.reserve_seats] upstream_response', {
      correlationId,
      at: new Date().toISOString(),
      success: Boolean(data && data.Success !== false),
      reservationId: data?.ReservationID ?? data?.reservationId ?? null,
      leaseSeconds: data?.ReservationLeaseTime ?? data?.reservationLeaseTime ?? null,
      error: data && (data.Error || data.error || data.message) ? String(data.Error || data.error || data.message) : null,
      response: data || null,
    });

    const reservationId = data?.ReservationID ?? data?.reservationId;
    const leaseSeconds = data?.ReservationLeaseTime ?? data?.reservationLeaseTime;

    const paxCount = Number(passengers || 0) || (Array.isArray(passengerDetails) ? passengerDetails.length : 0) || 0;
    const qty = paxCount > 0 ? paxCount : 1;
    const resolvedEstimatedTotal =
      asPositiveNumber(estimatedTotal) ||
      (await computeEstimatedTotalFromTripsFind({
        username,
        password,
        tripId,
        departureStopId,
        destinationStopId,
        departureDate,
        passengers: qty,
      }));

    let internalPnr = null;
    try {
      internalPnr = await generateCartId();
    } catch (_) {
      internalPnr = null;
    }

    if (reservationId) {
      upsertReservation({
        reservationId,
        pnr: internalPnr || null,
        leaseSeconds,
        tripId,
        departureStopId,
        destinationStopId,
        departureDate,
        passengers,
        selectedSeatIds: Array.isArray(selectedSeatIds) ? selectedSeatIds : [],
        passengerDetails: Array.isArray(passengerDetails) ? passengerDetails : [],
        estimatedTotal: resolvedEstimatedTotal,
        status: 'reserved',
      });

      if (internalPnr) {
        await upsertEaglelinerPnrMapping({
          pnr: internalPnr,
          reservationId,
          leaseSeconds,
          tripId,
          departureStopId,
          destinationStopId,
          departureDate,
          passengers,
          selectedSeatIds,
          passengerDetails,
          estimatedTotal: resolvedEstimatedTotal,
          contactInfo,
        });
      }

      try {
        const tm = getTravelMasterClient();
        const total = resolvedEstimatedTotal;
        const unit = total && qty > 0 ? Number(total) / qty : 0;

        if (!tm) {
          logger.warn('[eagleliner] Odoo invoice skipped (TravelMaster not configured)', {
            hasUrl: Boolean(process.env.TRAVELMASTER_URL),
            hasDb: Boolean(process.env.TRAVELMASTER_DB),
            hasUsername: Boolean(process.env.TRAVELMASTER_USERNAME),
            hasPassword: Boolean(process.env.TRAVELMASTER_PASSWORD || process.env.TRAVELMASTER_API_KEY),
          });
        } else if (!internalPnr) {
          logger.warn('[eagleliner] Odoo invoice skipped (missing internal PNR)', { reservationId: String(reservationId || '') });
        } else if (!Number.isFinite(total) || !(total > 0)) {
          logger.warn('[eagleliner] Odoo invoice skipped (invalid total)', { pnr: internalPnr, total: String(estimatedTotal), computedTotal: total == null ? null : String(total) });
        } else {
          const firstName = contactInfo && typeof contactInfo === 'object' ? String(contactInfo.firstName || '').trim() : '';
          const lastName = contactInfo && typeof contactInfo === 'object' ? String(contactInfo.lastName || '').trim() : '';
          const email = contactInfo && typeof contactInfo === 'object' ? String(contactInfo.email || '').trim() : '';
          const phone = contactInfo && typeof contactInfo === 'object' ? String(contactInfo.phone || '').trim() : '';
          const partnerName = [firstName, lastName].filter(Boolean).join(' ').trim() || `Eagleliner Customer ${internalPnr}`;

          const partnerId = await tm.findOrCreatePartner(partnerName, email, phone);
          const expiry = (() => {
            const lease = Number(leaseSeconds || 0) || 0;
            if (lease > 0) return new Date(Date.now() + lease * 1000);
            return new Date(Date.now() + 15 * 60 * 1000);
          })();

          const lineNameParts = [
            'Eagleliner Reservation',
            `PNR: ${internalPnr}`,
            `ReservationID: ${reservationId}`,
            departureDate ? `Departure: ${departureDate}` : null,
          ].filter(Boolean);

          const line = {
            name: lineNameParts.join('\n'),
            quantity: qty,
            price_unit: unit,
            price_total: Number(total),
            product_id: 92,
            product_uom_id: 1,
            tax_ids: []
          };

          const invoiceId = await tm.findOrCreateInvoice(partnerId, internalPnr, [[0, 0, line]], expiry);
          await tm.postInvoice(invoiceId);

          logger.info('[eagleliner] Odoo invoice posted', {
            pnr: internalPnr,
            reservationId: String(reservationId || ''),
            invoiceId,
            total: Number(total),
            expiresAt: expiry instanceof Date ? expiry.toISOString() : String(expiry),
          });

          try {
            const fs = await getFirestore();
            await fs.collection('carts').doc(String(internalPnr)).set({
              invoice: {
                id: invoiceId,
                pnr: internalPnr,
                number: `INV-${invoiceId}`,
                total: Number(total),
                expiresAt: expiry,
                status: 'posted'
              }
            }, { merge: true });
          } catch (_) {}
        }
      } catch (e) {
        logger.warn('[eagleliner] Failed to create/post Odoo invoice', {
          pnr: internalPnr || null,
          reservationId: reservationId ? String(reservationId) : null,
          error: e && e.message ? e.message : String(e),
        });
      }
    }

    return res.json({
      ...data,
      Meta: {
        ...(data && data.Meta ? data.Meta : {}),
        selectedSeatIds: Array.isArray(selectedSeatIds) ? selectedSeatIds : [],
        pnr: internalPnr || null,
        reservationId: reservationId ? String(reservationId) : null,
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to reserve seats' });
  }
});

router.get('/agent/lookup', ...requireAgentApi, async (req, res) => {
  try {
    const q = req.query || {};
    const pnr = q.pnr || q.PNR || q.reference || q.Reference;
    const resolved = String(pnr || '').trim();
    if (!resolved) {
      return res.status(400).json({ ok: false, message: 'pnr is required' });
    }

    const found = await findEaglelinerReservationIdByPnr(resolved);
    if (!found) {
      return res.status(404).json({ ok: false, message: 'Not found' });
    }

    return res.json({
      ok: true,
      pnr: found.pnr,
      reservationId: found.reservationId,
      record: found.record,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to lookup PNR' });
  }
});

router.get('/agent/reservations', ...requireAgentApi, async (req, res) => {
  try {
    return res.json({ ok: true, reservations: listReservations() });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to list reservations' });
  }
});

router.post('/reservation/cancel_reservation', async (req, res) => {
  try {
    const { username, password, reservationId, ReservationID } = req.body || {};
    const resolvedId = reservationId || ReservationID;

    const data = await cancelReservation({
      username,
      password,
      reservationId: resolvedId,
    });

    if (resolvedId) {
      markCancelled(resolvedId);
    }

    return res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to cancel reservation' });
  }
});

router.post('/reservation/make_payment', ...requireAgentApi, async (req, res) => {
  try {
    const requestId = `eagle-makepay-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const {
      username,
      password,
      reservationId,
      ReservationID,
      pnr,
      PNR,
      amountReceived,
      AmountReceived,
      paymentMethod,
      PaymentMethod,
    } = req.body || {};

    logger.info('[eagleliner.make_payment] incoming', {
      requestId,
      at: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl || req.url,
      agentId: req.agentId || (req.agent && req.agent.id) || null,
      agentEmail: req.agentEmail || (req.agent && (req.agent.emailLower || req.agent.email)) || null,
      body: {
        reservationId,
        ReservationID,
        pnr,
        PNR,
        amountReceived,
        AmountReceived,
        paymentMethod,
        PaymentMethod,
      },
    });

    const provided = reservationId || ReservationID || pnr || PNR;
    const resolvedLookup = await resolveEaglelinerReservationId(provided);
    const resolvedId = resolvedLookup.reservationId;
    const resolvedAmount = amountReceived ?? AmountReceived;
    const resolvedMethod = paymentMethod ?? PaymentMethod ?? 1;

    logger.info('[eagleliner.make_payment] resolved', {
      requestId,
      at: new Date().toISOString(),
      provided,
      resolvedId,
      resolvedAmount,
      resolvedMethod,
      pnr: resolvedLookup.pnr || null,
    });

    const data = await makePayment({
      username,
      password,
      reservationId: resolvedId,
      amountReceived: resolvedAmount,
      paymentMethod: resolvedMethod,
    });

    logger.info('[eagleliner.make_payment] completed', {
      requestId,
      at: new Date().toISOString(),
      reservationId: resolvedId,
      success: Boolean(data && data.Success !== false),
      error: data && (data.Error || data.error || data.message) ? String(data.Error || data.error || data.message) : null,
      response: data || null,
    });

    if (resolvedId) {
      markPaid(resolvedId, data);

      // Best-effort: mark Firestore mapping as paid when payment succeeds.
      if (data && data.Success && resolvedLookup.pnr) {
        try {
          const fs = await getFirestore();
          await fs.collection('carts').doc(String(resolvedLookup.pnr)).set({
            status: 'paid',
            paidAt: FieldValue.serverTimestamp(),
            payment: data || null,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (_) {}
      }
    }

    return res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to make payment' });
  }
});

router.post('/reservation/print_tickets', ...requireAgentApi, async (req, res) => {
  try {
    const { username, password, reservationId, ReservationID, pnr, PNR } = req.body || {};
    const provided = reservationId || ReservationID || pnr || PNR;
    const resolvedLookup = await resolveEaglelinerReservationId(provided);
    const resolvedId = resolvedLookup.reservationId;
    const data = await printTickets({ username, password, reservationId: resolvedId });

    if (resolvedId) {
      upsertReservation({
        reservationId: resolvedId,
        pnr: resolvedLookup.pnr || null,
        tickets: Array.isArray(data?.Tickets) ? data.Tickets : [],
        printedAtMs: Date.now(),
        lastPrintResult: data || null,
      });

      if (resolvedLookup.pnr) {
        try {
          const fs = await getFirestore();
          await fs.collection('carts').doc(String(resolvedLookup.pnr)).set({
            printedAt: FieldValue.serverTimestamp(),
            lastPrintResult: data || null,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        } catch (_) {}

        try {
          await ensureCartsTableExists();

          const pnrKey = String(resolvedLookup.pnr || '').trim();
          const tickets = Array.isArray(data?.Tickets) ? data.Tickets : [];
          const firstTicket = tickets[0] || {};

          const existingCartRows = await drizzleDb
            .select({
              passengers: cartsPgTable.passengers,
              busbudResponse: cartsPgTable.busbudResponse,
              origin: cartsPgTable.origin,
              destination: cartsPgTable.destination,
              departAt: cartsPgTable.departAt,
              arriveAt: cartsPgTable.arriveAt,
            })
            .from(cartsPgTable)
            .where(or(eq(cartsPgTable.cartId, pnrKey), eq(cartsPgTable.firestoreCartId, pnrKey)))
            .limit(1);
          const existingCart = existingCartRows && existingCartRows.length ? (existingCartRows[0] || {}) : {};

          const existingProvider = existingCart.busbudResponse && typeof existingCart.busbudResponse === 'object'
            ? existingCart.busbudResponse
            : null;
          let nextProvider = existingProvider;
          if (existingProvider && typeof existingProvider === 'object') {
            nextProvider = { ...existingProvider };
            if (!nextProvider.provider) nextProvider.provider = 'eagleliner';
            if (!nextProvider.source) nextProvider.source = 'eagleliner';
            if (!nextProvider.eaglelinerReservationId) nextProvider.eaglelinerReservationId = String(resolvedId || '').trim() || null;
            const existingEagle = nextProvider.eagleliner && typeof nextProvider.eagleliner === 'object' ? nextProvider.eagleliner : {};
            nextProvider.eagleliner = {
              ...existingEagle,
              reservationId: existingEagle.reservationId || (String(resolvedId || '').trim() || null),
              tickets,
              printedAtMs: Date.now(),
            };
          }

          const basePassengers = Array.isArray(existingCart.passengers)
            ? existingCart.passengers
            : (nextProvider && nextProvider.eagleliner && Array.isArray(nextProvider.eagleliner.passengerDetails) ? nextProvider.eagleliner.passengerDetails : []);

          const mappedPassengers = tickets.length
            ? tickets.map((t, idx) => {
              const p = basePassengers[idx] && typeof basePassengers[idx] === 'object' ? basePassengers[idx] : {};
              const first = t && (t.Firstname || t.firstName || t.first_name) ? String(t.Firstname || t.firstName || t.first_name) : (p.Firstname || p.firstName || p.first_name || '');
              const last = t && (t.Surname || t.lastName || t.last_name) ? String(t.Surname || t.lastName || t.last_name) : (p.Surname || p.lastName || p.last_name || '');
              const seat = t && (t.SeatNo || t.seatNo || t.Seat || t.seat) ? String(t.SeatNo || t.seatNo || t.Seat || t.seat) : (p.Seat || p.seat || p.seat_id || p.selectedSeat || '');
              const ticketNo = t && (t.TicketNumber || t.ticketNumber || t.ticket_no || t.ticketNo) ? String(t.TicketNumber || t.ticketNumber || t.ticket_no || t.ticketNo) : (p.TicketNumber || p.ticketNumber || p.ticket_no || p.ticketNo || p.ticketNo || null);
              const type = (p.Type ?? p.type ?? p.PassengerType ?? p.passengerType ?? (t && (t.Type ?? t.type)) ?? null);
              return {
                ...p,
                first_name: p.first_name || p.firstName || p.Firstname || first,
                last_name: p.last_name || p.lastName || p.Surname || last,
                firstName: p.firstName || p.first_name || p.Firstname || first,
                lastName: p.lastName || p.last_name || p.Surname || last,
                seat: p.seat || p.seat_id || p.selectedSeat || p.Seat || seat,
                selectedSeat: p.selectedSeat || p.seat || p.seat_id || p.Seat || seat,
                TicketNumber: ticketNo || (t && t.TicketNumber) || p.TicketNumber || null,
                ticketNo: p.ticketNo || p.ticket_no || ticketNo || null,
                Type: type,
                _eaglelinerTicket: t || null,
              };
            })
            : (Array.isArray(existingCart.passengers) ? existingCart.passengers : null);

          const originName = firstTicket && firstTicket.DepartureStopName ? String(firstTicket.DepartureStopName) : null;
          const destinationName = firstTicket && firstTicket.DestinationStopName ? String(firstTicket.DestinationStopName) : null;
          const departAt = firstTicket && firstTicket.DepartureDateTime
            ? String(firstTicket.DepartureDateTime)
            : (existingCart.departAt != null ? String(existingCart.departAt) : null);
          const arriveAt = firstTicket && firstTicket.DestinationArrivalTime
            ? String(firstTicket.DestinationArrivalTime)
            : (existingCart.arriveAt != null ? String(existingCart.arriveAt) : null);

          await drizzleDb
            .update(cartsPgTable)
            .set({
              origin: originName || (existingCart.origin != null ? String(existingCart.origin) : null),
              destination: destinationName || (existingCart.destination != null ? String(existingCart.destination) : null),
              departAt,
              arriveAt,
              passengers: mappedPassengers,
              passengerCount: Array.isArray(mappedPassengers) ? mappedPassengers.length : sql`${cartsPgTable.passengerCount}`,
              busbudResponse: nextProvider || (existingProvider && typeof existingProvider === 'object' ? existingProvider : null),
              updatedAt: new Date(),
            })
            .where(or(eq(cartsPgTable.cartId, pnrKey), eq(cartsPgTable.firestoreCartId, pnrKey)));
        } catch (e) {
          logger.warn('[eagleliner.print_tickets] Failed to persist print_tickets data to Postgres', {
            pnr: String(resolvedLookup.pnr || ''),
            reservationId: String(resolvedId || ''),
            error: e && e.message ? e.message : String(e),
          });
        }
      }
    }

    return res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to print tickets' });
  }
});

router.get('/ticket/pdf', ...requireAgentApi, async (req, res) => {
  try {
    const q = req.query || {};
    const reservationId = q.reservationId || q.ReservationID || q.pnr || q.PNR;

    const resolvedLookup = await resolveEaglelinerReservationId(reservationId);
    const resolvedId = String(resolvedLookup.reservationId || '').trim();
    if (!resolvedId) {
      return res.status(400).json({ ok: false, message: 'reservationId is required' });
    }

    const pnrKey = resolvedLookup && resolvedLookup.pnr ? String(resolvedLookup.pnr).trim() : '';

    const forceDownload = q.download === '1' || q.download === 1 || q.download === true || q.download === 'true';
    const disposition = forceDownload ? 'attachment' : 'inline';

    const apiBaseRaw = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const apiBase = String(apiBaseRaw || '').replace(/\/+$/, '').replace(/\/api$/i, '');

    let buf = null;
    let url = null;

    if (pnrKey) {
      // Preferred: use unified ticket endpoint so Eagleliner renders with the same template as Busbud.
      url = `${apiBase}/api/ticket/pdf?pnr=${encodeURIComponent(pnrKey)}&type=final&strict=1&paper=thermal48&download=1`;
      const fetchUrl = `${apiBase}/api/ticket/pdf?pnr=${encodeURIComponent(pnrKey)}&type=final&strict=1&paper=thermal48&regen=1`;
      const pdfRes = await axios.get(fetchUrl, { responseType: 'arraybuffer', validateStatus: () => true });
      if (!pdfRes || pdfRes.status !== 200) {
        const msg = `Failed to generate unified ticket PDF (status ${pdfRes && pdfRes.status != null ? pdfRes.status : 'unknown'})`;
        return res.status(502).json({ ok: false, message: msg });
      }
      buf = Buffer.from(pdfRes.data || []);
      if (!buf || !buf.length) {
        return res.status(502).json({ ok: false, message: 'Failed to generate unified ticket PDF (empty response)' });
      }
    } else {
      // Fallback: legacy Eagleliner-only template when we do not have a PNR mapping.
      const data = await printTickets({ reservationId: resolvedId });
      if (!data || data.Success === false) {
        const msg = (data && (data.Error || data.error || data.message)) ? (data.Error || data.error || data.message) : 'Failed to print tickets';
        return res.status(502).json({ ok: false, message: msg });
      }
      const html = buildEaglelinerTicketsHtml({ reservationId: resolvedId, tickets: data?.Tickets });
      const pdf = await generatePdfFromHtml(html, { format: 'A4', printBackground: true });
      buf = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
      url = `${apiBase}/api/eagleliner/ticket/pdf?pnr=${encodeURIComponent(String(resolvedId))}&download=1`;
    }

    try {
      if (pnrKey && url) {
        const bookedBy = (req.agentEmail || (req.agent && (req.agent.emailLower || req.agent.email)) || '').toString() || null;
        await drizzleDb
          .insert(ticketsPgTable)
          .values({
            pnr: pnrKey,
            bookedBy,
            url,
            finalPdfBase64: buf.toString('base64'),
            finalPdfUpdatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: ticketsPgTable.pnr,
            set: {
              bookedBy,
              url,
              finalPdfBase64: buf.toString('base64'),
              finalPdfUpdatedAt: new Date(),
            },
          });
      }
    } catch (_) {}

    const filename = `eticket-${encodeURIComponent(pnrKey || resolvedId)}.pdf`;

    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    res.setHeader('Content-Length', buf.length);
    return res.end(buf);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to generate ticket PDF' });
  }
});

export default router;
