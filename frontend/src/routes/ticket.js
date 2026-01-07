import express from 'express';
import logger from '../utils/logger.js';
import { generateCartId } from '../utils/idGenerator.js';
import TicketService from '../services/ticket.service.js';
import { getFirestore } from '../config/firebase.config.mjs';
import { getOrCreateFirestoreCartId } from '../utils/firestore.js';
import { sendEmail } from '../utils/email.js';
import axios from 'axios';
import qr from 'qr-image';
import drizzleDb, { payments } from '../db/drizzleClient.js';
import { eq } from 'drizzle-orm';
import { applyPriceAdjustments } from '../utils/price.utils.js';
import { body, query, validationResult } from 'express-validator';
import fs from 'fs';

// In-memory cart storage
const carts = new Map();

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

const usePostgresFirstForEticket = process.env.ETICKET_USE_POSTGRES_FIRST === 'true';

const loadTicketCartFromPostgres = async (pnr, requestId) => {
  try {
    const rows = await drizzleDb
      .select({
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        transactionRef: payments.transactionRef,
        rawResponse: payments.rawResponse,
        createdAt: payments.createdAt
      })
      .from(payments)
      .where(eq(payments.transactionRef, String(pnr)))
      .limit(1);
    if (!rows || !rows.length) {
      return null;
    }
    const row = rows[0];
    const purchase = row.rawResponse || {};
    const booking = purchase.booking || {};
    const user = purchase.user || purchase.purchaser || {};
    const purchaser = {
      first_name: user.first_name || user.firstName || null,
      last_name: user.last_name || user.lastName || null,
      email: user.email || null,
      phone: user.phone_number || user.phone || user.phoneNumber || null
    };
    const items = Array.isArray(purchase.items) ? purchase.items : [];
    const passengers = [];
    for (const it of items) {
      if (it && it.passenger) {
        passengers.push(it.passenger);
      }
    }
    let ticketRef = null;
    if (items.length) {
      const item0 = items[0] || {};
      const fields = item0.fields || {};
      ticketRef =
        (fields.booking_reference || fields.reference) ||
        item0.reference ||
        null;
    }
    if (!ticketRef) {
      const booking = purchase.booking || {};
      ticketRef =
        booking.reference ||
        purchase.reference ||
        purchase.id ||
        purchase.uuid ||
        null;
    }
    let origin = null;
    let destination = null;
    let departureIso = null;
    let arrivalIso = null;
    let tripOperator = null;
    const firstItem = items[0] || null;
    if (firstItem && firstItem.trip) {
      const tripKey = firstItem.trip.id || firstItem.trip.trip_id || firstItem.trip.tripId;
      const tripsMap = purchase.trips && typeof purchase.trips === 'object' ? purchase.trips : {};
      const trip = tripKey && tripsMap[tripKey] ? tripsMap[tripKey] : null;
      if (trip && Array.isArray(trip.segments) && trip.segments.length) {
        const seg = trip.segments[0] || {};
        const originObj = seg.origin || {};
        const destObj = seg.destination || {};
        const originCity = originObj.city || {};
        const destCity = destObj.city || {};
        origin = originObj.name || originCity.name || origin;
        destination = destObj.name || destCity.name || destination;
        const segOperator = seg.operator || {};
        tripOperator =
          seg.operator_name ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOperator.name ||
          segOperator.label ||
          segOperator.operator_name ||
          tripOperator;
        let departure = null;
        let arrival = null;
        const segDepartureTime = seg.departure_time || seg.departureTime || null;
        if (trip.departure_time && trip.departure_time.timestamp) {
          departure = trip.departure_time.timestamp;
        } else if (trip.departure_time) {
          departure = trip.departure_time;
        } else if (trip.departure_time_utc) {
          departure = trip.departure_time_utc;
        } else if (segDepartureTime && segDepartureTime.timestamp) {
          departure = segDepartureTime.timestamp;
        } else if (segDepartureTime) {
          departure = segDepartureTime;
        } else if (seg.departure_time_utc) {
          departure = seg.departure_time_utc;
        }
        const segArrivalTime = seg.arrival_time || seg.arrivalTime || null;
        if (trip.arrival_time && trip.arrival_time.timestamp) {
          arrival = trip.arrival_time.timestamp;
        } else if (trip.arrival_time) {
          arrival = trip.arrival_time;
        } else if (trip.arrival_time_utc) {
          arrival = trip.arrival_time_utc;
        } else if (segArrivalTime && segArrivalTime.timestamp) {
          arrival = segArrivalTime.timestamp;
        } else if (segArrivalTime) {
          arrival = segArrivalTime;
        } else if (seg.arrival_time_utc) {
          arrival = seg.arrival_time_utc;
        }
        if (departure) {
          const d = new Date(departure);
          if (!Number.isNaN(d.getTime())) {
            departureIso = d.toISOString();
          }
        }
        if (arrival) {
          const a = new Date(arrival);
          if (!Number.isNaN(a.getTime())) {
            arrivalIso = a.toISOString();
          }
        }
      }
    }
    if (!origin) {
      origin = purchase.origin_name || purchase.origin || 'Unknown';
    }
    if (!destination) {
      destination = purchase.destination_name || purchase.destination || 'Unknown';
    }
    const now = new Date();
    const fallbackDeparture =
      purchase.completed_at ||
      purchase.created_at ||
      purchase.updated_at ||
      (row.createdAt || now).toISOString();
    if (!departureIso) {
      const d = new Date(fallbackDeparture);
      departureIso = !Number.isNaN(d.getTime()) ? d.toISOString() : now.toISOString();
    }
    if (!arrivalIso) {
      arrivalIso = departureIso;
    }
    if (!tripOperator && Array.isArray(booking.tickets)) {
      const ticketsArr = booking.tickets;
      if (ticketsArr.length > 0) {
        const firstTicket = ticketsArr[0] || {};
        const seg = firstTicket.segment || firstTicket.trip || {};
        const segOp = seg.operator || {};
        tripOperator =
          seg.operator_name ||
          (typeof seg.operator === 'string' ? seg.operator : null) ||
          segOp.name ||
          segOp.label ||
          segOp.operator_name ||
          tripOperator;
      }
    }
    const charges = purchase.charges || {};
    const stats = purchase.stats || {};
    const summary = purchase.summary || {};
    let currency = null;
    if (charges.currency) {
      currency = charges.currency;
    } else if (stats.customer_value && stats.customer_value.currency) {
      currency = stats.customer_value.currency;
    } else if (summary.currency) {
      currency = summary.currency;
    } else {
      currency = 'USD';
    }
    const amountNumber = Number(row.amount || 0);
    const cart = {};
    cart.purchaser = purchaser;
    cart.requiredPassengers = passengers;
    cart.passengerDetails = {
      completePurchase: purchase,
      busbudResponse: purchase
    };
    if (ticketRef) {
      cart.ticketNo = ticketRef;
      cart.bookingId = ticketRef;
    }
    cart.tripDetails = {
      origin,
      destination,
      departureTime: departureIso,
      arrivalTime: arrivalIso,
      operator: tripOperator || null
    };
    cart.totalAmount = Number.isFinite(amountNumber) ? amountNumber : null;
    cart.summary = { currency };
    cart.paymentMethod = row.method || 'Online';
    cart.bookingTimestamp = row.createdAt || fallbackDeparture;
    return cart;
  } catch (e) {
    logger.warn(`[${requestId}] Failed to load ticket cart from Postgres`, { pnr, error: e.message });
    return null;
  }
};

// Simple Firestore ticket functions
const saveTicket = async (ticketData) => {
  if (!ticketData.id) {
    ticketData.id = `ticket_${Date.now()}`;
  }
  ticketData.updatedAt = new Date().toISOString();
  const db = await getFirestore();
  const firestoreCartId = await getOrCreateFirestoreCartId(ticketData.cartId);
  await db.collection('carts').doc(firestoreCartId).collection('tickets').doc(ticketData.id).set(ticketData);
  return ticketData;
};

const getTicket = async (cartId, ticketId) => {
  const db = await getFirestore();
  const firestoreCartId = await getOrCreateFirestoreCartId(cartId);
  const doc = await db.collection('carts').doc(firestoreCartId).collection('tickets').doc(ticketId).get();
  return doc.exists ? doc.data() : null;
};

const getTicketsByCartId = async (cartId) => {
  const db = await getFirestore();
  const firestoreCartId = await getOrCreateFirestoreCartId(cartId);
  const snapshot = await db.collection('carts').doc(firestoreCartId).collection('tickets').get();
  return snapshot.docs.map(doc => doc.data());
};

const router = express.Router();

console.log('✅ Ticket route loaded');

// ================================
// 🎫 FRONTEND TICKET CREATION
// ================================
// POST /api/ticket/create
// Frontend-friendly endpoint that accepts cart ID from frontend
// Expected request body: { cartId: "string", options?: object }
router.post('/create', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { cartId, options } = req.body;

  console.log(`\n=== FRONTEND TICKET CREATION ===`);
  console.log(`[${requestId}] 📨 Frontend ticket creation request`);
  console.log(`[${requestId}] 📦 Cart ID: ${cartId}`);
  console.log(`[${requestId}] 📦 Options:`, options);

  // Validate cart ID
  if (!cartId) {
    return res.status(400).json({
      success: false,
      error: 'Missing cart ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Include cartId in request body',
        'Expected format: {"cartId": "your-cart-id", "options": {...}}'
      ]
    });
  }

  try {
    console.log(`[${requestId}] 🚀 Creating ticket...`);
    const ticket = {
      id: `ticket_${Date.now()}`,
      cartId,
      options,
      status: 'pending'
    };

    // Save ticket to in-memory storage
    const savedTicket = await saveTicket(ticket);
    console.log(`[${requestId}] 💾 Ticket saved to in-memory storage`);

    console.log(`[${requestId}] 📤 Sending response to frontend`);
    console.log(`[${requestId}] ✅ Success: true`);
    console.log(`[${requestId}] 🎫 Ticket ID: ${savedTicket.id}`);

    res.json({
      success: true,
      ticket: savedTicket
    });

  } catch (error) {
    console.error(`[${requestId}] 💥 Unexpected error:`, error.message);

    res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error during ticket creation',
        type: 'INTERNAL_ERROR',
        details: error.message
      },
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

