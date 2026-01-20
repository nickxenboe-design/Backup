import admin from 'firebase-admin';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let firestoreInitialized = false;

const initializeFirebase = async () => {
  if (firestoreInitialized) {
    logger.debug('Firebase already initialized, returning existing instance');
    return admin.firestore();
  }

  const startTime = Date.now();
  
  try {
    logger.info('Initializing Firebase Admin SDK...');
    
    let serviceAccount = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      logger.debug('Attempting to use FIREBASE_SERVICE_ACCOUNT environment variable');
      try {
        const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (parsed && typeof parsed.private_key === 'string') {
          parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
        }
        serviceAccount = parsed;
        logger.debug('Service account loaded from environment variable');
      } catch (envParseErr) {
        logger.info('Failed to parse FIREBASE_SERVICE_ACCOUNT env var, falling back to file');
      }
    }

    if (!serviceAccount) {
      const serviceAccountPathPrimary = join(process.cwd(), 'serviceAccountKey.json');
      const serviceAccountPathAlt = join(process.cwd(), 'serviceaccountkey.json');
      let pathUsed = serviceAccountPathPrimary;
      try {
        logger.debug('Reading service account key file...');
        serviceAccount = JSON.parse(await readFile(serviceAccountPathPrimary, 'utf8'));
        logger.debug(`Using service account key from: ${serviceAccountPathPrimary}`);
      } catch (primaryErr) {
        logger.debug('Primary service account file not found or unreadable, trying alternate casing');
        serviceAccount = JSON.parse(await readFile(serviceAccountPathAlt, 'utf8'));
        pathUsed = serviceAccountPathAlt;
        logger.debug(`Using service account key from: ${pathUsed}`);
      }
    }
    
    // Log basic service account info (without sensitive data)
    const safeServiceAccountInfo = {
      project_id: serviceAccount.project_id,
      client_email: serviceAccount.client_email,
      type: serviceAccount.type,
      private_key_id: serviceAccount.private_key_id ? '***REDACTED***' : undefined
    };
    logger.debug('Service account info:', safeServiceAccountInfo);

    // Initialize the Firebase Admin SDK if it hasn't been initialized yet
    if (admin.apps.length === 0) {
      logger.debug('Initializing new Firebase Admin app instance...');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      
      const firestore = admin.firestore();
      
      // Configure Firestore settings if needed
      firestore.settings({
        ignoreUndefinedProperties: true
      });
      
      const initTime = Date.now() - startTime;
      logger.info(`✅ Firebase Admin SDK initialized successfully in ${initTime}ms`);
      logger.debug(`Firestore instance created at ${new Date().toISOString()}`);
      
      firestoreInitialized = true;
      return firestore;
    } else {
      logger.debug('Using existing Firebase Admin app instance');
      firestoreInitialized = true;
      return admin.firestore();
    }
  } catch (error) {
    const errorTime = Date.now() - startTime;
    logger.error(`❌ Failed to initialize Firebase after ${errorTime}ms`, {
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    
    // More detailed error handling
    if (error.code === 'ENOENT') {
      logger.error('Service account key file not found. Please ensure serviceAccountKey.json exists in the root directory.');
    } else if (error.code === 'EACCES') {
      logger.error('Permission denied when accessing service account key file.');
    } else if (error instanceof SyntaxError) {
      logger.error('Invalid JSON in service account key file.');
    }
    
    throw new Error(`Failed to initialize Firebase: ${error.message}`);
  }
};

// Create a singleton instance
export const getFirestore = async () => {
  return initializeFirebase();
};

export default {
  getFirestore
};

// Get Firebase Admin Auth instance, ensuring app is initialized
export const getAdminAuth = async () => {
  await initializeFirebase();
  return admin.auth();
};
