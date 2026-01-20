import express from 'express';
import { list } from '../middleware/manager.js';
import { getPricingSettings } from '../config/runtimeSettings.js';
import { verifyFirebaseAuthPage } from '../middleware/firebaseAuthPage.js';

const router = express.Router();

router.get('/login', (req, res) => {
  const clientUrl = (process.env.CLIENT_URL || '').trim();
  const defaultNext = clientUrl
    ? `${clientUrl.replace(/\/$/, '')}/admin-dashboard`
    : '/admin-dashboard';
  const next = typeof req.query.next === 'string' && req.query.next ? req.query.next : defaultNext;
  const reason = typeof req.query.reason === 'string' ? req.query.reason : '';
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID || ''
  };
  res.render('admin-login', { next, reason, firebaseConfig });
});

router.get('/logout', (req, res) => {
  res.clearCookie('session', { httpOnly: true, sameSite: 'lax', path: '/' });
  const next = typeof req.query.next === 'string' && req.query.next ? req.query.next : '/admin';
  return res.redirect(`/admin/login?next=${encodeURIComponent(next)}`);
});

router.get('/', verifyFirebaseAuthPage, async (req, res) => {
  const middlewares = list();
  const onCount = middlewares.filter(m => m.enabled).length;
  const offCount = middlewares.length - onCount;
  const pricing = getPricingSettings();

  res.render('admin-dashboard', {
    page: 'dashboard',
    middlewares,
    onCount,
    offCount,
    pricing
  });
});

router.get('/users', verifyFirebaseAuthPage, async (req, res) => {
  res.render('admin-users', { page: 'users' });
});

router.get('/register', async (req, res) => {
  const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_APP_ID || process.env.NEXT_PUBLIC_FIREBASE_APP_ID || ''
  };
  res.render('admin-register', { page: 'register', firebaseConfig });
});

export default router;
