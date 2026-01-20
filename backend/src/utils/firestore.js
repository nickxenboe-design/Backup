import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore as getFirestoreSingleton } from '../config/firebase.config.mjs';

let db;
async function ensureDb() {
  if (!db) {
    db = await getFirestoreSingleton();
  }
  return db;
}

/**
 * Get a cart by ID from Firestore
 * @param {string} cartId - The cart document ID
 * @returns {Promise<Object|null>} The cart data or null if not found
 */
const getCart = async (cartId) => {
  try {
    const db = await ensureDb();
    const doc = await db.collection('carts').doc(cartId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error getting cart from Firestore:', error);
    throw error;
  }
};

/**
 * Update a cart in Firestore
 * @param {string} cartId - The cart document ID
 * @param {Object} updates - The fields to update
 * @returns {Promise<void>}
 */
const updateCart = async (cartId, updates) => {
  try {
    const db = await ensureDb();
    const cartRef = db.collection('carts').doc(cartId);
    await cartRef.update({
      ...updates,
      updatedAt: FieldValue.serverTimestamp()
    });
    console.log(`✅ Cart ${cartId} updated in Firestore`);
  } catch (error) {
    console.error('Error updating cart in Firestore:', error);
    throw error;
  }
};

/**
 * Check if a cart with the given Busbud cart ID already exists
 * @param {string} busbudCartId - The Busbud cart ID
 * @returns {Promise<{exists: boolean, cartId: string|null}>}
 */
const checkCartExists = async (busbudCartId) => {
  try {
    const db = await ensureDb();
    const snapshot = await db.collection('carts')
      .where('busbudCartId', '==', busbudCartId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { exists: false, cartId: null };
    }

    // Return the first matching cart
    const doc = snapshot.docs[0];
    return { exists: true, cartId: doc.id };
  } catch (error) {
    console.error('Error checking if cart exists in Firestore:', error);
    throw error;
  }
};

/**
 * Find carts by userId (for shopping carts)
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} Array of cart documents
 */
const getCartsByUserId = async (userId) => {
  try {
    const db = await ensureDb();
    const snapshot = await db.collection('carts')
      .where('userId', '==', userId)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting carts by userId from Firestore:', error);
    throw error;
  }
};

/**
 * Find cart by Busbud cart ID
 * @param {string} busbudCartId - The Busbud cart ID
 * @returns {Promise<Object|null>} Cart data or null if not found
 */
const getCartByBusbudId = async (busbudCartId) => {
  try {
    const db = await ensureDb();
    const snapshot = await db.collection('carts')
      .where('busbudCartId', '==', busbudCartId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    console.error('Error getting cart by Busbud ID from Firestore:', error);
    throw error;
  }
};

/**
 * Get all carts (for cleanup operations)
 * @param {number} [limit=100] - Maximum number of carts to return
 * @returns {Promise<Array>} Array of cart documents
 */
const getAllCarts = async (limit = 100) => {
  try {
    const db = await ensureDb();
    const snapshot = await db.collection('carts')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error('Error getting all carts from Firestore:', error);
    throw error;
  }
};

/**
 * Delete a cart from Firestore
 * @param {string} cartId - The cart document ID
 * @returns {Promise<void>}
 */
const deleteCart = async (cartId) => {
  try {
    const db = await ensureDb();
    await db.collection('carts').doc(cartId).delete();
    console.log(`✅ Cart ${cartId} deleted from Firestore`);
  } catch (error) {
    console.error('Error deleting cart from Firestore:', error);
    throw error;
  }
};

const getOrCreateFirestoreCartId = async (busbudCartId, branchHint = null) => {
  try {
    const db = await ensureDb();

    // If a cart already exists for this Busbud cart, reuse it without incrementing
    const existing = await db.collection('carts')
      .where('busbudCartId', '==', busbudCartId)
      .limit(1)
      .get();

    if (!existing.empty) {
      const doc = existing.docs[0];
      return doc.id;
    }

    const counterRef = db.collection('entity_counters').doc('global_counter');

    const newId = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);
      const currentValue = counterSnap.exists ? (counterSnap.data().lastId || 0) : 0;
      const nextValue = currentValue + 1;

      // Persist the new counter value
      tx.set(counterRef, { lastId: nextValue }, { merge: true });

      // Format cart ID numeric-only, keep branch digits (e.g., 01000001)
      const counterStr = String(nextValue).padStart(6, '0');
      const ticketType = '1';

      // Determine branch code: 01=frontend, 02=chatbot, default 01
      const normalizedBranch = typeof branchHint === 'string' ? branchHint.toLowerCase() : null;
      let branchCode = '01';
      if (normalizedBranch && /^\d{2}$/.test(normalizedBranch)) {
        branchCode = normalizedBranch;
      } else if (normalizedBranch === 'chatbot' || normalizedBranch === 'bot') {
        branchCode = '02';
      } else if (normalizedBranch === 'harare') {
        branchCode = '03';
      } else if (normalizedBranch === 'gweru') {
        branchCode = '04';
      } else if (
        normalizedBranch === 'online' ||
        normalizedBranch === 'frontend' ||
        normalizedBranch === 'web' ||
        normalizedBranch === '01'
      ) {
        branchCode = '01';
      }

      const cartId = `${ticketType}${branchCode}${counterStr}`;

      const cartRef = db.collection('carts').doc(cartId);
      tx.set(cartRef, {
        cartId,
        firestoreCartId: cartId,
        busbudCartId,
        status: 'active',
        source: 'busbud',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true });

      return cartId;
    });

    return newId;
  } catch (error) {
    console.error('Error in getOrCreateFirestoreCartId:', error);
    throw error;
  }
};

// Export the additional utility functions
export {
  getCart,
  updateCart,
  checkCartExists,
  getCartsByUserId,
  getCartByBusbudId,
  getAllCarts,
  deleteCart,
  getOrCreateFirestoreCartId
};
