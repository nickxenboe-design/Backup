import { getFirestore } from '../config/firebase.config.mjs';
import { logger } from './logger.js';

let dbInstance = null;

/**
 * Get Firestore instance
 * @returns {Promise<object>} Firestore instance
 */
async function getDb() {
  if (!dbInstance) {
    dbInstance = await getFirestore();
  }
  return dbInstance;
}

/**
 * Get the counter reference
 * @returns {Promise<object>} Document reference for the counter
 */
async function getCounterRef() {
  const db = await getDb();
  return db.collection('entity_counters').doc('global_counter');
}

/**
 * Generate a simple incrementing ID using Firestore
 * @returns {Promise<string>} - incrementing ID as string
 * @throws {Error} If Firestore operation fails
 */
export async function generateId() {
  try {
    const counterRef = await getCounterRef();
    const db = await getDb();

    const newId = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(counterRef);
      const currentValue = doc.exists ? (doc.data().lastId || 0) : 0;
      const nextValue = currentValue + 1;

      transaction.set(counterRef, { lastId: nextValue }, { merge: true });
      return nextValue.toString();
    });

    return newId;
  } catch (error) {
    logger.error('Error generating ID from Firestore:', error);
    throw new Error('Failed to generate ID: ' + error.message);
  }
}

// Configuration
const TICKET_TYPES = ['1', '2', '3']; // A: internal, B: online, C: in-store
const BRANCHES = ['01', '02', '03', '04', '05']; // branch codes

/**
 * Generate a cart ID with the format: <TicketType><BranchCode><Counter(6 digits)>
 * Example: 101000001
 * @param {string} ticketType - '1', '2', or '3' (default: '1')
 * @param {string} branchCode - '01' to '05' (default: '01')
 * @returns {Promise<string>} - formatted cart ID
 * @throws {Error} If ID generation fails or inputs are invalid
 */
export async function generateCartId(ticketType = '1', branchCode = '01') {
  // Validate inputs
  if (!TICKET_TYPES.includes(ticketType)) {
    throw new Error(`Invalid ticket type: ${ticketType}. Must be one of: ${TICKET_TYPES.join(', ')}`);
  }
  if (!BRANCHES.includes(branchCode)) {
    throw new Error(`Invalid branch code: ${branchCode}. Must be one of: ${BRANCHES.join(', ')}`);
  }

  try {
    const counterRef = await getCounterRef();
    const db = await getDb();

    // Use Firestore transaction for atomic increment
    const cartId = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      const currentValue = counterDoc.exists ? (counterDoc.data().lastId || 0) : 0;
      const nextValue = currentValue + 1;

      // Update the counter
      transaction.set(counterRef, { lastId: nextValue }, { merge: true });

      // Format the cart ID
      const counterStr = String(nextValue).padStart(6, '0');
      return `${ticketType}${branchCode}${counterStr}`;
    });

    return cartId;
  } catch (error) {
    logger.error('Error generating cart ID:', error);
    throw new Error('Failed to generate cart ID: ' + error.message);
  }
}

/**
 * Reset the counter to 0 in Firestore
 * @returns {Promise<void>}
 * @throws {Error} If reset operation fails
 */
export async function resetCounter() {
  try {
    const counterRef = await getCounterRef();
    await counterRef.set({ lastId: 0 }, { merge: true });
    logger.info('Counter reset to 0 in Firestore');
  } catch (error) {
    logger.error('Error resetting counter in Firestore:', error);
    throw new Error('Failed to reset counter: ' + error.message);
  }
}

/**
 * Get current counter value from Firestore
 * @returns {Promise<number>} - current counter value
 * @throws {Error} If counter retrieval fails
 */
export async function getCurrentCounter() {
  try {
    const counterRef = await getCounterRef();
    const counterDoc = await counterRef.get();

    if (counterDoc.exists) {
      return counterDoc.data().lastId || 0;
    }
    return 0;
  } catch (error) {
    logger.error('Error getting counter from Firestore:', error);
    throw new Error('Failed to get current counter: ' + error.message);
  }
}
