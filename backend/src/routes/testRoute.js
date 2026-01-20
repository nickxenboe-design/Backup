// src/routes/testRoute.js
import express from 'express';

const router = express.Router();

router.get('/test', (req, res) => {
  console.log('✅ Test route hit');
  res.status(200).json({ success: true, message: 'Test route working' });
});

export default router;

console.log('✅ Test route file loaded');
