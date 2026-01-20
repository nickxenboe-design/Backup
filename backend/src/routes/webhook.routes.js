import express from 'express';
import crypto from 'crypto';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

/**
 * Middleware to verify webhook signature
 */
const verifyWebhook = (req, res, next) => {
  // Get the signature from the header
  const signature = req.headers['x-webhook-signature'];
  
  if (!signature) {
    throw new ApiError('Missing webhook signature', 400);
  }

  // In a real application, verify the webhook signature here
  // const expectedSignature = crypto
  //   .createHmac('sha256', process.env.WEBHOOK_SECRET)
  //   .update(JSON.stringify(req.body))
  //   .digest('hex');

  // if (signature !== expectedSignature) {
  //   throw new ApiError('Invalid webhook signature', 401);
  // }

  next();
};

/**
 * @route   POST /webhook/payment
 * @desc    Handle payment webhook events
 * @access  Public
 */
router.post(
  '/payment',
  express.raw({ type: 'application/json' }),
  verifyWebhook,
  asyncHandler(async (req, res) => {
    const event = req.body;
    
    // Log the webhook event
    logger.info('Received payment webhook event:', {
      type: event.type,
      id: event.id,
    });

    // Process the webhook event
    switch (event.type) {
      case 'payment.succeeded':
        // Handle successful payment
        logger.info('Payment succeeded:', event.data);
        // TODO: Update booking status, send confirmation email, etc.
        break;
        
      case 'payment.failed':
        // Handle failed payment
        logger.warn('Payment failed:', event.data);
        // TODO: Update booking status, notify user, etc.
        break;
        
      case 'charge.refunded':
        // Handle refund
        logger.info('Payment refunded:', event.data);
        // TODO: Update booking status, notify user, etc.
        break;
        
      default:
        logger.info('Unhandled webhook event type:', event.type);
    }

    res.json({ received: true });
  })
);

/**
 * @route   POST /webhook/booking
 * @desc    Handle booking-related webhook events
 * @access  Public
 */
router.post(
  '/booking',
  express.json(),
  verifyWebhook,
  asyncHandler(async (req, res) => {
    const { type, data } = req.body;
    
    // Log the webhook event
    logger.info('Received booking webhook event:', { type });

    // Process the webhook event
    switch (type) {
      case 'booking.confirmed':
        // Handle booking confirmation
        logger.info('Booking confirmed:', data);
        // TODO: Send confirmation email, update booking status, etc.
        break;
        
      case 'booking.cancelled':
        // Handle booking cancellation
        logger.info('Booking cancelled:', data);
        // TODO: Process refund, notify user, update booking status, etc.
        break;
        
      default:
        logger.info('Unhandled booking webhook event type:', type);
    }

    res.json({ received: true });
  })
);

export default router;
