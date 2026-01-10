import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validate } from '../middlewares/validate.middleware.js';
import bookingController from '../controllers/booking.controller.js';

const router = Router();

// Create booking from cart (disabled)
router.post(
  '/from-cart/:cartId',
  (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Cart functionality is currently disabled',
      data: {}
    });
  }
);

// Get booking by ID (protected)
router.get(
  '/:id',
  [param('id').isString().notEmpty().withMessage('Booking ID is required')],
  validate,
  bookingController.getBooking
);

// Get user's bookings (protected)
router.get(
  '/',
  [
    query('status').optional().isIn(['pending', 'confirmed', 'cancelled', 'completed']),
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
    query('page').optional().isInt({ min: 1 }).toInt()
  ],
  validate,
  bookingController.getUserBookings
);

// Cancel booking (protected)
router.post(
  '/:id/cancel',
  [
    param('id').isString().notEmpty().withMessage('Booking ID is required'),
    body('reason').optional().isString()
  ],
  validate,
  bookingController.cancelBooking
);

// Get booking confirmation (public)
router.get(
  '/:id/confirmation',
  [param('id').isString().notEmpty().withMessage('Booking ID is required')],
  validate,
  bookingController.getConfirmation
);

// Webhook for payment notifications (public)
router.post(
  '/webhook/payment',
  express.raw({ type: 'application/json' }),
  bookingController.handlePaymentWebhook
);

export default router;
