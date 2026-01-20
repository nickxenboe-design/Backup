import express from 'express';
import { body, param } from 'express-validator';
import { 
  createBooking,
  getBooking,
  getUserBookings,
  cancelBooking,
  makePayment,
  verifyPayment,
  downloadTicket
} from '../../../api/v1/booking/booking.controller.js';
import { validateRequest } from '../../../middlewares/validateRequest.js';
import { authenticate } from '../../../middlewares/auth.js';

const router = express.Router();

// All routes after this middleware are protected
router.use(authenticate);

// Create a new booking
router.post(
  '/',
  [
    body('tripId').isMongoId().withMessage('Valid trip ID is required'),
    body('date').isISO8601().withMessage('Valid travel date is required'),
    body('passengers')
      .isArray({ min: 1 })
      .withMessage('At least one passenger is required'),
    body('passengers.*.name')
      .isString()
      .notEmpty()
      .withMessage('Passenger name is required'),
    body('passengers.*.age').isInt({ min: 1 }).withMessage('Valid age is required'),
    body('passengers.*.seatNumber')
      .isString()
      .notEmpty()
      .withMessage('Seat number is required'),
    body('contactEmail').isEmail().withMessage('Valid contact email is required'),
    body('contactPhone')
      .isString()
      .notEmpty()
      .withMessage('Contact phone number is required')
  ],
  validateRequest,
  createBooking
);

// Get booking details
router.get('/:bookingId', getBooking);

// Get user's bookings
router.get('/', getUserBookings);

// Cancel a booking
router.patch(
  '/:bookingId/cancel',
  [param('bookingId').isMongoId().withMessage('Valid booking ID is required')],
  validateRequest,
  cancelBooking
);

// Initiate payment for a booking
router.post(
  '/:bookingId/pay',
  [
    param('bookingId').isMongoId().withMessage('Valid booking ID is required'),
    body('paymentMethod')
      .isIn(['card', 'mobile_money', 'bank_transfer'])
      .withMessage('Valid payment method is required')
  ],
  validateRequest,
  makePayment
);

// Verify payment
router.post(
  '/:bookingId/verify-payment',
  [
    param('bookingId').isMongoId().withMessage('Valid booking ID is required'),
    body('reference')
      .isString()
      .notEmpty()
      .withMessage('Payment reference is required')
  ],
  validateRequest,
  verifyPayment
);

// Download ticket
router.get(
  '/:bookingId/ticket',
  [param('bookingId').isMongoId().withMessage('Valid booking ID is required')],
  validateRequest,
  downloadTicket
);

export default router;
