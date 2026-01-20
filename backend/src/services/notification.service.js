import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../config/firebase.config.mjs';
import { listAdmins } from './admin.service.js';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const adminItemsRef = async (email) => {
  const emailLower = normalizeEmail(email);
  if (!emailLower) throw new Error('Missing admin email');
  const fs = await getFirestore();
  return fs.collection('notifications_admin').doc(emailLower).collection('items');
};

const agentItemsRef = async (email) => {
  const emailLower = normalizeEmail(email);
  if (!emailLower) throw new Error('Missing agent email');
  const fs = await getFirestore();
  return fs.collection('notifications_agent').doc(emailLower).collection('items');
};

const normalizePayload = (payload) => {
  const base = payload && typeof payload === 'object' ? payload : {};
  const title = typeof base.title === 'string' ? base.title.trim() : '';
  const message = typeof base.message === 'string' ? base.message.trim() : '';
  const category = typeof base.category === 'string' ? base.category.trim() : '';
  const level = typeof base.level === 'string' ? base.level.trim() : '';
  const meta = base.meta && typeof base.meta === 'object' ? base.meta : {};
  return {
    title: title || 'Notification',
    message: message || '',
    category: category || 'general',
    level: level || 'info',
    meta,
  };
};

export async function createAdminNotificationForEmail(email, payload) {
  const emailLower = normalizeEmail(email);
  const data = normalizePayload(payload);
  const ref = await adminItemsRef(emailLower);
  const nowMs = Date.now();
  const doc = {
    ...data,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
  };
  const created = await ref.add(doc);
  return { id: created.id, ...doc, createdAt: nowMs };
}

export async function createAdminNotificationForAll(payload) {
  const admins = await listAdmins();
  const targets = (admins || [])
    .map((a) => normalizeEmail(a && (a.emailLower || a.email)))
    .filter(Boolean);

  const unique = Array.from(new Set(targets));
  const results = await Promise.allSettled(unique.map((email) => createAdminNotificationForEmail(email, payload)));
  return {
    requested: unique.length,
    created: results.filter((r) => r.status === 'fulfilled').length,
  };
}

export async function createAgentNotificationForEmail(email, payload) {
  const emailLower = normalizeEmail(email);
  const data = normalizePayload(payload);
  const ref = await agentItemsRef(emailLower);
  const nowMs = Date.now();
  const doc = {
    ...data,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
  };
  const created = await ref.add(doc);
  return { id: created.id, ...doc, createdAt: nowMs };
}

export async function listAdminNotifications(email, { limit = 30, unreadOnly = false } = {}) {
  const emailLower = normalizeEmail(email);
  const ref = await adminItemsRef(emailLower);
  const snap = await ref.orderBy('createdAtMs', 'desc').limit(limit).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return unreadOnly ? rows.filter((r) => r && r.read !== true) : rows;
}

export async function listAgentNotifications(email, { limit = 30, unreadOnly = false } = {}) {
  const emailLower = normalizeEmail(email);
  const ref = await agentItemsRef(emailLower);
  const snap = await ref.orderBy('createdAtMs', 'desc').limit(limit).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return unreadOnly ? rows.filter((r) => r && r.read !== true) : rows;
}

export async function markAdminNotificationRead(email, notificationId) {
  const emailLower = normalizeEmail(email);
  const id = String(notificationId || '').trim();
  if (!id) throw new Error('Missing notification id');
  const ref = await adminItemsRef(emailLower);
  const nowMs = Date.now();
  await ref.doc(id).set({ read: true, readAt: FieldValue.serverTimestamp(), readAtMs: nowMs }, { merge: true });
  return { id, read: true, readAtMs: nowMs };
}

export async function markAgentNotificationRead(email, notificationId) {
  const emailLower = normalizeEmail(email);
  const id = String(notificationId || '').trim();
  if (!id) throw new Error('Missing notification id');
  const ref = await agentItemsRef(emailLower);
  const nowMs = Date.now();
  await ref.doc(id).set({ read: true, readAt: FieldValue.serverTimestamp(), readAtMs: nowMs }, { merge: true });
  return { id, read: true, readAtMs: nowMs };
}
