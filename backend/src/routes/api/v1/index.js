import express from 'express';
import authRoutes from './auth.routes.js';
import searchRoutes from './search.routes.js';
import bookingRoutes from './booking.routes.js';
import userRoutes from './user.routes.js';

const router = express.Router();

// API v1 routes
router.use('/auth', authRoutes);
router.use('/search', searchRoutes);
router.use('/bookings', bookingRoutes);
router.use('/users', userRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', version: 'v1' });
});

export default router;
