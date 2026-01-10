import express from 'express';
import { listPassengerTypes } from '../services/eagleliner/passengerTypes.service.js';

const router = express.Router();

router.get('/passenger-types', async (req, res) => {
  try {
    const data = await listPassengerTypes();
    return res.json(data);
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ ok: false, message: err.message || 'Failed to list passenger types' });
  }
});

export default router;
