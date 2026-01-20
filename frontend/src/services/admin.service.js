import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../config/firebase.config.mjs';
import logger from '../utils/logger.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function countAdmins() {
  const db = await getFirestore();
  const snap = await db.collection('admins').get();
  return snap.size;
}

export async function getAdminByEmail(email) {
  const db = await getFirestore();
  const emailLower = normalizeEmail(email);
  const snap = await db
    .collection('admins')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function listAdmins() {
  const db = await getFirestore();
  const snap = await db.collection('admins').orderBy('emailLower').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addAdmin(email, createdBy = null) {
  const db = await getFirestore();
  const emailLower = normalizeEmail(email);
  if (!emailLower) throw new Error('Invalid email');

  const existing = await getAdminByEmail(emailLower);
  if (existing) throw new Error('Admin already exists');

  const doc = {
    email: emailLower,
    emailLower,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: createdBy || null
  };

  const ref = await db.collection('admins').add(doc);
  logger.info(`Admin added: ${emailLower}`);
  return { id: ref.id, ...doc };
}
