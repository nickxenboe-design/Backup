import express from 'express';
import { getAdminAuth } from '../config/firebase.config.mjs';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { getAdminByEmail } from '../services/admin.service.js';

const router = express.Router();

router.post('/sessionLogin', async (req, res) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) return res.status(400).json({ success: false, error: 'MISSING_ID_TOKEN' });

    const auth = await getAdminAuth();
    // Verify the ID token first to extract the email
    const decoded = await auth.verifyIdToken(idToken, true);
    const email = decoded?.email;
    if (!email) {
      return res.status(401).json({ success: false, error: 'INVALID_ID_TOKEN', message: 'Token has no email' });
    }

    if (!decoded.email_verified) {
      return res.status(403).json({ success: false, error: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before signing in.' });
    }

    // Enforce registration-before-authentication: only registered admins may get a session
    const adminRecord = await getAdminByEmail(email);
    if (!adminRecord || adminRecord.active === false) {
      return res.status(403).json({ success: false, error: 'ADMIN_NOT_REGISTERED', message: 'Contact an administrator to be granted access' });
    }

    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });
    const xfProto = (req.headers['x-forwarded-proto'] || '').toString();
    const isHttps = req.secure || xfProto.includes('https');
    const envOverride = typeof process.env.COOKIE_SECURE === 'string' ? process.env.COOKIE_SECURE.trim().toLowerCase() : '';
    const secure = envOverride
      ? ['true','1','yes','on'].includes(envOverride)
      : isHttps;
    const domain = process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN.trim() ? process.env.COOKIE_DOMAIN.trim() : undefined;

    res.cookie('session', sessionCookie, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      maxAge: expiresIn,
      path: '/',
      domain
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(401).json({ success: false, error: 'INVALID_ID_TOKEN', message: err.message });
  }
});

router.post('/sessionLogout', async (req, res) => {
  try {
    res.clearCookie('session', { httpOnly: true, sameSite: 'lax', path: '/' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'LOGOUT_ERROR', message: err.message });
  }
});

router.get('/me', verifyFirebaseAuth, async (req, res) => {
  const user = {
    uid: req.user.uid,
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture,
    email_verified: req.user.email_verified,
    phone_number: req.user.phone_number
  };
  return res.json({ success: true, user });
});

export default router;
