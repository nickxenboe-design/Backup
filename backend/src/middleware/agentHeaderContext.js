import { getAgentByEmail, getAgentById } from '../services/agent.service.js';
import { getFirestore } from '../config/firebase.config.mjs';
import logger from '../utils/logger.js';

function readHeader(req, name) {
  if (!req || !req.headers) return null;
  const key = name.toLowerCase();
  const raw = req.headers[key];
  return typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : null;
}

export default async function agentHeaderContext(req, _res, next) {
  try {
    // Attempt to resolve agent using multiple strategies
    const modeHeader = readHeader(req, 'x-agent-mode');
    const emailHeader = readHeader(req, 'x-agent-email');
    const idHeader = readHeader(req, 'x-agent-id');
    const cartHeader = readHeader(req, 'x-cart-id');

    let agent = req.agent || null;
    // 1) If agent headers declare mode and id/email, prefer those
    if (!agent && modeHeader && String(modeHeader).toLowerCase() === 'true') {
      if (idHeader) {
        try { agent = await getAgentById(idHeader); } catch {}
      }
      if (!agent && emailHeader) {
        try { agent = await getAgentByEmail(emailHeader); } catch {}
      }
    }

    // 2) Fallback: logged-in agent via optionalUserAuth
    if (!agent && req.user && String(req.user.role || '').toLowerCase() === 'agent' && req.user.email) {
      try { agent = await getAgentByEmail(req.user.email); } catch {}
    }

    // 3) Fallback: Firestore cart -> agentEmail -> Postgres agent
    //    Accept cart ID from header, query, body, or params
    let cartId = cartHeader || null;
    if (!cartId) {
      const q = req.query || {};
      const b = req.body || {};
      const p = req.params || {};
      cartId =
        q.cartId || q.cart_id || q.pnr || q.reference ||
        b.cartId || b.cart_id || b.pnr || b.reference ||
        p.cartId || p.cart_id || p.pnr || p.reference || null;
    }
    if (!agent && cartId) {
      try {
        const db = await getFirestore();
        const snap = await db.collection('carts').doc(String(cartId)).get();
        if (snap.exists) {
          const cart = snap.data() || {};
          const emailFromCart = cart.agentEmail || (cart.agent && cart.agent.agentEmail) || null;
          if (emailFromCart) {
            try { agent = await getAgentByEmail(emailFromCart); } catch {}
          }
        }
      } catch (_) { /* noop */ }
    }

    if (!agent || agent.active === false) {
      return next();
    }

    // Attach agent context
    req.agent = agent;
    req.agentId = agent.id;
    req.agentEmail = agent.emailLower || (req.user && req.user.email ? String(req.user.email).toLowerCase() : (emailHeader || ''));

    // Populate headers for downstream consumers/logging
    try {
      req.headers = req.headers || {};
      const lower = req.headers;
      lower['x-agent-mode'] = 'true';
      if (!lower['x-agent-email'] && req.agentEmail) lower['x-agent-email'] = req.agentEmail;
      if (!lower['x-agent-id'] && agent.id) lower['x-agent-id'] = agent.id;
      const first = agent.firstName || agent.first_name || '';
      const last = agent.lastName || agent.last_name || '';
      const display = (agent.name || agent.displayName || '').trim();
      const computedName = (display || `${first} ${last}`.trim()).trim();
      if (!lower['x-agent-name'] && computedName) lower['x-agent-name'] = computedName;
    } catch (e) {
      logger.warn('Failed to populate agent headers on request', { error: e && e.message });
    }
    return next();
  } catch (err) {
    logger.warn('agentHeaderContext failed', { error: err && err.message });
    return next();
  }
}
