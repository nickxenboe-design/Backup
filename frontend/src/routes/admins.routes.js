import express from 'express';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';
import { addAdmin, listAdmins, getAdminByEmail } from '../services/admin.service.js';
import { getAdminAuth } from '../config/firebase.config.mjs';
import { sendEmail } from '../utils/email.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Public pre-check: verify if an email is registered and active
router.post('/check', async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'MISSING_EMAIL' });
  }
  const adm = await getAdminByEmail(email);
  return res.json({ success: true, exists: !!adm, active: !!(adm && adm.active !== false) });
});

// List admins - any registered admin
router.get('/', verifyFirebaseAuth, requireRegisteredAdminApi, async (req, res) => {
  const admins = await listAdmins();
  return res.json({ success: true, data: admins });
});

// View my admin record - any registered admin
router.get('/me', verifyFirebaseAuth, requireRegisteredAdminApi, async (req, res) => {
  const me = await getAdminByEmail(req.user.email);
  return res.json({ success: true, data: me });
});

// Add admin - public registration (pre-auth)
router.post('/', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ success: false, error: 'MISSING_EMAIL' });
  try {
    const created = await addAdmin(email, null);
    return res.status(201).json({ success: true, data: created });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

// Full registration: create Firebase Auth user, add to admins, and send verification email
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'MISSING_EMAIL' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ success: false, error: 'INVALID_PASSWORD', message: 'Password must be at least 6 characters' });
    }

    const auth = await getAdminAuth();

    let userRecord;
    try {
      userRecord = await auth.createUser({ email, password, emailVerified: false, disabled: false });
    } catch (e) {
      // If user already exists, try to fetch and proceed to sending verification
      if (e && e.code === 'auth/email-already-exists') {
        userRecord = await auth.getUserByEmail(email);
      } else {
        throw e;
      }
    }

    // Ensure admin record exists
    try {
      await addAdmin(email, null);
    } catch (e) {
      // ignore if already exists
    }

    // Generate verification link
    let verificationLink;
    try {
      const url = process.env.CLIENT_URL;
      if (url && /^https?:\/\//i.test(url)) {
        verificationLink = await auth.generateEmailVerificationLink(email, { url, handleCodeInApp: false });
      } else {
        verificationLink = await auth.generateEmailVerificationLink(email);
      }
    } catch (e) {
      // Fallback: try without actionCodeSettings (uses default auth domain)
      try {
        verificationLink = await auth.generateEmailVerificationLink(email);
      } catch (e2) {
        throw new Error('Failed to generate verification link. Ensure CLIENT_URL is a valid URL and your domain is authorized in Firebase Authentication settings.');
      }
    }

    // Send verification email
    const html = `<div>
      <p>Hello,</p>
      <p>Please verify your email to activate your admin account.</p>
      <p><a href="${verificationLink}">Verify Email</a></p>
      <p>If the button does not work, copy and paste this URL into your browser:</p>
      <p>${verificationLink}</p>
    </div>`;
    try {
      await sendEmail({ to: email, subject: 'Verify your email', html });
      return res.status(201).json({ success: true, verificationSent: true });
    } catch (e) {
      logger.warn('Failed to send verification email; returning link for manual verification in non-production', { error: e?.message });
      const expose = process.env.NODE_ENV !== 'production';
      const payload = { success: true, verificationSent: false };
      if (expose) payload.verificationLink = verificationLink;
      return res.status(201).json(payload);
    }
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