router.post(
  '/failed/send',
  [
    body().isObject().withMessage('Body must be a JSON object'),
    body('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string'),
    body('cartId').optional().isString().trim().isLength({ min: 1, max: 128 }).withMessage('cartId must be a string')
  ],
  async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    try {
      const v = validationResult(req);
      if (!v.isEmpty()) {
        return res.status(400).json({ success: false, errors: v.array({ onlyFirstError: true }) });
      }
      const body = req.body || {};
      const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [String(k).toLowerCase(), v]));
      const pnr = lower.pnr || lower.reference || lower.firestorecartid || lower.cartid || lower.cart_id;
      const providedCartId = lower.cartid || lower.cart_id || null;
      const reason = lower.reason || lower.error || null;
      const purchaseStatus = lower.purchasestatus || null;

      if (!pnr) {
        return res.status(400).json({ success: false, error: 'Missing pnr', requestId, timestamp: new Date().toISOString() });
      }

      const db = await getFirestore();
      const doc = await db.collection('carts').doc(pnr).get();
      if (!doc.exists) {
        return res.status(404).json({ success: false, error: 'PNR not found', pnr, requestId, timestamp: new Date().toISOString() });
      }

      const cart = doc.data() || {};
      const cartId = providedCartId || cart.busbudCartId || cart.cartId || cart.cart_id || pnr;
      const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};
      const purchaserEmail = purchaser.email || purchaser.Email || (cart.contact_info && cart.contact_info.email) || (cart.contactInfo && cart.contactInfo.email) || cart.email || null;
      const purchaserName = (
        purchaser.name || purchaser.fullName ||
        [purchaser.first_name || purchaser.firstName, purchaser.last_name || purchaser.lastName].filter(Boolean).join(' ')
      ) || null;

      if (!purchaserEmail) {
        return res.status(400).json({ success: false, error: 'Purchaser email not found', pnr, requestId, timestamp: new Date().toISOString() });
      }

      const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM_ADDRESS || purchaserEmail;
      const appName = process.env.APP_NAME || 'Uniglade';

      const safeReason = reason || `Your purchase could not be completed${purchaseStatus ? ` (status: ${purchaseStatus})` : ''}.`;
      const html = `
        <p>Dear ${purchaserName || 'Customer'},</p>
        <p>Your ticket purchase with reference <strong>${pnr}</strong> could not be completed.</p>
        <p>${safeReason}</p>
        <p>If payment was captured, our team will review and contact you if a refund is required.</p>
        <p>You can reply to this email or contact our support team at <a href="mailto:${supportEmail}">${supportEmail}</a> for assistance.</p>
        <p>Thank you,<br/>${appName}</p>
        <p><small>Reference: ${pnr}${cartId ? ` • Cart: ${cartId}` : ''}</small></p>
      `;

      await sendEmail({
        to: purchaserEmail,
        subject: `Ticket purchase could not be completed - Ref ${pnr}`,
        html
      });

      return res.json({ success: true, requestId, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error(`[${requestId}] Failed to send failed-ticket email`, { error: error.message });
      return res.status(500).json({
        success: false,
        error: 'Internal error while sending failed-ticket email',
        requestId,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ================================
// 📧 SEND E-TICKET EMAIL (POST-PURCHASE)
// ================================
// POST /api/ticket/eticket/send
// Body: { pnr: string, cartId?: string, purchaseId?: string, purchaseUuid?: string }
router.post(
  '/eticket/send',
  [
    body().isObject().withMessage('Body must be a JSON object'),
    body('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string'),
    body('cartId').optional().isString().trim().isLength({ min: 1, max: 128 }).withMessage('cartId must be a string'),
    body('purchaseId').optional().customSanitizer(v => (v == null ? v : String(v))).isLength({ max: 128 }),
    body('purchaseUuid').optional().customSanitizer(v => (v == null ? v : String(v))).isLength({ max: 128 })
  ],
  async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) {
      return res.status(400).json({ success: false, errors: v.array({ onlyFirstError: true }) });
    }
    const body = req.body || {};
    const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [String(k).toLowerCase(), v]));
    const pnr = lower.pnr || lower.reference || lower.firestorecartid || lower.cartid || lower.cart_id;
    const providedCartId = lower.cartid || lower.cart_id || null;
    const purchaseId = lower.purchaseid || lower.purchase_id || null;
    const purchaseUuid = lower.purchaseuuid || lower.purchase_uuid || null;

    if (!pnr) {
      return res.status(400).json({ success: false, error: 'Missing pnr', requestId, timestamp: new Date().toISOString() });
    }
    let cart = null;
    if (usePostgresFirstForEticket) {
      cart = await loadTicketCartFromPostgres(pnr, requestId);
    }
    if (!cart) {
      const db = await getFirestore();
      const doc = await db.collection('carts').doc(pnr).get();
      if (!doc.exists) {
        return res.status(404).json({ success: false, error: 'PNR not found', pnr, requestId, timestamp: new Date().toISOString() });
      }
      cart = doc.data() || {};
    }
    const cartId = providedCartId || cart.busbudCartId || cart.cartId || cart.cart_id || pnr;
    const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};
    const purchaserEmail = purchaser.email || purchaser.Email || (cart.contact_info && cart.contact_info.email) || (cart.contactInfo && cart.contactInfo.email) || cart.email || null;
    const purchaserName = (
      purchaser.name || purchaser.fullName ||
      [purchaser.first_name || purchaser.firstName, purchaser.last_name || purchaser.lastName].filter(Boolean).join(' ')
    ) || null;

    if (!purchaserEmail) {
      return res.status(400).json({ success: false, error: 'Purchaser email not found', pnr, requestId, timestamp: new Date().toISOString() });
    }

    const downloadLink = `${process.env.FRONTEND_URL || 'https://your-app.com'}/tickets/${encodeURIComponent(cartId)}`;

    // Derive outbound and optional return segments using Firestore cart.trip._raw structure when available
    let origin = 'Unknown';
    let destination = 'Unknown';
    let departTs = null;
    let arriveTs = null;
    let returnOrigin = null;
    let returnDestination = null;
    let returnDepartTs = null;
    let returnArriveTs = null;

    const rawTripItem = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items[0] : null;
    const segments = rawTripItem && Array.isArray(rawTripItem.segments) ? rawTripItem.segments : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);

    // Declare outbound/return segments in outer scope so they can be used later (e.g., for operatorName)
    let outboundSeg = null;
    let returnSeg = null;

    if (Array.isArray(segments) && segments.length) {
      // Determine outbound and return segments using trip_legs when available
      outboundSeg = segments[0];

      const tripLegs = rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : [];
      if (tripLegs.length > 0) {
        const leg1SegId = tripLegs[0] && Array.isArray(tripLegs[0].segment_ids) ? tripLegs[0].segment_ids[0] : null;
        const leg2SegId = tripLegs[1] && Array.isArray(tripLegs[1].segment_ids) ? tripLegs[1].segment_ids[0] : null;

        if (leg1SegId) {
          const found = segments.find(s => s && s.id === leg1SegId);
          if (found) outboundSeg = found;
        }
        if (leg2SegId) {
          const foundReturn = segments.find(s => s && s.id === leg2SegId);
          if (foundReturn) returnSeg = foundReturn;
        }
      } else if (segments.length > 1) {
        // Fallback: treat second segment as return when no explicit trip_legs
        returnSeg = segments[1];
      }

      if (outboundSeg) {
        origin = (outboundSeg.origin && (outboundSeg.origin.city && outboundSeg.origin.city.name)) || (outboundSeg.origin && outboundSeg.origin.name) || origin;
        destination = (outboundSeg.destination && (outboundSeg.destination.city && outboundSeg.destination.city.name)) || (outboundSeg.destination && outboundSeg.destination.name) || destination;
        const dts = (outboundSeg.departure_time && (outboundSeg.departure_time.timestamp || outboundSeg.departure_time)) || (outboundSeg.departure && outboundSeg.departure.timestamp) || null;
        const ats = (outboundSeg.arrival_time && (outboundSeg.arrival_time.timestamp || outboundSeg.arrival_time)) || (outboundSeg.arrival && outboundSeg.arrival.timestamp) || null;
        departTs = dts ? new Date(dts) : null;
        arriveTs = ats ? new Date(ats) : null;
      }

      if (returnSeg) {
        returnOrigin = (returnSeg.origin && (returnSeg.origin.city && returnSeg.origin.city.name)) || (returnSeg.origin && returnSeg.origin.name) || null;
        returnDestination = (returnSeg.destination && (returnSeg.destination.city && returnSeg.destination.city.name)) || (returnSeg.destination && returnSeg.destination.name) || null;
        const rdts = (returnSeg.departure_time && (returnSeg.departure_time.timestamp || returnSeg.departure_time)) || (returnSeg.departure && returnSeg.departure.timestamp) || null;
        const rats = (returnSeg.arrival_time && (returnSeg.arrival_time.timestamp || returnSeg.arrival_time)) || (returnSeg.arrival && returnSeg.arrival.timestamp) || null;
        returnDepartTs = rdts ? new Date(rdts) : null;
        returnArriveTs = rats ? new Date(rats) : null;
      }
    } else if (cart.tripDetails) {
      origin = cart.tripDetails.originCity || cart.tripDetails.origin || origin;
      destination = cart.tripDetails.destinationCity || cart.tripDetails.destination || destination;
      departTs = cart.tripDetails.departureTime ? new Date(cart.tripDetails.departureTime) : null;
      arriveTs = cart.tripDetails.arrivalTime ? new Date(cart.tripDetails.arrivalTime) : null;
    }

    const fmt2 = (n) => String(n).padStart(2, '0');
    const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
    const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
    const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

    const departTime = departTs ? fmtTime(departTs) : '—';
    const arriveTime = arriveTs ? fmtTime(arriveTs) : '—';
    const departCityTime = `${origin}${departTime && departTime !== '—' ? ` ${departTime}` : ''}`;
    const arriveCityTime = `${destination}${arriveTime && arriveTime !== '—' ? ` ${arriveTime}` : ''}`;
    const departDateTime = departTs ? fmtDateTime(departTs) : '—';
    const arriveDateTime = arriveTs ? fmtDateTime(arriveTs) : '—';

    const hasReturnLeg = !!returnOrigin && !!returnDestination && !!returnDepartTs && !!returnArriveTs;
    const returnDepartTime = hasReturnLeg ? fmtTime(returnDepartTs) : null;
    const returnArriveTime = hasReturnLeg ? fmtTime(returnArriveTs) : null;
    const returnDepartDateTime = hasReturnLeg ? fmtDateTime(returnDepartTs) : null;
    const returnArriveDateTime = hasReturnLeg ? fmtDateTime(returnArriveTs) : null;
    const returnDepartCityTime = hasReturnLeg ? `${returnOrigin}${returnDepartTime && returnDepartTime !== '—' ? ` ${returnDepartTime}` : ''}` : null;
    const returnArriveCityTime = hasReturnLeg ? `${returnDestination}${returnArriveTime && returnArriveTime !== '—' ? ` ${returnArriveTime}` : ''}` : null;

    const refNo = pnr;
    const ticketNo = (() => {
      const cp = cart.passengerDetails && cart.passengerDetails.completePurchase;
      const cpItem = cp && Array.isArray(cp.items) && cp.items.length ? cp.items[0] : null;
      const cpRef = (cpItem && (cpItem.fields && cpItem.fields.booking_reference)) || (cpItem && cpItem.reference) || (cp && (cp.id || cp.uuid));
      return cpRef || cart.ticketNo || cart.ticket_no || cart.bookingId || cart.booking_id || cart.purchaseId || cart.purchase_id || (cart.purchase && (cart.purchase.id || cart.purchase.uuid)) || refNo;
    })();

    const completePurchase = cart.passengerDetails && cart.passengerDetails.completePurchase;
    const firstPassenger = (() => {
      if (Array.isArray(cart.passengers) && cart.passengers.length) return cart.passengers[0];
      if (cart.passengerDetails) {
        if (Array.isArray(cart.passengerDetails.passengers) && cart.passengerDetails.passengers.length) return cart.passengerDetails.passengers[0];
        const cp = completePurchase;
        if (cp) {
          if (Array.isArray(cp.items) && cp.items.length && cp.items[0].passenger) return cp.items[0].passenger;
          if (cp.user) return { first_name: cp.user.first_name, last_name: cp.user.last_name, phone: cp.user.phone_number };
          if (cp.purchaser) return { first_name: cp.purchaser.first_name, last_name: cp.purchaser.last_name, phone: cp.purchaser.phone_number };
        }
      }
      if (cart.trip && Array.isArray(cart.trip.passengers) && cart.trip.passengers.length) return cart.trip.passengers[0];
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers) && cart.trips[0].passengers.length) return cart.trips[0].passengers[0];
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) && cart.busbudResponse.passengers.length) return cart.busbudResponse.passengers[0];
      return null;
    })();
    const seatFromPassengers = (() => {
      const list = Array.isArray(cart.passengers) ? cart.passengers : (cart.passengerDetails && Array.isArray(cart.passengerDetails.passengers) ? cart.passengerDetails.passengers : []);
      for (const p of list) {
        const ss = p && p.selected_seats && p.selected_seats[0];
        if (ss && (ss.seat || ss.seat_id)) return ss.seat || ss.seat_id;
        if (p && (p.seat || p.seat_id || p.selectedSeat)) {
          if (typeof p.seat === 'string') return p.seat;
          if (p.seat && (p.seat.label || p.seat.code || p.seat.name || p.seat.id)) return p.seat.label || p.seat.code || p.seat.name || p.seat.id;
          if (p.selectedSeat) return p.selectedSeat;
          if (p.seat_id) return p.seat_id;
        }
        if (p && p.ticket && (p.ticket.seat || p.ticket.seat_id)) return p.ticket.seat || p.ticket.seat_id;
      }
      return null;
    })();
    const seatFromLayoutSource = (source) => {
      if (!source) return null;
      try {
        const itemsArr = Array.isArray(source.items) ? source.items : [];
        for (const it of itemsArr) {
          const segs = Array.isArray(it && it.segments) ? it.segments : [];
          for (const seg of segs) {
            const layout = seg && seg.vehicle && seg.vehicle.layout;
            const cells = Array.isArray(layout && layout.cells) ? layout.cells : [];
            for (const cell of cells) {
              if (!cell) continue;
              if (cell.type === 'seat' && cell.availability === false && cell.display_name) {
                return cell.display_name;
              }
            }
          }
        }
        const tripsObj = source.trips && typeof source.trips === 'object' ? source.trips : null;
        if (tripsObj) {
          const tripsArr = Object.values(tripsObj);
          for (const trip of tripsArr) {
            const segs = Array.isArray(trip && trip.segments) ? trip.segments : [];
            for (const seg of segs) {
              const layout = seg && seg.vehicle && seg.vehicle.layout;
              const cells = Array.isArray(layout && layout.cells) ? layout.cells : [];
              for (const cell of cells) {
                if (!cell) continue;
                if (cell.type === 'seat' && cell.availability === false && cell.display_name) {
                  return cell.display_name;
                }
              }
            }
          }
        }
      } catch (_) {}
      return null;
    };
    const seatFromPD = (() => {
      const pd = cart.passengerDetails && cart.passengerDetails.busbudResponse;
      if (!pd) return null;
      const fromLayout = seatFromLayoutSource(pd);
      if (fromLayout) return fromLayout;
      const collections = [pd.items, pd.tickets, pd.segments, pd.passengers];
      for (const col of collections) {
        if (!Array.isArray(col)) continue;
        for (const it of col) {
          if (!it) continue;
          if (it.seat && typeof it.seat === 'string') return it.seat;
          if (it.seat && typeof it.seat.id === 'string') return it.seat.id;
          if (it.seat_id) return it.seat_id;
          if (it.selected_seats && it.selected_seats[0] && (it.selected_seats[0].seat || it.selected_seats[0].seat_id)) return it.selected_seats[0].seat || it.selected_seats[0].seat_id;
        }
      }
      return null;
    })();
    const seatFromBB = (() => {
      const bb = cart.busbudResponse || {};
      const fromLayout = seatFromLayoutSource(bb);
      if (fromLayout) return fromLayout;
      const collections = [bb.items, bb.tickets, bb.segments, bb.passengers];
      for (const col of collections) {
        if (!Array.isArray(col)) continue;
        for (const it of col) {
          if (!it) continue;
          if (it.seat && typeof it.seat === 'string') return it.seat;
          if (it.seat && typeof it.seat.id === 'string') return it.seat.id;
          if (it.seat_id) return it.seat_id;
          if (it.selected_seats && it.selected_seats[0] && (it.selected_seats[0].seat || it.selected_seats[0].seat_id)) return it.selected_seats[0].seat || it.selected_seats[0].seat_id;
        }
      }
      return null;
    })();
    const seatNo = seatFromPassengers || seatFromPD || seatFromBB || (cart.seat && typeof cart.seat === 'string' ? cart.seat : null) || (Array.isArray(cart.seats) && cart.seats.length ? cart.seats.join(', ') : null) || cart.seatNumber || '—';

    const passengerName = (firstPassenger && [firstPassenger.first_name || firstPassenger.firstName, firstPassenger.last_name || firstPassenger.lastName].filter(Boolean).join(' ')) || null;

    const mobileNo = purchaser.phone || purchaser.phoneNumber || (cart.contact_info && cart.contact_info.phone) || (cart.contactInfo && cart.contactInfo.phone) || (firstPassenger && (firstPassenger.phone || firstPassenger.phoneNumber)) || '—';
    const passportId = (() => {
      const p = firstPassenger || {};
      const direct = p.idNumber || p.id_number || p.id_no || p.id || p.passport || p.passport_number || p.nationalId || p.national_id || p.documentNumber || p.document_no;
      if (direct) return direct;
      if (Array.isArray(p.documents) && p.documents.length) {
        const doc = p.documents.find(d => d && (d.number || d.value || d.id));
        if (doc) return doc.number || doc.value || doc.id;
      }
      const pr = purchaser || {};
      const ci = cart.contact_info || cart.contactInfo || {};
      return pr.idNumber || pr.id_number || pr.id_no || pr.passport || pr.passport_number || pr.nationalId || pr.national_id || pr.documentNumber || pr.document_no ||
             ci.idNumber || ci.id_number || ci.id_no || ci.passport || ci.passport_number || ci.nationalId || ci.national_id || ci.documentNumber || ci.document_no || '—';
    })();
    const babyOnLap = cart.babyOnLap ? 'YES' : 'NO';
    const operatorName =
      (cart.trip && cart.trip.operator && (cart.trip.operator.name || cart.trip.operator.operator_name)) ||
      (cart.tripDetails && cart.tripDetails.operator) ||
      (cart.operator && cart.operator.name) ||
      (outboundSeg && outboundSeg.operator && (outboundSeg.operator.name || outboundSeg.operator.xid)) ||
      '—';
    // Always show booking source as 'online' on the e-ticket
    const bookedBy = 'online';
    const bookingSource = cart.bookingSource || 'Online';

    const normalizeTs = (ts) => {
      try {
        if (!ts) return null;
        if (typeof ts === 'string') return new Date(ts);
        if (ts._seconds) return new Date(ts._seconds * 1000 + (ts._nanoseconds || 0) / 1e6);
        if (ts.seconds) return new Date(ts.seconds * 1000);
        if (typeof ts.toDate === 'function') return ts.toDate();
        if (ts instanceof Date) return ts;
        return null;
      } catch (_) { return null; }
    };
    const rawTs = (completePurchase && (completePurchase.completed_at || completePurchase.completedAt || completePurchase.created_at || completePurchase.createdAt)) ||
                  cart.bookingTimestamp || cart.createdAt || cart.updatedAt || new Date();
    const tsDate = normalizeTs(rawTs) || new Date();
    const bookingTimestamp = `${tsDate.getFullYear()}-${fmt2(tsDate.getMonth()+1)}-${fmt2(tsDate.getDate())} ${fmt2(tsDate.getHours())}:${fmt2(tsDate.getMinutes())}:${fmt2(tsDate.getSeconds())}`;

    const priceNumber = (() => {
      // 0) If the frontend has already stored an adjusted total on the cart,
      // always prefer that so the e-ticket matches the UI exactly.
      if (typeof cart.totalAmount === 'number') return cart.totalAmount;
      if (typeof cart.totalAmount === 'string' && cart.totalAmount.trim()) {
        const m = String(cart.totalAmount).match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }

      if (cart.invoice) {
        const inv = cart.invoice;
        if (typeof inv.amount_total === 'number') return inv.amount_total;
        if (typeof inv.amount_total === 'string') {
          const m = inv.amount_total.match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) return parseFloat(m[0]);
        }
        if (typeof inv.amount_untaxed === 'number') return inv.amount_untaxed;
        if (typeof inv.amount_untaxed === 'string') {
          const m = inv.amount_untaxed.match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) return parseFloat(m[0]);
        }
        if (typeof inv.total === 'number') return inv.total;
        if (typeof inv.total === 'string') {
          const m = inv.total.match(/[0-9]+(?:\.[0-9]+)?/);
          if (m) return parseFloat(m[0]);
        }
      }
      // Detect preferred currency for adjustments
      const prefCur = (() => {
        const cp = completePurchase;
        if (cp) {
          if (cp.charges && cp.charges.currency) return cp.charges.currency;
          const cpItem0 = Array.isArray(cp.items) && cp.items[0];
          if (cpItem0 && cpItem0.display_price && cpItem0.display_price.currency) return cpItem0.display_price.currency;
          if (cp.trips) {
            try {
              const anyTrip = Object.values(cp.trips)[0];
              if (anyTrip && Array.isArray(anyTrip.prices) && anyTrip.prices[0]) {
                const p0 = anyTrip.prices[0];
                if (p0.prices && p0.prices.currency) return p0.prices.currency;
                if (p0.details && p0.details.public_price_group && p0.details.public_price_group.prices && p0.details.public_price_group.prices.currency) return p0.details.public_price_group.prices.currency;
              }
            } catch (_) { /* noop */ }
          }
        }
        if (cart.summary && cart.summary.currency) return cart.summary.currency;
        if (cart.apiMetadata && cart.apiMetadata.currency) return cart.apiMetadata.currency;
        if (cart.trip && cart.trip.currency) return cart.trip.currency;
        return 'USD';
      })();
      const adjust = (base, cur) => {
        const b = typeof base === 'number' ? base : parseFloat(String(base).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN');
        if (isNaN(b)) return null;
        try {
          const adj = applyPriceAdjustments(b, { currency: cur || prefCur, returnMetadata: true });
          if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
        } catch (_) { /* noop */ }
        return b;
      };
      // Prefer completePurchase totals
      const cp = completePurchase;
      if (cp) {
        if (cp.charges) {
          const ch = cp.charges;
          if (ch.amount != null) {
            const v = adjust(ch.amount / 100, ch.currency);
            if (v != null) return v;
          }
          if (ch.subtotal != null) {
            const v = adjust(ch.subtotal / 100, ch.currency);
            if (v != null) return v;
          }
          if (ch.total != null) {
            const v = adjust(ch.total / 100, ch.currency);
            if (v != null) return v;
          }
        }
        const cpItem = Array.isArray(cp.items) && cp.items.length ? cp.items[0] : null;
        if (cpItem && cpItem.display_price) {
          const dp = cpItem.display_price;
          if (dp.amount != null) {
            const v = adjust(dp.amount / 100, dp.currency);
            if (v != null) return v;
          }
          if (dp.total != null) {
            const v = adjust(dp.total / 100, dp.currency);
            if (v != null) return v;
          }
        }
        if (cp.trips) {
          try {
            const tripsArr = Object.values(cp.trips);
            for (const t of tripsArr) {
              if (!t) continue;
              if (Array.isArray(t.prices) && t.prices.length) {
                const p0 = t.prices[0];
                if (p0 && p0.prices) {
                  const cur = p0.prices.currency;
                  if (p0.prices.total != null) {
                    const v = adjust(p0.prices.total / 100, cur);
                    if (v != null) return v;
                  }
                }
                const ppg = p0 && p0.details && p0.details.public_price_group && p0.details.public_price_group.prices;
                if (ppg) {
                  const cur = ppg.currency;
                  if (ppg.total != null) {
                    const v = adjust(ppg.total / 100, cur);
                    if (v != null) return v;
                  }
                }
              }
            }
          } catch (_) { /* noop */ }
        }
      }
      const pdOrig = cart.passengerDetails && cart.passengerDetails.busbudResponse && (cart.passengerDetails.busbudResponse.original_charges || (cart.passengerDetails.busbudResponse.adjusted_charges && cart.passengerDetails.busbudResponse.adjusted_charges.metadata && cart.passengerDetails.busbudResponse.adjusted_charges.metadata.original_charges));
      if (pdOrig && typeof pdOrig.total === 'number') {
        const base = pdOrig.total / 100;
        const adj = applyPriceAdjustments(base, { currency: pdOrig.currency || 'USD', returnMetadata: true });
        if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
        return base;
      }
      if (pdOrig && typeof pdOrig.total === 'string') {
        const m = pdOrig.total.match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) {
          const baseCents = parseFloat(m[0]);
          const base = baseCents / 100;
          const adj = applyPriceAdjustments(base, { currency: pdOrig.currency || 'USD', returnMetadata: true });
          if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
          return base;
        }
      }
      const pdChargesFlat = cart.passengerDetails && cart.passengerDetails.busbudResponse && cart.passengerDetails.busbudResponse.charges;
      if (pdChargesFlat) {
        if (pdChargesFlat.total != null) {
          const v = adjust(pdChargesFlat.total, pdChargesFlat.currency);
          if (v != null) return v;
        }
      }
      if (cart.invoice_data && typeof cart.invoice_data.amount_total === 'number') return cart.invoice_data.amount_total;
      if (cart.invoice_data && typeof cart.invoice_data.amount_total === 'string') {
        const m = cart.invoice_data.amount_total.match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }
      if (typeof cart.totalPrice === 'number') return cart.totalPrice;
      if (typeof cart.total === 'number') return cart.total;
      if (cart.tripDetails && typeof cart.tripDetails.price === 'number') return cart.tripDetails.price;
      if (cart.tripDetails && typeof cart.tripDetails.price_total === 'number') return cart.tripDetails.price_total;
      if (typeof cart.finalTotal === 'number') return cart.finalTotal;
      if (typeof cart.final_total === 'number') return cart.final_total;
      if (typeof cart.totalPrice === 'string' && cart.totalPrice.trim()) {
        const m = String(cart.totalPrice).match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }
      if (typeof cart.total === 'string' && cart.total.trim()) {
        const m = String(cart.total).match(/[0-9]+(?:\.[0-9]+)?/);
        if (m) return parseFloat(m[0]);
      }
      if (cart.price && (typeof cart.price.total === 'number' || typeof cart.price.total === 'string')) {
        const v = adjust(cart.price.total);
        if (v != null) return v;
      }
      const pdCharges = cart.passengerDetails && cart.passengerDetails.busbudResponse && cart.passengerDetails.busbudResponse.adjusted_charges;
      if (pdCharges && typeof pdCharges.total === 'number') return pdCharges.total / 100;
      const bbAdj = cart.busbudResponse && cart.busbudResponse.adjusted_charges;
      if (bbAdj && typeof bbAdj.total === 'number') return bbAdj.total / 100;
      const bbOrig = cart.busbudResponse && cart.busbudResponse.original_charges;
      if (bbOrig && typeof bbOrig.total === 'number') {
        const base = bbOrig.total / 100;
        const adj = applyPriceAdjustments(base, { currency: bbOrig.currency || 'USD', returnMetadata: true });
        if (adj && typeof adj.adjustedAmount === 'number') return adj.adjustedAmount;
        return base;
      }
      const bbCharges = cart.busbudResponse && cart.busbudResponse.charges;
      if (bbCharges && typeof bbCharges.total === 'number') return bbCharges.total;
      const fare0 = cart.busbudResponse && cart.busbudResponse.fares && cart.busbudResponse.fares[0];
      const fAmtRaw = fare0 && (fare0.price && fare0.price.total && (fare0.price.total.amount || fare0.price.total) || fare0.total_price && (fare0.total_price.amount || fare0.total_price) || fare0.amount || fare0.price);
      if (fAmtRaw != null) {
        const v = adjust(fAmtRaw, (fare0 && fare0.price && fare0.price.currency) || (fare0 && fare0.total_price && fare0.total_price.currency));
        if (v != null) return v;
      }
      return null;
    })();
    const priceText = priceNumber != null ? Number(priceNumber).toFixed(2) : '—';
    const paymentMethod = cart.paymentMethod || 'Online';
    const contactInfo = cart.contactPhone || (cart.contact_info && cart.contact_info.phone) || process.env.SUPPORT_PHONE || '—';

    let attachments = [];
    const logoCid = 'ntg-logo-main@national-tickets';
    let logoImgTag = '';
    try {
      const defaultLogoPath = 'C:/Users/Taonga/Documents/work/GitHub/New folder/Uniglade/frontend/public/natticks-logo1.jpeg';
      const logoPath = process.env.ETICKET_LOGO_PATH || defaultLogoPath;
      if (logoPath) {
        const logoBuffer = fs.readFileSync(logoPath);
        attachments.push({
          filename: 'natticks-logo1.jpeg',
          content: logoBuffer,
          contentType: 'image/jpeg',
          cid: logoCid
        });
        logoImgTag = `<div style="height:72px;display:flex;align-items:center;justify-content:center;width:100%;">
          <img src="cid:${logoCid}" alt="National Tickets Global" style="max-height:64px;max-width:340px;width:auto;display:block;object-fit:contain;" />
        </div>`;
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to load logo for e-ticket`, { error: e.message });
    }
    try {
      const passengersList = (() => {
        const cp = completePurchase;
        // Use only completePurchase items as the passenger source
        const fromRequired = Array.isArray(cart.requiredPassengers) ? cart.requiredPassengers : [];
        const fromSelected = !fromRequired.length && Array.isArray(cart.selectedPassengers) ? cart.selectedPassengers : [];
        const fromCP = (() => {
          if (!cp || !Array.isArray(cp.items)) return [];
          const out = [];
          for (const it of cp.items) {
            if (it && it.passenger) out.push(it.passenger);
          }
          return out;
        })();
        const candidates = [fromRequired, fromSelected, fromCP].filter(arr => Array.isArray(arr) && arr.length);
        const source = candidates.length ? candidates[0] : [];
        if (!source.length) {
          logger.warn(`[${requestId}] No passengers found for e-ticket email`, { pnr, cartId });
          return [];
        }
        const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
        const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
        const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
        const docNo = (p = {}) => {
          if (p.idNumber || p.id_number || p.id_no) return p.idNumber || p.id_number || p.id_no;
          if (p.passport || p.passport_number) return p.passport || p.passport_number;
          if (p.documentNumber || p.document_no) return p.documentNumber || p.document_no;
          if (Array.isArray(p.documents)) {
            const d = p.documents.find(d => d && (d.number || d.value || d.id));
            if (d) return d.number || d.value || d.id;
          }
          return '';
        };
        const seatRaw = (p = {}) => {
          const ss = p && p.selected_seats && p.selected_seats[0];
          if (ss) {
            if (typeof ss.seat === 'string') return ss.seat;
            if (ss.seat && (ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id)) return ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id;
            if (ss.seat_id) return ss.seat_id;
          }
          if (p && (p.seat || p.seat_id || p.selectedSeat)) {
            if (typeof p.seat === 'string') return p.seat;
            if (p.seat && (p.seat.label || p.seat.code || p.seat.name || p.seat.id)) return p.seat.label || p.seat.code || p.seat.name || p.seat.id;
            if (p.selectedSeat) return p.selectedSeat;
            if (p.seat_id) return p.seat_id;
          }
          if (p && p.ticket && (p.ticket.seat || p.ticket.seat_id)) return p.ticket.seat || p.ticket.seat_id;
          return '';
        };
        const phoneRaw = (p = {}) => p.phone || p.phoneNumber || '';
        const keyFor = (p = {}) => {
          const parts = [firstName(p), lastName(p), docNo(p), seatRaw(p), phoneRaw(p)].map(normalize).filter(Boolean);
          return parts.join('|');
        };
        const uniq = [];
        const seen = new Set();
        for (const px of source) {
          const k = keyFor(px);
          if (!k) { uniq.push(px); continue; }
          if (seen.has(k)) continue;
          seen.add(k);
          uniq.push(px);
        }
        return uniq;
      })();
      const nameFor = (p = {}) => ([
        p.first_name || p.firstName || p.given_name || p.givenName || p.name_first,
        p.last_name || p.lastName || p.family_name || p.familyName || p.name_last
      ].filter(Boolean).join(' '));
      const seatFor = (p = {}) => {
        const ss = p && p.selected_seats && p.selected_seats[0];
        if (ss) {
          if (typeof ss.seat === 'string') return ss.seat;
          if (ss.seat && (ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id)) return ss.seat.label || ss.seat.code || ss.seat.name || ss.seat.id;
          if (ss.seat_id) return ss.seat_id;
        }
        if (p && (p.seat || p.seat_id || p.selectedSeat)) {
          if (typeof p.seat === 'string') return p.seat;
          if (p.seat && (p.seat.label || p.seat.code || p.seat.name || p.seat.id)) return p.seat.label || p.seat.code || p.seat.name || p.seat.id;
          if (p.selectedSeat) return p.selectedSeat;
          if (p.seat_id) return p.seat_id;
        }
        if (p && p.ticket && (p.ticket.seat || p.ticket.seat_id)) return p.ticket.seat || p.ticket.seat_id;
        return seatFromPD || seatFromBB || '—';
      };
      const idFor = (p = {}) => {
        const direct = p.idNumber || p.id_number || p.id_no || p.passport || p.passport_number || p.nationalId || p.national_id || p.documentNumber || p.document_no;
        if (direct) return direct;
        if (Array.isArray(p.documents) && p.documents.length) {
          const doc = p.documents.find(d => d && (d.number || d.value || d.id));
          if (doc) return doc.number || doc.value || doc.id;
        }
        const pr = purchaser || {};
        const ci = cart.contact_info || cart.contactInfo || {};
        return pr.idNumber || pr.id_number || pr.id_no || pr.passport || pr.passport_number || pr.nationalId || pr.national_id || pr.documentNumber || pr.document_no ||
               ci.idNumber || ci.id_number || ci.id_no || ci.passport || ci.passport_number || ci.nationalId || ci.national_id || ci.documentNumber || ci.document_no || '—';
      };
      const phoneFor = (p = {}) => p.phone || p.phoneNumber || (cart.contact_info && cart.contact_info.phone) || (cart.contactInfo && cart.contactInfo.phone) || (purchaser && (purchaser.phone || purchaser.phoneNumber)) || '—';
      const expectedCount = (() => {
        const rpLen = Array.isArray(cart.requiredPassengers) ? cart.requiredPassengers.length : 0;
        if (rpLen > 0) return rpLen;
        const spLen = Array.isArray(cart.selectedPassengers) ? cart.selectedPassengers.length : 0;
        if (spLen > 0) return spLen;
        const cpLocal = cart.passengerDetails && cart.passengerDetails.completePurchase;
        if (cpLocal && Array.isArray(cpLocal.items) && cpLocal.items.length) return cpLocal.items.length;
        if (Array.isArray(passengersList) && passengersList.length) return passengersList.length;
        return null;
      })();
      const baseList = passengersList.length ? passengersList : (firstPassenger ? [firstPassenger] : []);
      const list = expectedCount ? baseList.slice(0, expectedCount) : baseList;
      if (!Array.isArray(list) || list.length === 0) {
        logger.warn(`[${requestId}] No passenger list resolved for e-ticket; sending fallback email`, { pnr, cartId });
        const fallbackHtml = `<div><h2>${purchaserName ? `Hi ${purchaserName},` : 'Hello,'}</h2><p>Your purchase has been completed successfully and your e-ticket is ready.</p><p><strong>PNR:</strong> ${pnr}</p><p><strong>Cart ID:</strong> ${cartId}</p><p>You can download your e-ticket here: <a href="${downloadLink}">Download e-ticket</a></p></div>`;
        await sendEmail({
          to: purchaserEmail,
          subject: `Your E-ticket is ready${cart.bookingRef ? ` - Ref ${cart.bookingRef}` : ''}`,
          html: fallbackHtml
        });
        const responseTime = Date.now() - startTime;
        logger.info(`🎫 [${requestId}] E-ticket fallback email sent`, { pnr, to: purchaserEmail, cartId, responseTime: `${responseTime}ms` });
        return res.json({
          success: true,
          pnr,
          cartId,
          sentTo: purchaserEmail,
          requestId,
          timestamp: new Date().toISOString()
        });
      }
      const toNumSimple = (v) => (typeof v === 'number') ? v : (typeof v === 'string' ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN') : NaN);
      const invoiceTotal = (() => {
        const a = toNumSimple(cart.invoice && cart.invoice.amount_total);
        if (Number.isFinite(a)) return a;
        const b = toNumSimple(cart.invoice_data && cart.invoice_data.amount_total);
        if (Number.isFinite(b)) return b;
        const c = toNumSimple(cart.invoice && cart.invoice.total);
        if (Number.isFinite(c)) return c;
        const d = toNumSimple(cart.invoice && cart.invoice.amount_untaxed);
        if (Number.isFinite(d)) return d;
        return NaN;
      })();
      const totalForDivision = (priceNumber != null && Number.isFinite(Number(priceNumber)))
        ? Number(priceNumber)
        : (Number.isFinite(invoiceTotal)
          ? invoiceTotal
          : (Number.isFinite(toNumSimple(cart.totalPrice)) ? toNumSimple(cart.totalPrice)
          : (Number.isFinite(toNumSimple(cart.total)) ? toNumSimple(cart.total) : 0)));
      const passengerCount = list.length || 1;
      const perPassengerPrice = Number(totalForDivision / passengerCount);
      const perPassengerPriceText = perPassengerPrice.toFixed(2);
      const perCardPrice = hasReturnLeg ? perPassengerPrice / 2 : perPassengerPrice;
      const perCardPriceText = perCardPrice.toFixed(2);
      let cardsHtml = '';
      list.forEach((p, idx) => {
        const pName = nameFor(p) || bookedBy || purchaserName || '—';
        const pSeat = seatFor(p);
        const pPhone = phoneFor(p);
        const pId = idFor(p);
        const unitPriceText = perCardPriceText;
        const qrPayloadObj = { pnr, cartId, purchaseId, purchaseUuid, passenger: { index: idx + 1, name: pName, seat: pSeat } };
        const pngBuffer = qr.imageSync(JSON.stringify(qrPayloadObj), { type: 'png' });
        const qrCid = `qr-${cartId}-${idx + 1}-${Date.now()}@national-tickets`;
        attachments.push({ filename: `eticket-${cartId}-${idx + 1}.png`, content: pngBuffer, contentType: 'image/png', cid: qrCid });
        const apiBase = process.env.PUBLIC_API_BASE_URL || process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
        const viewUrl = `${apiBase}/api/ticket/eticket/print?pnr=${encodeURIComponent(pnr)}&idx=${idx + 1}`;

        const buildCardHtml = (
          legLabel,
          segOrigin,
          segDestination,
          segDepartCityTime,
          segArriveCityTime,
          segDepartDateTime,
          segArriveDateTime
        ) => `
          <div style="max-width:420px;width:100%;background:#ffffff;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.08);overflow:hidden;border:1px solid #e5e7eb;margin-bottom:16px;">
            <div style="padding:24px;">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                ${logoImgTag || `<div style=\"height:48px;width:48px;border-radius:10px;background:#ede9fe;display:flex;align-items:center;justify-content:center;color:#7c3aed;font-weight:800;font-size:24px;\">J</div>`}
              </div>

              <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:#f7e9ff;border:1px solid #7B1FA2;border-radius:8px;">
                <div style="height:32px;width:32px;border-radius:9999px;background:#7B1FA2;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;">✓</div>
                <div>
                  <div style="font-weight:800;color:#7B1FA2;">${legLabel ? legLabel.toUpperCase() + ' ' : ''}TICKET CONFIRMED</div>
                  <div style="font-size:12px;color:#7B1FA2;">Your ticket has been booked.</div>
                </div>
              </div>

              <hr style="margin:16px 0;border:0;border-top:1px dashed #e5e7eb;" />

              <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;font-size:14px;color:#1f2937;">
                <tbody>
                  <tr><td style="padding:2px 0;color:#6b7280;width:38%">Ref No:</td><td style="padding:2px 0;font-weight:700;">${refNo}</td></tr>
                  <tr><td style="padding:2px 0;color:#6b7280;">Ticket No:</td><td style="padding:2px 0;font-weight:700;">${ticketNo}</td></tr>
                  <tr><td style="padding:2px 0;color:#6b7280;">Seat No:</td><td style="padding:2px 0;font-weight:700;">${pSeat}</td></tr>
                  <tr><td style="padding:2px 0;color:#6b7280;">Name:</td><td style="padding:2px 0;font-weight:700;">${pName}</td></tr>
                  <tr><td style="padding:2px 0;color:#6b7280;">Mobile No:</td><td style="padding:2px 0;font-weight:700;">${pPhone}</td></tr>
                  <tr><td style="padding:2px 0;color:#6b7280;">Passport/ID No:</td><td style="padding:2px 0;font-weight:700;">${pId}</td></tr>
                  <tr><td style="padding:2px 0;color:#6b7280;">Baby On Lap:</td><td style="padding:2px 0;font-weight:700;">${babyOnLap}</td></tr>
                  <tr><td style="padding:2px 0;color:#6b7280;">Operator Name:</td><td style="padding:2px 0;font-weight:700;">${operatorName}</td></tr>
                </tbody>
              </table>

              <div style="border:1px solid #d1d5db;padding:12px;margin:16px 0;border-radius:6px;">
                <div style="font-weight:800;font-size:16px;color:#1f2937;">Depart: ${segOrigin}</div>
                <div style="color:#4b5563;font-size:13px;margin-top:2px;">${segDepartCityTime}</div>
                <div style="font-weight:700;color:#1f2937;margin-top:2px;">${segDepartDateTime}</div>
                <div style="font-size:12px;color:#6b7280;margin-top:6px;">Checkin 1 Hour before Departure</div>
              </div>

              <div style="border:1px solid #d1d5db;padding:12px;margin:16px 0;border-radius:6px;">
                <div style="font-weight:800;font-size:16px;color:#1f2937;">Arrive: ${segDestination}</div>
                <div style="color:#4b5563;font-size:13px;margin-top:2px;">${segArriveCityTime}</div>
                <div style="font-weight:700;color:#1f2937;margin-top:2px;">${segArriveDateTime}</div>
              </div>

              <div style="font-size:12px;color:#6b7280;">
                <div>Booked By: <span style="font-weight:600;color:#1f2937;">${bookedBy}</span> <span style="font-weight:600;color:#1f2937;">${bookingSource}</span></div>
                <div>${bookingTimestamp}</div>
              </div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                <tr>
                  <td style="vertical-align:bottom;">
                    <div style="font-weight:800;font-size:18px;color:#1f2937;">Price: $${unitPriceText}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:2px;">[${paymentMethod}]</div>
                  </td>
                  <td style="vertical-align:bottom;text-align:right;width:150px;">
                    <img src="cid:${qrCid}" alt="QR Code" width="120" height="120" style="display:block;border:0;outline:none;text-decoration:none;border-radius:4px;margin-left:auto;" />
                  </td>
                </tr>
              </table>

              <div style="margin-top:16px;text-align:center;">
                <a href="${viewUrl}" style="display:inline-block;background:#111827;color:#ffffff;font-weight:700;text-decoration:none;padding:10px 14px;border-radius:8px;">View/Print Ticket</a>
              </div>
            </div>

            <div style="background:#f9fafb;padding:14px;text-align:center;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;">
              <div>Terms & Conditions Apply</div>
              <div>For Info Call ${contactInfo}</div>  
            </div>
          </div>`;

        // Outbound card
        cardsHtml += buildCardHtml(
          hasReturnLeg ? 'Outbound' : '',
          origin,
          destination,
          departCityTime,
          arriveCityTime,
          departDateTime,
          arriveDateTime
        );

        // Return card (for round trips)
        if (hasReturnLeg && returnOrigin && returnDestination && returnDepartCityTime && returnArriveCityTime && returnDepartDateTime && returnArriveDateTime) {
          cardsHtml += buildCardHtml(
            'Return',
            returnOrigin,
            returnDestination,
            returnDepartCityTime,
            returnArriveCityTime,
            returnDepartDateTime,
            returnArriveDateTime
          );
        }
      });
      const html = `
      <div style="width:100%;background:#f6f7fb;padding:24px 12px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="width:100%;max-width:520px;">
          <tbody>
            <tr>
              <td align="center" style="padding:0;margin:0;">
                ${cardsHtml}
              </td>
            </tr>
          </tbody>
        </table>
      </div>`;
      await sendEmail({
        to: purchaserEmail,
        subject: `Your E-ticket is ready${cart.bookingRef ? ` - Ref ${cart.bookingRef}` : ''}`,
        html,
        attachments
      });
    } catch (e) {
      logger.warn(`[${requestId}] QR generation failed`, { error: e.message });
      const fallbackHtml = `<div><h2>${purchaserName ? `Hi ${purchaserName},` : 'Hello,'}</h2><p>Your purchase has been completed successfully and your e-ticket is ready.</p><p><strong>PNR:</strong> ${pnr}</p><p><strong>Cart ID:</strong> ${cartId}</p><p>You can download your e-ticket here: <a href="${downloadLink}">Download e-ticket</a></p></div>`;
      await sendEmail({ to: purchaserEmail, subject: `Your E-ticket is ready${cart.bookingRef ? ` - Ref ${cart.bookingRef}` : ''}`, html: fallbackHtml });
    }

    const responseTime = Date.now() - startTime;
    logger.info(`🎫 [${requestId}] E-ticket email sent`, { pnr, to: purchaserEmail, cartId, responseTime: `${responseTime}ms` });

    return res.json({
      success: true,
      pnr,
      cartId,
      sentTo: purchaserEmail,
      requestId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error(`❌ [${requestId}] E-ticket send error`, { message: error.message, stack: error.stack, responseTime: `${responseTime}ms` });
    return res.status(500).json({
      success: false,
      error: { message: error.message, type: 'ETICKET_EMAIL_ERROR' },
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// ================================
// 🖨️ VIEW/PRINT SINGLE E-TICKET (PER PASSENGER)
// ================================
// GET /api/ticket/eticket/print?pnr=...&idx=1
router.get(
  '/eticket/print',
  [
    query('pnr').optional().isString().trim().isLength({ min: 1 }).withMessage('pnr must be a non-empty string'),
    query('idx').optional().isInt({ min: 1 }).withMessage('idx must be a positive integer')
  ],
  async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  try {
    const v = validationResult(req);
    if (!v.isEmpty()) {
      return res.status(400).send('Invalid parameters');
    }
    const q = req.query || {};
    const pnr = q.pnr || q.reference || q.firestorecartid || q.cartid || q.cart_id;
    const idx = parseInt(q.idx || q.index || '1', 10);
    if (!pnr || Number.isNaN(idx) || idx < 1) {
      return res.status(400).send('Missing or invalid parameters');
    }

    const db = await getFirestore();
    const doc = await db.collection('carts').doc(pnr).get();
    if (!doc.exists) {
      return res.status(404).send('Ticket not found');
    }

    const cart = doc.data() || {};

    let logoBase64 = '';
    try {
      const defaultLogoPath = 'C:/Users/Taonga/Documents/work/GitHub/New folder/Uniglade/frontend/public/natticks-logo1.jpeg';
      const logoPath = process.env.ETICKET_LOGO_PATH || defaultLogoPath;
      if (logoPath) {
        const logoBuffer = fs.readFileSync(logoPath);
        logoBase64 = logoBuffer.toString('base64');
      }
    } catch (e) {
      logger.warn(`[${requestId}] Failed to load logo for print e-ticket`, { error: e.message });
    }

    // Extract trip details (similar to /eticket/send)
    const segments = (cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || [];
    const firstSeg = Array.isArray(segments) && segments[0] ? segments[0] : null;
    let origin = 'Unknown';
    let destination = 'Unknown';
    let departTs = null;
    let arriveTs = null;
    if (firstSeg) {
      origin = (firstSeg.origin && (firstSeg.origin.city && firstSeg.origin.city.name)) || (firstSeg.origin && firstSeg.origin.name) || origin;
      destination = (firstSeg.destination && (firstSeg.destination.city && firstSeg.destination.city.name)) || (firstSeg.destination && firstSeg.destination.name) || destination;
      const dts = (firstSeg.departure_time && (firstSeg.departure_time.timestamp || firstSeg.departure_time)) || (firstSeg.departure && firstSeg.departure.timestamp) || null;
      const ats = (firstSeg.arrival_time && (firstSeg.arrival_time.timestamp || firstSeg.arrival_time)) || (firstSeg.arrival && firstSeg.arrival.timestamp) || null;
      departTs = dts ? new Date(dts) : null;
      arriveTs = ats ? new Date(ats) : null;
    } else if (cart.tripDetails) {
      origin = cart.tripDetails.originCity || cart.tripDetails.origin || origin;
      destination = cart.tripDetails.destinationCity || cart.tripDetails.destination || destination;
      departTs = cart.tripDetails.departureTime ? new Date(cart.tripDetails.departureTime) : null;
      arriveTs = cart.tripDetails.arrivalTime ? new Date(cart.tripDetails.arrivalTime) : null;
    }

    const fmt2 = (n) => String(n).padStart(2, '0');
    const fmtDate = (d) => `${fmt2(d.getDate())}/${fmt2(d.getMonth() + 1)}/${d.getFullYear()}`;
    const fmtTime = (d) => `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;

    const departDate = departTs ? fmtDate(departTs) : '—';
    const departTime = departTs ? fmtTime(departTs) : '—';
    const arriveDate = arriveTs ? fmtDate(arriveTs) : '—';
    const arriveTime = arriveTs ? fmtTime(arriveTs) : '—';

    const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};

    // Build passengers list and pick requested passenger (1-based index)
    const passengersList = (() => {
      const a = Array.isArray(cart.passengers) ? cart.passengers : [];
      const b = cart.passengerDetails && Array.isArray(cart.passengerDetails.passengers) ? cart.passengerDetails.passengers : [];
      const c = cart.trip && Array.isArray(cart.trip.passengers) ? cart.trip.passengers : [];
      const e = cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) ? cart.busbudResponse.passengers : [];
      const cp = cart.passengerDetails && cart.passengerDetails.completePurchase;
      const fromCP = (() => {
        if (!cp || !Array.isArray(cp.items)) return [];
        const out = [];
        for (const it of cp.items) {
          if (it && it.passenger) out.push(it.passenger);
        }
        return out;
      })();
      const candidates = [fromCP, c, b, a, e].filter(arr => Array.isArray(arr) && arr.length);
      const source = candidates.length ? candidates[0] : [];
      if (!source.length) return [];
      const normalize = (s) => typeof s === 'string' ? s.trim().toLowerCase() : (s == null ? '' : String(s).trim().toLowerCase());
      const firstName = (p = {}) => p.first_name || p.firstName || p.given_name || p.givenName || p.name_first || '';
      const lastName = (p = {}) => p.last_name || p.lastName || p.family_name || p.familyName || p.name_last || '';
      const docNo = (p = {}) => {
        // Prefer explicit passenger.id from completePurchase (allow 0 as valid)
        if (p.id !== undefined && p.id !== null) return String(p.id);
        if (p.idNumber || p.id_number || p.id_no) return p.idNumber || p.id_number || p.id_no;
        if (p.passport || p.passport_number) return p.passport || p.passport_number;
        if (p.documentNumber || p.document_no) return p.documentNumber || p.document_no;
        if (Array.isArray(p.documents)) {
          const d = p.documents.find(d => d && (d.number || d.value || d.id));
          if (d) return d.number || d.value || d.id;
        }
        return '';
      };
      const seatRaw = (p = {}) => {
        const ss = p && p.selected_seats && p.selected_seats[0];
        if (ss && (ss.seat_id || ss.seat)) return ss.seat_id || ss.seat;
        if (p && (p.seat_id || p.seat || p.selectedSeat)) {
          if (p.seat_id) return p.seat_id;
          if (typeof p.seat === 'string') return p.seat;
          if (p.seat && (p.seat.id || p.seat.code)) return p.seat.id || p.seat.code;
          if (p.selectedSeat) return p.selectedSeat;
        }
        if (p && p.ticket && (p.ticket.seat_id || p.ticket.seat)) return p.ticket.seat_id || p.ticket.seat;
        return '';
      };
      const phoneRaw = (p = {}) => p.phone || p.phoneNumber || '';
      const keyFor = (p = {}) => {
        const parts = [firstName(p), lastName(p), docNo(p), seatRaw(p), phoneRaw(p)].map(normalize).filter(Boolean);
        return parts.join('|');
      };
      const uniq = [];
      const seen = new Set();
      for (const px of source) {
        const k = keyFor(px);
        if (!k) { uniq.push(px); continue; }
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(px);
      }
      return uniq;
    })();

    const firstPassenger = (() => {
      if (Array.isArray(cart.passengers) && cart.passengers.length) return cart.passengers[0];
      if (cart.passengerDetails) {
        if (Array.isArray(cart.passengerDetails.passengers) && cart.passengerDetails.passengers.length) return cart.passengerDetails.passengers[0];
        const cp = cart.passengerDetails.completePurchase;
        if (cp) {
          if (Array.isArray(cp.items) && cp.items.length && cp.items[0].passenger) return cp.items[0].passenger;
          if (cp.user) return { first_name: cp.user.first_name, last_name: cp.user.last_name, phone: cp.user.phone_number };
          if (cp.purchaser) return { first_name: cp.purchaser.first_name, last_name: cp.purchaser.last_name, phone: cp.purchaser.phone_number };
        }
      }
      if (cart.trip && Array.isArray(cart.trip.passengers) && cart.trip.passengers.length) return cart.trip.passengers[0];
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers) && cart.trips[0].passengers.length) return cart.trips[0].passengers[0];
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) && cart.busbudResponse.passengers.length) return cart.busbudResponse.passengers[0];
      return null;
    })();

    const seatFromPD = (() => {
      const pd = cart.passengerDetails && cart.passengerDetails.busbudResponse;
      if (!pd) return null;
      const collections = [pd.items, pd.tickets, pd.segments, pd.passengers];
      for (const col of collections) {
        if (!Array.isArray(col)) continue;
        for (const it of col) {
          if (!it) continue;
          if (it.seat_id) return it.seat_id;
          if (it.seat && typeof it.seat === 'string') return it.seat;
          if (it.seat && typeof it.seat.id === 'string') return it.seat.id;
          if (it.selected_seats && it.selected_seats[0] && (it.selected_seats[0].seat_id || it.selected_seats[0].seat)) return it.selected_seats[0].seat_id || it.selected_seats[0].seat;
        }
      }
      return null;
    })();

    const seatFromBB = (() => {
      const bb = cart.busbudResponse || {};
      const collections = [bb.items, bb.tickets, bb.segments, bb.passengers];
      for (const col of collections) {
        if (!Array.isArray(col)) continue;
        for (const it of col) {
          if (!it) continue;
          if (it.seat_id) return it.seat_id;
          if (it.seat && typeof it.seat === 'string') return it.seat;
          if (it.seat && typeof it.seat.id === 'string') return it.seat.id;
          if (it.selected_seats && it.selected_seats[0] && (it.selected_seats[0].seat_id || it.selected_seats[0].seat)) return it.selected_seats[0].seat_id || it.selected_seats[0].seat;
        }
      }
      return null;
    })();

    const nameFor = (p = {}) => ([
      p.first_name || p.firstName || p.given_name || p.givenName || p.name_first,
      p.last_name || p.lastName || p.family_name || p.familyName || p.name_last
    ].filter(Boolean).join(' '));

    const seatFor = (p = {}) => {
      const ss = p && p.selected_seats && p.selected_seats[0];
      if (ss && (ss.seat_id || ss.seat)) return ss.seat_id || ss.seat;
      if (p && (p.seat_id || p.seat || p.selectedSeat)) {
        if (p.seat_id) return p.seat_id;
        if (typeof p.seat === 'string') return p.seat;
        if (p.seat && (p.seat.id || p.seat.code)) return p.seat.id || p.seat.code;
        if (p.selectedSeat) return p.selectedSeat;
      }
      if (p && p.ticket && (p.ticket.seat_id || p.ticket.seat)) return p.ticket.seat_id || p.ticket.seat;
      return seatFromPD || seatFromBB || '—';
    };

    const phoneFor = (p = {}) => p.phone || p.phoneNumber || (cart.contact_info && cart.contact_info.phone) || (cart.contactInfo && cart.contactInfo.phone) || (purchaser && (purchaser.phone || purchaser.phoneNumber)) || '—';

    const expectedCount = (() => {
      const s = (cart.summary && (cart.summary.passengerCount || cart.summary.passengers)) || cart.passengerCount;
      if (typeof s === 'number' && s > 0) return s;
      if (Array.isArray(passengersList) && passengersList.length) return passengersList.length;
      const cands = [];
      if (cart.trip && Array.isArray(cart.trip.passengers)) cands.push(cart.trip.passengers.length);
      if (cart.passengerDetails && Array.isArray(cart.passengerDetails.passengers)) cands.push(cart.passengerDetails.passengers.length);
      if (Array.isArray(cart.passengers)) cands.push(cart.passengers.length);
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers)) cands.push(cart.trips[0].passengers.length);
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers)) cands.push(cart.busbudResponse.passengers.length);
      const n = cands.find(n => typeof n === 'number' && n > 0);
      return n || null;
    })();
    const baseList = passengersList.length ? passengersList : (firstPassenger ? [firstPassenger] : []);
    const list = expectedCount ? baseList.slice(0, expectedCount) : baseList;
    const passenger = list[idx - 1] || list[0] || firstPassenger || {};

    const passengerName = nameFor(passenger) || '—';
    const passengerPhone = phoneFor(passenger);
    const seatNo = seatFor(passenger);

    const refNo = pnr;
    const ticketNo = (() => {
      const cp = cart.passengerDetails && cart.passengerDetails.completePurchase;
      const cpItem = cp && Array.isArray(cp.items) && cp.items.length ? cp.items[0] : null;
      const cpRef = (cpItem && (cpItem.fields && cpItem.fields.booking_reference)) || (cpItem && cpItem.reference) || (cp && (cp.id || cp.uuid));
      return cpRef || cart.ticketNo || cart.ticket_no || cart.bookingId || cart.booking_id || cart.purchaseId || cart.purchase_id || (cart.purchase && (cart.purchase.id || cart.purchase.uuid)) || refNo;
    })();

    const priceNumber = typeof cart.totalPrice === 'number' ? cart.totalPrice : (typeof cart.total === 'number' ? cart.total : null);
    const priceText = priceNumber != null ? Number(priceNumber).toFixed(2) : '—';
    const toNumSimple = (v) => (typeof v === 'number') ? v : (typeof v === 'string' ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN') : NaN);
    const invoiceTotalPrint = (() => {
      const a = toNumSimple(cart.invoice && cart.invoice.amount_total);
      if (Number.isFinite(a)) return a;
      const b = toNumSimple(cart.invoice_data && cart.invoice_data.amount_total);
      if (Number.isFinite(b)) return b;
      const c = toNumSimple(cart.invoice && cart.invoice.total);
      if (Number.isFinite(c)) return c;
      const d = toNumSimple(cart.invoice && cart.invoice.amount_untaxed);
      if (Number.isFinite(d)) return d;
      return NaN;
    })();
    const totalForDivisionPrint = Number.isFinite(invoiceTotalPrint)
      ? invoiceTotalPrint
      : (Number.isFinite(toNumSimple(cart.totalPrice)) ? toNumSimple(cart.totalPrice)
      : (Number.isFinite(toNumSimple(cart.total)) ? toNumSimple(cart.total) : 0));
    const passengerCountPrint = list.length || 1;
    const unitPriceText = Number(totalForDivisionPrint / passengerCountPrint).toFixed(2);
    const paymentMethod = cart.paymentMethod || 'Online';
    const ticketUuid = (cart.passengerDetails && cart.passengerDetails.completePurchase && (cart.passengerDetails.completePurchase.uuid || cart.passengerDetails.completePurchase.id)) || (cart.purchase && (cart.purchase.uuid || cart.purchase.id)) || refNo;

    // Build QR Data URL
    const qrPayload = { pnr, passenger: { index: idx, name: passengerName, seat: seatNo } };
    const qrPng = qr.imageSync(JSON.stringify(qrPayload), { type: 'png' });
    const qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`;

    // Render EJS template
    res.setHeader('Content-Type', 'text/html');
    return res.render('ticket', {
      ticket: {
        ticket_no: ticketNo,
        ref_no: refNo,
        seat_no: seatNo,
        price: `$${unitPriceText} [${paymentMethod}]`,
        booked_by: 'online',
        uuid: ticketUuid
      },
      passenger: {
        name: passengerName,
        phone: passengerPhone
      },
      itinerary: {
        depart_city: origin,
        depart_date: departDate,
        depart_time: departTime,
        arrive_city: destination,
        arrive_date: arriveDate,
        arrive_time: arriveTime
      },
      contact: {
        phone: cart.contactPhone || (cart.contact_info && cart.contact_info.phone) || process.env.SUPPORT_PHONE || '—'
      },
      qrDataUrl,
      assets: { logoBase64 }
    });
  } catch (error) {
    logger.error(`❌ [${requestId}] Print ticket error`, { message: error.message, stack: error.stack });
    return res.status(500).send('Failed to render ticket');
  }
});

// ================================
// 📋 GET TICKET DETAILS
// ================================
// GET /api/ticket/cart/:cartId/:ticketId
// Gets ticket details from the cart's tickets subcollection
// Query params: ?purchaseId=string (optional)
router.get('/cart/:cartId/:ticketId', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { cartId, ticketId } = req.params;
  const { purchaseId } = req.query;

  console.log(`\n=== TICKET DETAILS REQUEST ===`);
  console.log(`[${requestId}] 📨 HTTP Method: ${req.method}`);
  console.log(`[${requestId}] 🔗 URL: ${req.originalUrl}`);
  console.log(`[${requestId}] 📦 Params:`, JSON.stringify(req.params, null, 2));
  console.log(`[${requestId}] 📦 Query:`, JSON.stringify(req.query, null, 2));

  logger.info(`📋 [${requestId}] Ticket details request`, {
    cartId,
    ticketId,
    purchaseId,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    params: req.params,
    query: req.query
  });

  if (!cartId || !ticketId) {
    console.log(`[${requestId}] ❌ VALIDATION ERROR: Missing cart ID or ticket ID`);
    return res.status(400).json({
      success: false,
      error: 'Missing cart ID or ticket ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Ensure cartId and ticketId are included in URL path',
        'Check frontend code for cartId and ticketId parameters'
      ]
    });
  }

  try {
    console.log(`[${requestId}] 📞 Getting ticket from Firestore...`);
    const ticket = await getTicket(cartId, ticketId);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`[${requestId}] 📥 Ticket retrieved successfully`);

    const responseTime = Date.now() - startTime;
    logger.info(`✅ [${requestId}] Ticket details retrieved in ${responseTime}ms`);

    res.json({
      success: true,
      ticket
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`[${requestId}] ❌ Ticket details error after ${responseTime}ms:`);
    console.log(`[${requestId}] Error:`, error.message);

    logger.error(`❌ [${requestId}] Ticket details error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cartId,
      ticketId,
      purchaseId
    });

    const errorResponse = {
      success: false,
      error: {
        message: error.message,
        type: 'TICKET_DETAILS_ERROR'
      },
      requestId,
      timestamp: new Date().toISOString()
    };

    const statusCode = error.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(statusCode).json(errorResponse);
  }
});

