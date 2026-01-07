import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../config/firebase.config.mjs';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function getUserByEmail(email) {
  const db = await getFirestore();
  const emailLower = normalizeEmail(email);
  if (!emailLower) return null;

  const snap = await db
    .collection('users')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function getUserById(id) {
  const db = await getFirestore();
  const ref = db.collection('users').doc(String(id));
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createUser({ email, passwordHash, firstName = '', lastName = '', phone = '' }) {
  const db = await getFirestore();
  const emailLower = normalizeEmail(email);
  if (!emailLower) throw new Error('Invalid email');

  const existing = await getUserByEmail(emailLower);
  if (existing) throw new Error('Email already in use');

  const doc = {
    email: emailLower,
    emailLower,
    passwordHash,
    firstName: firstName || '',
    lastName: lastName || '',
    phone: phone || '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const ref = await db.collection('users').add(doc);
  return { id: ref.id, ...doc };
}

export async function updateUser(id, updates) {
  const db = await getFirestore();
  const ref = db.collection('users').doc(String(id));
  await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
  const doc = await ref.get();
  return { id: doc.id, ...doc.data() };
}
