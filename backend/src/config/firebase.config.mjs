import admin from 'firebase-admin';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, isAbsolute, join, resolve } from 'path';
import os from 'os';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let firestoreInitialized = false;

const normalizePrivateKey = (pk) => {
  try {
    if (typeof pk !== 'string') return pk;
    let s = pk.trim();
    if (!s) return s;

    // Handle env-var escaping (common in CI providers)
    s = s.replace(/\\n/g, '\n');

    // Some providers store private_key as base64. Detect PEM header absence.
    if (!s.includes('BEGIN PRIVATE KEY') && /^[A-Za-z0-9+/=\r\n]+$/.test(s) && s.length > 256) {
      try {
        const decoded = Buffer.from(s, 'base64').toString('utf8');
        if (decoded.includes('BEGIN PRIVATE KEY')) {
          s = decoded;
        }
      } catch (_) {
        // ignore
      }
    }

    return s;
  } catch (_) {
    return pk;
  }
};

const resolveCredentialsPath = (filePath) => {
  let raw = String(filePath || '').trim();
  if (!raw) return '';

  // dotenv often wraps paths with spaces in quotes. Remove them.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }

  // Support ~/path on Linux/macOS and also works in Git Bash on Windows.
  if (raw.startsWith('~/') || raw.startsWith('~\\')) {
    return resolve(os.homedir(), raw.slice(2));
  }

  // Support relative paths so deployments can mount to a known location inside the app directory.
  if (!isAbsolute(raw)) {
    return resolve(process.cwd(), raw);
  }

  return raw;
};

const normalizeServiceAccount = (obj) => {
  if (!obj || typeof obj !== 'object') return null;
  const out = { ...obj };
  if (typeof out.private_key === 'string') {
    out.private_key = normalizePrivateKey(out.private_key);
  }
  return out;
};

const isValidServiceAccount = (obj) => {
  try {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.client_email || !obj.private_key) return false;
    const pk = String(obj.private_key || '');
    return pk.includes('BEGIN PRIVATE KEY') && pk.includes('END PRIVATE KEY');
  } catch (_) {
    return false;
  }
};

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
        let parsed = null;
        try {
          parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        } catch (_) {
          parsed = null;
        }

        if (!parsed) {
          try {
            const decoded = Buffer.from(String(process.env.FIREBASE_SERVICE_ACCOUNT), 'base64').toString('utf8');
            parsed = JSON.parse(decoded);
          } catch (_) {
            parsed = null;
          }
        }

        serviceAccount = normalizeServiceAccount(parsed);
      } catch (_envParseErr) {
        logger.info('Failed to parse FIREBASE_SERVICE_ACCOUNT env var');
      }
    }

    if (!serviceAccount && process.env.FIREBASE_CREDENTIALS_FILE) {
      const filePath = resolveCredentialsPath(process.env.FIREBASE_CREDENTIALS_FILE);
      try {
        logger.debug('Reading Firebase service account from FIREBASE_CREDENTIALS_FILE', { filePath });
        serviceAccount = normalizeServiceAccount(JSON.parse(await readFile(filePath, 'utf8')));
      } catch (_fileErr) {
        logger.error('Failed to read FIREBASE_CREDENTIALS_FILE', {
          filePath,
          error: _fileErr && _fileErr.message ? _fileErr.message : String(_fileErr),
        });
      }
    }

    // In production, do not silently fall back to a checked-in key file.
    if (!serviceAccount) {
      const isProd = process.env.NODE_ENV === 'production';
      if (isProd) {
        throw new Error('Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_CREDENTIALS_FILE.');
      }

      const serviceAccountPathPrimary = join(process.cwd(), 'serviceAccountKey.json');
      const serviceAccountPathAlt = join(process.cwd(), 'serviceaccountkey.json');
      try {
        logger.debug('Reading service account key file (development fallback)...');
        serviceAccount = normalizeServiceAccount(JSON.parse(await readFile(serviceAccountPathPrimary, 'utf8')));
      } catch (_primaryErr) {
        serviceAccount = normalizeServiceAccount(JSON.parse(await readFile(serviceAccountPathAlt, 'utf8')));
      }
    }

    if (!isValidServiceAccount(serviceAccount)) {
      throw new Error(
        'Invalid Firebase credentials. Ensure the service account JSON contains a valid PEM private_key. ' +
        'Set FIREBASE_SERVICE_ACCOUNT (JSON or base64 JSON) or FIREBASE_CREDENTIALS_FILE.'
      );
    }
    
    // Log minimal service account info (avoid any key material)
    logger.debug('Firebase service account loaded', {
      project_id: serviceAccount && serviceAccount.project_id,
      client_email: serviceAccount && serviceAccount.client_email,
      type: serviceAccount && serviceAccount.type,
    });

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
      logger.error('Firebase credentials file not found (ENOENT).');
    } else if (error.code === 'EACCES') {
      logger.error('Permission denied when accessing Firebase credentials file.');
    } else if (error instanceof SyntaxError) {
      logger.error('Invalid JSON in Firebase credentials.');
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
