import axios from 'axios';
import { logger } from './logger.js';

const WEBHOOK_URL = process.env.PAYMENT_WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;

export async function sendPaymentWebhook(eventPayload = {}) {
  if (!WEBHOOK_URL) {
    logger.debug('Payment webhook disabled: PAYMENT_WEBHOOK_URL not set');
    return { success: false, disabled: true };
  }

  const pnr = eventPayload.pnr || eventPayload.payment_reference;
  const paymentReference = eventPayload.payment_reference || eventPayload.pnr;

  const payload = {
    event: eventPayload.event || 'payment.confirmed',
    status: eventPayload.status,
    pnr,
    payment_reference: paymentReference,
    firestoreCartId: eventPayload.firestoreCartId,
    cartId: eventPayload.cartId,
    purchaseId: eventPayload.purchaseId,
    purchaseUuid: eventPayload.purchaseUuid,
    amount: eventPayload.amount,
    currency: eventPayload.currency,
    confirmedAt: eventPayload.confirmedAt,
    cancelledAt: eventPayload.cancelledAt,
    failedAt: eventPayload.failedAt,
    metadata: eventPayload.metadata || {},
    source: eventPayload.source || 'uniglade-backend'
  };

  const headers = {
    'Content-Type': 'application/json'
  };

  if (WEBHOOK_SECRET) {
    headers['X-Webhook-Secret'] = WEBHOOK_SECRET;
  }

  try {
    const res = await axios.post(WEBHOOK_URL, payload, { headers, timeout: 10000 });
    logger.info('Payment webhook sent', {
      url: WEBHOOK_URL,
      status: res.status,
      event: payload.event,
      pnr,
      payment_reference: paymentReference
    });
    return { success: true, status: res.status, response: res.data };
  } catch (err) {
    logger.warn('Payment webhook failed', {
      url: WEBHOOK_URL,
      error: err.message,
      event: payload.event,
      pnr,
      payment_reference: paymentReference,
      status: err.response && err.response.status
    });
    return {
      success: false,
      error: err.message,
      response: err.response && err.response.data
    };
  }
}
