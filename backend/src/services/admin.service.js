import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../config/firebase.config.mjs';
import { eq } from 'drizzle-orm';
import db, { admins } from '../db/drizzleClient.js';
import logger from '../utils/logger.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function countAdmins() {
  // Try Postgres first
  try {
    const rows = await db.select({ count: admins.id }).from(admins);
    if (rows && rows.length && rows[0].count != null) return Number(rows[0].count);
  } catch (e) {}

  // Fallback to Firestore
  const fs = await getFirestore();
  const snap = await fs.collection('admins').get();
  return snap.size;
}

export async function getAdminByEmail(email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return null;

  // Try Postgres first
  const rows = await db.select().from(admins).where(eq(admins.emailLower, emailLower)).limit(1);
  if (rows && rows.length) return rows[0];

  // Fallback to Firestore
  const fs = await getFirestore();
  const snap = await fs
    .collection('admins')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function listAdmins() {
  // Try Postgres first
  try {
    const rows = await db.select().from(admins).orderBy(admins.emailLower);
    if (rows && rows.length) return rows;
  } catch (e) {}

  // Fallback to Firestore
  const fs = await getFirestore();
  const snap = await fs.collection('admins').orderBy('emailLower').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addAdmin(email, createdBy = null) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) throw new Error('Invalid email');

  const existing = await getAdminByEmail(emailLower);
  if (existing) throw new Error('Admin already exists');

  // Create in Postgres
  const pgAdminRows = await db
    .insert(admins)
    .values({
      userId: null,
      emailLower,
      firstName: '',
      lastName: '',
      phone: '',
      active: true
    })
    .returning();
  const pgAdmin = pgAdminRows && pgAdminRows.length ? pgAdminRows[0] : null;

  // Best-effort Firestore for backward compatibility
  try {
    const fs = await getFirestore();
    const doc = {
      email: emailLower,
      emailLower,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: createdBy || null
    };
    const ref = await fs.collection('admins').add(doc);
    logger.info(`Admin added: ${emailLower}`);
    return { id: pgAdmin?.id ?? ref.id, ...doc, ...pgAdmin };
  } catch (e) {
    logger.warn(`Admin added in Postgres only: ${emailLower}`);
    return pgAdmin;
  }
}
