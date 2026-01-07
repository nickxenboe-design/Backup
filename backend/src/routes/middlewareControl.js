import express from 'express';
import { list, set, get } from '../middleware/manager.js';

const router = express.Router();

router.get('/', (req, res) => {
  const middlewares = list();
  res.render('middleware-panel', { page: 'middleware', middlewares });
});

router.post('/toggle', (req, res) => {
  const { name, enabled } = req.body || {};
  if (typeof name !== 'string') return res.status(400).send('name required');
  const flag = enabled === 'true' || enabled === '1' || enabled === 'on';
  set(name, flag);
  const ref = req.get('Referrer') || '/admin/middleware';
  res.redirect(ref);
});

router.get('/toggle', (req, res) => {
  const { name, enabled } = req.query || {};
  if (typeof name !== 'string') return res.status(400).send('name required');
  const flag = enabled === 'true' || enabled === '1' || enabled === 'on';
  set(name, flag);
  const ref = req.get('Referrer') || '/admin/middleware';
  res.redirect(ref);
});

export default router;