// ================================
// 🎫 GET TICKETS BY CART
// ================================
// GET /api/ticket/cart/:cartId
// Gets all tickets for a specific cart/purchase
router.get('/cart/:cartId', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  const { cartId } = req.params;

  console.log(`\n=== TICKETS BY CART REQUEST ===`);
  console.log(`[${requestId}] 📨 Getting tickets for cart: ${cartId}`);

  logger.info(`🎫 [${requestId}] Tickets by cart request`, {
    cartId,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  if (!cartId) {
    return res.status(400).json({
      success: false,
      error: 'Missing cart ID',
      requestId,
      timestamp: new Date().toISOString(),
      suggestions: [
        'Ensure cartId is included in URL path',
        'Check frontend code for cartId parameter'
      ]
    });
  }

  try {
    console.log(`[${requestId}] 📞 Getting tickets from in-memory storage...`);
    const ticketsForCart = await getTicketsByCartId(cartId);

    console.log(`[${requestId}] 📥 Found ${ticketsForCart.length} tickets`);

    const responseTime = Date.now() - startTime;
    logger.info(`✅ [${requestId}] Tickets retrieved in ${responseTime}ms`);

    res.json({
      success: true,
      tickets: ticketsForCart
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    console.log(`[${requestId}] ❌ Error getting tickets for cart:`, error.message);

    logger.error(`❌ [${requestId}] Tickets by cart error:`, {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cartId
    });

    res.status(500).json({
      success: false,
      error: {
        message: error.message,
        type: 'TICKET_RETRIEVAL_ERROR'
      },
      cart_id: cartId,
      tickets: [],
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// ================================
// 📧 HOLD ROUTE
// ================================
// POST /api/ticket/hold
// Emails the PNR and trip itinerary to the purchaser's email
router.post('/hold', async (req, res) => {
  const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const startTime = Date.now();
  try {
    const body = req.body || {};
    const lower = Object.fromEntries(Object.entries(body).map(([k, v]) => [String(k).toLowerCase(), v]));
    let pnr = lower.pnr || lower.firestorecartid || lower.cartid || lower.cart_id;
    if (!pnr) {
      return res.status(400).json({
        success: false,
        error: 'Missing pnr (firestoreCartId)',
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const db = await getFirestore();
    const doc = await db.collection('carts').doc(pnr).get();
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'PNR not found',
        pnr,
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    const cart = doc.data() || {};
    const purchaser = cart.purchaser || cart.purchaserDetails || (cart.passengerDetails && cart.passengerDetails.purchaser) || cart.contact_info || cart.contactInfo || {};
    const email = (purchaser && (purchaser.email || purchaser.Email)) || (cart.contact_info && cart.contact_info.email) || (cart.contactInfo && cart.contactInfo.email) || cart.email;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Purchaser email not found',
        pnr,
        requestId,
        timestamp: new Date().toISOString()
      });
    }

    let origin = 'Unknown';
    let destination = 'Unknown';
    let departTs = null;
    let arriveTs = null;
    let returnOrigin = null;
    let returnDestination = null;
    let returnDepartTs = null;
    let returnArriveTs = null;

    const rawTripItem = cart.trip && cart.trip._raw && Array.isArray(cart.trip._raw.items) ? cart.trip._raw.items[0] : null;
    const segments = rawTripItem && Array.isArray(rawTripItem.segments)
      ? rawTripItem.segments
      : ((cart.busbudResponse && (cart.busbudResponse.segments || (cart.busbudResponse.trip && cart.busbudResponse.trip.segments))) || cart.segments || []);

    let outboundSeg = null;
    let returnSeg = null;

    if (Array.isArray(segments) && segments.length) {
      outboundSeg = segments[0];

      const tripLegs = rawTripItem && Array.isArray(rawTripItem.trip_legs) ? rawTripItem.trip_legs : [];
      if (tripLegs.length > 0) {
        const leg1SegId = tripLegs[0] && Array.isArray(tripLegs[0].segment_ids) ? tripLegs[0].segment_ids[0] : null;
        const leg2SegId = tripLegs[1] && Array.isArray(tripLegs[1].segment_ids) ? tripLegs[1].segment_ids[0] : null;

        if (leg1SegId) {
          const found = segments.find(s => s && s.id === leg1SegId);
          if (found) outboundSeg = found;
        }
        if (leg2SegId) {
          const foundReturn = segments.find(s => s && s.id === leg2SegId);
          if (foundReturn) returnSeg = foundReturn;
        }
      } else if (segments.length > 1) {
        returnSeg = segments[1];
      }

      if (outboundSeg) {
        origin = (outboundSeg.origin && (outboundSeg.origin.city && outboundSeg.origin.city.name)) || (outboundSeg.origin && outboundSeg.origin.name) || origin;
        destination = (outboundSeg.destination && (outboundSeg.destination.city && outboundSeg.destination.city.name)) || (outboundSeg.destination && outboundSeg.destination.name) || destination;
        const dts = (outboundSeg.departure_time && (outboundSeg.departure_time.timestamp || outboundSeg.departure_time)) || (outboundSeg.departure && outboundSeg.departure.timestamp) || null;
        const ats = (outboundSeg.arrival_time && (outboundSeg.arrival_time.timestamp || outboundSeg.arrival_time)) || (outboundSeg.arrival && outboundSeg.arrival.timestamp) || null;
        departTs = dts ? new Date(dts) : null;
        arriveTs = ats ? new Date(ats) : null;
      }

      if (returnSeg) {
        returnOrigin = (returnSeg.origin && (returnSeg.origin.city && returnSeg.origin.city.name)) || (returnSeg.origin && returnSeg.origin.name) || null;
        returnDestination = (returnSeg.destination && (returnSeg.destination.city && returnSeg.destination.city.name)) || (returnSeg.destination && returnSeg.destination.name) || null;
        const rdts = (returnSeg.departure_time && (returnSeg.departure_time.timestamp || returnSeg.departure_time)) || (returnSeg.departure && returnSeg.departure.timestamp) || null;
        const rats = (returnSeg.arrival_time && (returnSeg.arrival_time.timestamp || returnSeg.arrival_time)) || (returnSeg.arrival && returnSeg.arrival.timestamp) || null;
        returnDepartTs = rdts ? new Date(rdts) : null;
        returnArriveTs = rats ? new Date(rats) : null;
      }
    } else if (cart.tripDetails) {
      origin = cart.tripDetails.originCity || cart.tripDetails.origin || origin;
      destination = cart.tripDetails.destinationCity || cart.tripDetails.destination || destination;
      departTs = cart.tripDetails.departureTime ? new Date(cart.tripDetails.departureTime) : null;
      arriveTs = cart.tripDetails.arrivalTime ? new Date(cart.tripDetails.arrivalTime) : null;
    }

    const departStr = departTs ? new Date(departTs).toLocaleString() : 'Unknown';
    const arriveStr = arriveTs ? new Date(arriveTs).toLocaleString() : 'Unknown';
    const hasReturnLeg = !!returnOrigin && !!returnDestination && !!returnDepartTs && !!returnArriveTs;
    const returnDepartStr = hasReturnLeg && returnDepartTs ? new Date(returnDepartTs).toLocaleString() : null;
    const returnArriveStr = hasReturnLeg && returnArriveTs ? new Date(returnArriveTs).toLocaleString() : null;

    const toNumSimple = (v) => (typeof v === 'number'
      ? v
      : (typeof v === 'string'
        ? parseFloat(String(v).match(/[0-9]+(?:\.[0-9]+)?/)?.[0] || 'NaN')
        : NaN));
    const priceCurrency = (() => {
      const pdAdj = cart.passengerDetails && cart.passengerDetails.busbudResponse && cart.passengerDetails.busbudResponse.adjusted_charges;
      const pdOrig = cart.passengerDetails && cart.passengerDetails.busbudResponse && cart.passengerDetails.busbudResponse.original_charges;
      const bbAdj = cart.busbudResponse && cart.busbudResponse.adjusted_charges;
      const bbOrig = cart.busbudResponse && cart.busbudResponse.original_charges;
      if (pdAdj && pdAdj.currency) return pdAdj.currency;
      if (pdOrig && pdOrig.currency) return pdOrig.currency;
      if (bbAdj && bbAdj.currency) return bbAdj.currency;
      if (bbOrig && bbOrig.currency) return bbOrig.currency;
      if (cart.summary && cart.summary.currency) return cart.summary.currency;
      if (cart.apiMetadata && cart.apiMetadata.currency) return cart.apiMetadata.currency;
      if (cart.trip && cart.trip.currency) return cart.trip.currency;
      return 'USD';
    })();
    let totalPriceNumber = null;
    if (typeof cart.totalAmount === 'number') {
      totalPriceNumber = cart.totalAmount;
    } else if (typeof cart.totalAmount === 'string' && cart.totalAmount.trim()) {
      const n = toNumSimple(cart.totalAmount);
      if (Number.isFinite(n)) totalPriceNumber = n;
    }

    if (totalPriceNumber == null) {
      const pdAdj = cart.passengerDetails && cart.passengerDetails.busbudResponse && cart.passengerDetails.busbudResponse.adjusted_charges;
      if (pdAdj && pdAdj.total != null) {
        const n = toNumSimple(pdAdj.total);
        if (Number.isFinite(n)) totalPriceNumber = n / 100;
      }
    }

    if (totalPriceNumber == null) {
      const pdOrig = cart.passengerDetails && cart.passengerDetails.busbudResponse && cart.passengerDetails.busbudResponse.original_charges;
      if (pdOrig && pdOrig.total != null) {
        const base = toNumSimple(pdOrig.total);
        if (Number.isFinite(base)) {
          try {
            const adj = applyPriceAdjustments(base / 100, { currency: pdOrig.currency || priceCurrency, returnMetadata: true });
            if (adj && typeof adj.adjustedAmount === 'number') {
              totalPriceNumber = adj.adjustedAmount;
            } else {
              totalPriceNumber = base / 100;
            }
          } catch (_) {
            totalPriceNumber = base / 100;
          }
        }
      }
    }

    if (totalPriceNumber == null) {
      const bbAdj = cart.busbudResponse && cart.busbudResponse.adjusted_charges;
      if (bbAdj && bbAdj.total != null) {
        const n = toNumSimple(bbAdj.total);
        if (Number.isFinite(n)) totalPriceNumber = n / 100;
      }
    }

    const priceText = totalPriceNumber != null && Number.isFinite(Number(totalPriceNumber))
      ? `${Number(totalPriceNumber).toFixed(2)} ${priceCurrency}`
      : null;

    const completePurchase = cart.passengerDetails && cart.passengerDetails.completePurchase;
    const firstPassenger = (() => {
      if (Array.isArray(cart.passengers) && cart.passengers.length) return cart.passengers[0];
      if (cart.passengerDetails) {
        if (Array.isArray(cart.passengerDetails.passengers) && cart.passengerDetails.passengers.length) return cart.passengerDetails.passengers[0];
        const cp = completePurchase;
        if (cp) {
          if (Array.isArray(cp.items) && cp.items.length && cp.items[0].passenger) return cp.items[0].passenger;
          if (cp.user) return { first_name: cp.user.first_name, last_name: cp.user.last_name, phone: cp.user.phone_number };
          if (cp.purchaser) return { first_name: cp.purchaser.first_name, last_name: cp.purchaser.last_name, phone: cp.purchaser.phone_number };
        }
      }
      if (cart.trip && Array.isArray(cart.trip.passengers) && cart.trip.passengers.length) return cart.trip.passengers[0];
      if (Array.isArray(cart.trips) && cart.trips.length && Array.isArray(cart.trips[0].passengers) && cart.trips[0].passengers.length) return cart.trips[0].passengers[0];
      if (cart.busbudResponse && Array.isArray(cart.busbudResponse.passengers) && cart.busbudResponse.passengers.length) return cart.busbudResponse.passengers[0];
      return null;
    })();
    const passengerName = (firstPassenger && [
      firstPassenger.first_name || firstPassenger.firstName,
      firstPassenger.last_name || firstPassenger.lastName
    ].filter(Boolean).join(' ')) || null;

    const operatorName =
      (cart.trip && cart.trip.operator && (cart.trip.operator.name || cart.trip.operator.operator_name)) ||
      (cart.tripDetails && cart.tripDetails.operator) ||
      (cart.operator && cart.operator.name) ||
      (outboundSeg && outboundSeg.operator && (outboundSeg.operator.name || outboundSeg.operator.xid)) ||
      '—';

    const subject = `Your Reservation is Confirmed - PNR ${pnr}`;
    let text = `Success! Your booking is confirmed and your ticket is reserved. Simply use the reservation number below at any Pick n Pay store to purchase and collect your tickets.\n\nPNR: ${pnr}`;
    if (passengerName) {
      text += `\nPassenger: ${passengerName}`;
    }
    if (priceText) {
      text += `\nTotal Price: ${priceText}`;
    }
    if (operatorName && operatorName !== '—') {
      text += `\nOperator: ${operatorName}`;
    }
    text += `\n\nOutbound:\nFrom: ${origin}\nTo: ${destination}\nDeparture: ${departStr}\nArrival: ${arriveStr}`;
    if (hasReturnLeg && returnOrigin && returnDestination && returnDepartStr && returnArriveStr) {
      text += `\n\nReturn Trip:\nFrom: ${returnOrigin}\nTo: ${returnDestination}\nDeparture: ${returnDepartStr}\nArrival: ${returnArriveStr}`;
    }

    let html = `<div><h2>Reservation Confirmed</h2><p>Success! Your booking is confirmed and your ticket is reserved. Simply use the reservation number below at any Pick n Pay store to purchase and collect your tickets.</p><p><strong>PNR:</strong> ${pnr}</p>`;
    if (passengerName) {
      html += `<p><strong>Passenger:</strong> ${passengerName}</p>`;
    }
    if (priceText) {
      html += `<p><strong>Total Price:</strong> ${priceText}</p>`;
    }
    if (operatorName && operatorName !== '—') {
      html += `<p><strong>Operator:</strong> ${operatorName}</p>`;
    }
    html += `<p><strong>Outbound:</strong><br/><strong>From:</strong> ${origin}<br/><strong>To:</strong> ${destination}</p><p><strong>Departure:</strong> ${departStr}<br/><strong>Arrival:</strong> ${arriveStr}</p>`;
    if (hasReturnLeg && returnOrigin && returnDestination && returnDepartStr && returnArriveStr) {
      html += `<hr/><p><strong>Return:</strong><br/><strong>From:</strong> ${returnOrigin}<br/><strong>To:</strong> ${returnDestination}</p><p><strong>Departure:</strong> ${returnDepartStr}<br/><strong>Arrival:</strong> ${returnArriveStr}</p>`;
    }
    html += `</div>`;

    await sendEmail({ to: email, subject, text, html });

    const __base = process.env.INTERNAL_API_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const __interval = parseInt(process.env.PAYMENT_AUTO_POLL_INTERVAL_MS || '15000', 10);
    const __timeout = parseInt(process.env.PAYMENT_AUTO_POLL_TIMEOUT_MS || '900000', 10);
    (async () => {
      const __start = Date.now();
      const __cart = cart && (cart.busbudCartId || cart.cartId || cart.cart_id || '');
      while (Date.now() - __start < __timeout) {
        try {
          const url = __cart
            ? `${__base}/api/payments/poll/${encodeURIComponent(pnr)}?cartId=${encodeURIComponent(__cart)}`
            : `${__base}/api/payments/poll/${encodeURIComponent(pnr)}`;
          const r = await axios.get(url);
          const s = r.data && r.data.status;
          if (s === 'confirmed' || s === 'cancelled' || s === 'payment_failed' || s === 'already_processed') break;
        } catch (e) {}
        await new Promise(r => setTimeout(r, __interval));
      }
    })();

    const responseTime = Date.now() - startTime;
    logger.info(`📧 [${requestId}] Hold email sent`, { pnr, to: email, responseTime: `${responseTime}ms` });

    return res.json({
      success: true,
      pnr,
      sentTo: email,
      requestId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error(`❌ [${requestId}] Hold route error`, {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      success: false,
      error: {
        message: error.message,
        type: 'HOLD_EMAIL_ERROR'
      },
      requestId,
      timestamp: new Date().toISOString()
    });
  }
});

// ================================
// 🔧 DEBUG ENDPOINT
// ================================
// POST /api/ticket/debug
// Debug endpoint for troubleshooting frontend integration
if (process.env.NODE_ENV !== 'production') {
  router.post('/debug', async (req, res) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    console.log(`\n=== TICKET DEBUG REQUEST ===`);
    console.log(`[${requestId}] 📨 HTTP Method: ${req.method}`);
    console.log(`[${requestId}] 🔗 URL: ${req.originalUrl}`);
    console.log(`[${requestId}] 📦 Raw Request Body:`, JSON.stringify(req.body, null, 2));
    console.log(`[${requestId}] 📦 Request Keys:`, Object.keys(req.body || {}));
    console.log(`[${requestId}] 📦 Query Params:`, JSON.stringify(req.query, null, 2));
    console.log(`[${requestId}] 👤 Headers:`, JSON.stringify(req.headers, null, 2));

    // Extract cartId and options from expected locations
    const cartId = req.body.cartId;
    const options = req.body.options;

    console.log(`[${requestId}] 🔍 Extracted cartId:`, cartId);
    console.log(`[${requestId}] 🔍 Extracted options:`, options);

    // Validate that required fields are present
    if (!cartId) {
      console.log(`[${requestId}] ❌ DEBUG VALIDATION ERROR: Missing cart ID`);
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter in debug request',
        missingParameter: 'cartId',
        requestId,
        timestamp: new Date().toISOString(),
        debugInfo: {
          requestBody: req.body,
          queryParams: req.query,
          headers: req.headers,
          bodyKeys: Object.keys(req.body || {}),
          queryKeys: Object.keys(req.query || {}),
          cartIdValue: cartId,
          cartIdType: typeof cartId,
          optionsValue: options,
          optionsType: typeof options
        },
        suggestions: [
          'Ensure cartId is included in request body as {"cartId": "your-id"}',
          'options is optional but can include ticket format, delivery method, etc.',
          'Check frontend code for correct field names',
          'Verify purchase was completed successfully before creating tickets',
          'Use this endpoint to test your frontend requests before using main endpoint'
        ]
      });
    }

    res.json({
      success: true,
      message: 'Ticket debug info logged to console',
      requestBody: req.body,
      queryParams: req.query,
      headers: req.headers,
      extracted: {
        cartId: cartId,
        options: options
      },
      suggestions: [
        'Check console logs for detailed request information',
        'If cartId is missing, check frontend code',
        'Verify purchase was completed successfully before creating tickets',
        'Use POST /api/ticket/create endpoint for actual ticket creation'
      ],
      requestId,
      timestamp: new Date().toISOString()
    });
  });
}

export default router;
