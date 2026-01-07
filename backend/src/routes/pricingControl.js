import express from 'express';
import { getPricingSettings, updatePricingSettings } from '../config/runtimeSettings.js';

const router = express.Router();

router.get('/', (req, res) => {
  const pricing = getPricingSettings();
  res.render('pricing-panel', { page: 'pricing', pricing });
});

router.post('/update', async (req, res) => {
  const body = req.body || {};
  const apply = body.apply ? 'on' : 'off';
  await updatePricingSettings({
    commission: body.commission ?? body.percentage,
    fixed: body.fixed,
    roundToNearest: body.roundToNearest,
    apply,
    discount: body.discount,
    markup: body.markup,
    charges: body.charges
  });
  const ref = req.get('Referrer') || '/admin/pricing';
  res.redirect(ref);
});

// Fallback when body parser is disabled
router.get('/update', async (req, res) => {
  const q = req.query || {};
  const apply = q.apply ? q.apply : 'off';
  await updatePricingSettings({
    commission: q.commission ?? q.percentage,
    fixed: q.fixed,
    roundToNearest: q.roundToNearest,
    apply,
    discount: q.discount,
    markup: q.markup,
    charges: q.charges
  });
  const ref = req.get('Referrer') || '/admin/pricing';
  res.redirect(ref);
});

export default router;
