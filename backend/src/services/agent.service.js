import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../config/firebase.config.mjs';
import { eq } from 'drizzle-orm';
import db, { agents } from '../db/drizzleClient.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function getAgentByEmail(email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return null;

  // Try Postgres first
  const rows = await db.select().from(agents).where(eq(agents.emailLower, emailLower)).limit(1);
  if (rows && rows.length) return rows[0];

  // Fallback to Firestore
  const fs = await getFirestore();
  const snap = await fs
    .collection('agents')
    .where('emailLower', '==', emailLower)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function getAgentById(id) {
  const idStr = String(id || '').trim();
  if (!idStr) return null;
  const rows = await db.select().from(agents).where(eq(agents.id, idStr)).limit(1);
  if (rows && rows.length) return rows[0];
  const fs = await getFirestore();
  const doc = await fs.collection('agents').doc(idStr).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function upsertAgentForUser(user) {
  const emailLower = normalizeEmail(user && user.email);
  if (!emailLower) throw new Error('Invalid email for agent');

  const existing = await getAgentByEmail(emailLower);
  if (existing) return existing;

  // Create in Postgres
  const pgAgentRows = await db
    .insert(agents)
    .values({
      userId: user && user.id ? String(user.id) : null,
      emailLower,
      firstName: user && user.firstName ? user.firstName : '',
      lastName: user && user.lastName ? user.lastName : '',
      phone: user && user.phone ? user.phone : '',
      active: false
    })
    .returning();
  const pgAgent = pgAgentRows && pgAgentRows.length ? pgAgentRows[0] : null;

  // Best-effort Firestore for backward compatibility
  try {
    const fs = await getFirestore();
    const doc = {
      email: emailLower,
      emailLower,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      userId: user && user.id ? String(user.id) : null,
      firstName: user && user.firstName ? user.firstName : '',
      lastName: user && user.lastName ? user.lastName : '',
      phone: user && user.phone ? user.phone : ''
    };
    const ref = await fs.collection('agents').add(doc);
    return { id: pgAgent?.id ?? ref.id, ...doc, ...pgAgent };
  } catch (e) {
    return pgAgent;
  }
}
