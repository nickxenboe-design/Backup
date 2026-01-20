import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../config/firebase.config.mjs';
import { eq } from 'drizzle-orm';
import db, { users } from '../db/drizzleClient.js';

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function getUserByEmailPg(emailLower) {
  const rows = await db.select().from(users).where(eq(users.emailLower, emailLower)).limit(1);
  if (!rows || !rows.length) return null;
  return rows[0];
}

export async function createUserPg({ emailLower, passwordHash, firstName, lastName, phone, role = 'user' }) {
  const inserted = await db
    .insert(users)
    .values({
      email: emailLower,
      emailLower,
      passwordHash: passwordHash || null,
      firstName: firstName || '',
      lastName: lastName || '',
      phone: phone || '',
      role: role || 'user'
    })
    .returning();
  return inserted && inserted.length ? inserted[0] : null;
}

async function updateUserPg(id, updates) {
  const payload = { ...updates };
  if (payload.email) {
    payload.emailLower = normalizeEmail(payload.email);
  }
  const updated = await db.update(users).set(payload).where(eq(users.id, id)).returning();
  return updated && updated.length ? updated[0] : null;
}

export async function getUserByEmail(email) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) return null;

  // Try Postgres first
  const fromPg = await getUserByEmailPg(emailLower);
  if (fromPg) {
    // If PG user exists but has no passwordHash, try to backfill from Firestore for backward compatibility
    if (!fromPg.passwordHash) {
      try {
        const fs = await getFirestore();
        const snap = await fs.collection('users').where('emailLower', '==', emailLower).limit(1).get();
        if (!snap.empty) {
          const doc = snap.docs[0];
          const fsData = doc.data() || {};
          if (fsData.passwordHash) {
            return { ...fromPg, passwordHash: fsData.passwordHash };
          }
        }
      } catch (_) {
        // ignore FS errors; fall through to return PG user
      }
    }
    return fromPg;
  }

  // Fallback to Firestore
  const fs = await getFirestore();
  const snap = await fs.collection('users').where('emailLower', '==', emailLower).limit(1).get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function getUserById(id) {
  if (!id) return null;
  const idStr = String(id);

  const isUuid = (value) => {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  };

  if (isUuid(idStr)) {
    try {
      const rows = await db.select().from(users).where(eq(users.id, idStr)).limit(1);
      if (rows && rows.length) return rows[0];
    } catch (_) {
      // ignore and fallback to Firestore
    }
  }

  const fs = await getFirestore();
  const ref = fs.collection('users').doc(idStr);
  const doc = await ref.get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function createUser({ email, passwordHash, firstName = '', lastName = '', phone = '', role = 'user' }) {
  const emailLower = normalizeEmail(email);
  if (!emailLower) throw new Error('Invalid email');

  const existing = await getUserByEmail(emailLower);
  if (existing) throw new Error('Email already in use');

  // Create in Postgres
  const pgUser = await createUserPg({ emailLower, passwordHash, firstName, lastName, phone, role });

  // Best-effort write to Firestore for backward compatibility
  try {
    const fs = await getFirestore();
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
    const ref = await fs.collection('users').add(doc);
    return { id: pgUser?.id ?? ref.id, ...doc, ...pgUser };
  } catch (e) {
    return pgUser;
  }
}

export async function updateUser(id, updates) {
  let result = null;
  try {
    result = await updateUserPg(id, updates);
  } catch (e) {
    // ignore PG update errors; fallback to Firestore update below
  }

  try {
    const fs = await getFirestore();
    const ref = fs.collection('users').doc(String(id));
    await ref.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });
    const doc = await ref.get();
    const fsData = doc.exists ? { id: doc.id, ...doc.data() } : null;
    return result || fsData;
  } catch (e) {
    return result;
  }
}
