import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { ApiError } from '../utils/apiError.js';
import busbudService from '../services/busbud.service.mjs';
import logger from '../utils/logger.js';

// Middleware to log request payloads
const logRequestPayload = (req, res, next) => {
  if (req.body && Object.keys(req.body).length > 0) {
    logger.info('Request Payload:', {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      body: req.body,
      query: req.query,
      params: req.params,
      headers: {
        'content-type': req.get('content-type'),
        'user-agent': req.get('user-agent'),
        'x-forwarded-for': req.get('x-forwarded-for')
      }
    });
  }
  next();
};

const router = express.Router();

// Apply the logging middleware to all routes
router.use(express.json()); // Make sure body is parsed first
router.use(logRequestPayload);
import { logger } from '../utils/logger.js';

/**
 * @route   GET /api/search
 * @desc    Search for trips (frontend API)
 * @access  Public
 */
router.get(
  '/search',
  [
    query('origin').notEmpty().withMessage('Origin is required'),
    query('destination').notEmpty().withMessage('Destination is required'),
    query('date').isISO8601().withMessage('Invalid date format. Use YYYY-MM-DD'),
    query('adults').optional().isInt({ min: 1, max: 10 }).withMessage('Adults must be between 1 and 10'),
    query('children').optional().isInt({ min: 0, max: 10 }).withMessage('Children must be between 0 and 10'),
    query('seniors').optional().isInt({ min: 0, max: 10 }).withMessage('Seniors must be between 0 and 10')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { origin, destination, date, adults = 1, children = 0, seniors = 0 } = req.query;
    
    try {
      const requestId = req.id || `req_${Date.now()}`;
      logger.info(`[Search] Starting search`, { 
        requestId, 
        origin, 
        destination, 
        date,
        adults,
        children,
        seniors 
      });

      let results = await busbudService.search(origin, destination, date, {
        adults: parseInt(adults),
        children: parseInt(children),
        seniors: parseInt(seniors)
      });

      logger.info(`[Search] Search completed`, { 
        requestId,
        resultCount: results?.trips?.length || 0 
      });

      res.json({
        success: true,
        data: results,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`[Search] Search failed`, { 
        requestId: req.id,
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      throw error; // Let the error handler middleware handle it
      throw new ApiError('Failed to search for trips', 500);
    }
  })
);

/**
 * @route   POST /api/carts
 * @desc    Create a new cart
 * @access  Public
 */
router.post(
  '/carts',
  [
    body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).withMessage('Invalid currency')
  ],
  asyncHandler(async (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Cart functionality is currently disabled',
      data: {}
    });
  })
);

/**
 * @route   GET /api/carts/:cartId
 * @desc    Get cart details
 * @access  Public
 */
router.get(
  '/carts/:cartId',
  [
    param('cartId').notEmpty().withMessage('Cart ID is required')
  ],
  asyncHandler(async (req, res) => {
    const { cartId } = req.params;
    
    try {
      const cart = await busbudService.getCart(cartId);
      
      if (!cart) {
        throw new ApiError('Cart not found', 404);
      }
      
      res.json({
        success: true,
        data: cart,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Frontend get cart error:', error);
      throw new ApiError('Failed to get cart', 500);
    }
  })
);

/**
 * @route   GET /api/trips/:id
 * @desc    Get trip details (frontend API)
 * @access  Public
 */
router.get(
  '/trips/:id',
  [
    param('id').notEmpty().withMessage('Trip ID is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;

    try {
      const details = await busbudService.getTripDetails(id);

      if (!details) {
        throw new ApiError('Trip not found', 404);
      }

      res.json({
        success: true,
        data: details,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      console.error('Frontend trip details error:', error);
      throw new ApiError('Failed to fetch trip details', 500);
    }
  })
);

/**
 * @route   GET /api/carts/:cartId
 * @desc    Get cart details (frontend API)
 * @access  Public
 */
router.get(
  '/carts/:cartId',
  [
    param('cartId').notEmpty().withMessage('Cart ID is required')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { cartId } = req.params;

    try {
      const cart = await busbudService.getCart(cartId);

      res.json({
        success: true,
        data: cart,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Frontend get cart error:', error);
      throw new ApiError('Failed to fetch cart details', 500);
    }
  })
);

/**
 * @route   POST /api/carts/:cartId/items
 * @desc    Add trip to cart (frontend API)
 * @access  Public
 */
router.post(
  '/carts/:cartId/items',
  [
    param('cartId').notEmpty().withMessage('Cart ID is required'),
    body().custom((value, { req }) => {
      // Validate either tripId or roundTrip is present
      if (!req.body.tripId && !req.body.roundTrip) {
        throw new Error('Either tripId or roundTrip must be provided');
      }
      if (req.body.tripId && req.body.roundTrip) {
        throw new Error('Cannot specify both tripId and roundTrip');
      }
      return true;
    }),
    body('passengers').optional().isArray().withMessage('Passengers must be an array'),
    body('roundTrip').optional().isObject().withMessage('Round trip must be an object')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { cartId } = req.params;
    const { tripId, passengers = [{ category: 'adult', wheelchair: false, discounts: [] }], roundTrip } = req.body;

    try {
      let cartItem;
      
      if (roundTrip) {
        // Handle round trip
        const { outboundTripId, returnTripId, outboundPassengers, returnPassengers } = roundTrip;
        cartItem = await busbudService.addRoundTripToCart(
          cartId,
          outboundTripId,
          returnTripId,
          outboundPassengers || passengers,
          returnPassengers || outboundPassengers || passengers
        );
      } else {
        // Handle one-way trip
        cartItem = await busbudService.addTripToCart(cartId, tripId, passengers);
      }

      res.status(201).json({
        success: true,
        data: cartItem,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Add to cart error:', error);
      throw new ApiError(error.message || 'Failed to add trip to cart', error.statusCode || 500);
    }
  })
);

/**
 * @route   POST /api/purchase
 * @desc    Create purchase (frontend API)
 * @access  Public
 */
router.post(
  '/purchase',
  [
    body('cartId').notEmpty().withMessage('Cart ID is required'),
    body('returnUrl').optional().isURL().withMessage('Invalid return URL'),
    body('locale').optional().isLength({ min: 2, max: 5 }).withMessage('Invalid locale format'),
    body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'CAD', 'AUD']).withMessage('Invalid currency')
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { cartId, returnUrl, locale = 'en-ca', currency = 'USD' } = req.body;

    try {
      const purchase = await busbudService.createPurchase(cartId, {
        returnUrl,
        locale,
        currency
      });

      res.status(201).json({
        success: true,
        data: purchase,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Frontend purchase error:', error);

      // Handle specific error cases
      if (error.message.includes('expired')) {
        throw new ApiError('Cart has expired. Please create a new cart and try again.', 410);
      }

      throw new ApiError('Failed to create purchase', 500);
    }
  })
);

export default router;
