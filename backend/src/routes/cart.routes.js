import express from 'express';
import { query, validationResult } from 'express-validator';
import busbudService from '../services/busbud.service.mjs';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { ApiError } from '../utils/apiError.js';
import { success, error } from '../utils/response.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route   GET /api/trips/search
 * @desc    Search for trips
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
      throw new ApiError('Validation failed', 400, errors.array());
    }

    const { origin, destination, date, adults = 1, children = 0, seniors = 0 } = req.query;

    try {
      const results = await busbudService.search(origin, destination, date, {
        adults: parseInt(adults),
        children: parseInt(children),
        seniors: parseInt(seniors)
      });

      return success(res, { 
        data: results,
        message: 'Trips retrieved successfully'
      });
    } catch (error) {
      logger.error('Trip search error:', { 
        error: error.message,
        stack: error.stack,
        query: req.query
      });
      throw error; // Let the error handler handle it
    }
  })
);

export default router;