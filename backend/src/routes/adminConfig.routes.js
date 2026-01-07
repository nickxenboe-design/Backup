import express from 'express';
import verifyFirebaseAuth from '../middleware/firebaseAuth.js';
import { requireRegisteredAdminApi } from '../middleware/adminAccess.js';
import { list, set } from '../middleware/manager.js';
import { getAllSettings, updatePricingSettings } from '../config/runtimeSettings.js';

const router = express.Router();

router.use(verifyFirebaseAuth, requireRegisteredAdminApi);

router.get('/', (req, res) => {
  try {
    const middlewares = list();
    const settings = getAllSettings();
    return res.json({ success: true, data: { middlewares, settings } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'LOAD_FAILED', message: err?.message || 'Failed to load admin configuration' });
  }
});

router.post('/middleware', async (req, res) => {
  try {
    const { name, enabled } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'INVALID_NAME', message: 'Middleware name is required' });
    }
    const flag = enabled === true || enabled === 'true' || enabled === '1' || enabled === 'on';
    set(name, flag);
    const middlewares = list();
    return res.json({ success: true, data: { middlewares } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'TOGGLE_FAILED', message: err?.message || 'Failed to update middleware' });
  }
});

router.post('/pricing', async (req, res) => {
  try {
    const body = req.body || {};
    await updatePricingSettings(body);
    const settings = getAllSettings();
    return res.json({ success: true, data: settings.pricing });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'PRICING_UPDATE_FAILED', message: err?.message || 'Failed to update pricing settings' });
  }
});

export default router;
