import express from 'express';
import searchRoutes from './search.js';
import detailsRoutes from './details.js';
import webhookRoutes from './webhook.js';
import selectTripsRoutes from './selectTrips.js';
import cartRoutes from './cart.routes.js';
import bookingRoutes from './booking.routes.js';
import purchaseRoutes from './purchase.js';
import apiRoutes from './api.routes.js';
import chatbotRoutes from './chatbot.routes.js';
import adminReportsRoutes from './adminReports.routes.js';
import { notFound } from '../middlewares/errorHandler.js';
import { query as pgQuery } from '../config/postgres.js';

const router = express.Router();

// API Routes
router.use('/search', searchRoutes);
router.use('/details', detailsRoutes);
router.use('/trips', selectTripsRoutes);
router.use('/carts', cartRoutes);
router.use('/bookings', bookingRoutes);
router.use('/purchase', purchaseRoutes);
router.use('/admin/reports', adminReportsRoutes);

// Frontend API Routes
router.use('/api', apiRoutes);

// Chatbot API Routes
router.use('/chatbot', chatbotRoutes);

// Webhook Routes
router.use('/webhook', webhookRoutes);

// Health check
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Database health check
router.get('/db-health', async (req, res) => {
  try {
    await pgQuery('SELECT 1');
    return res.status(200).json({ status: 'ok', database: 'postgres' });
  } catch (error) {
    return res.status(500).json({ status: 'error', database: 'postgres', error: error.message });
  }
});

// 404 handler
router.use(notFound);

export default router;
