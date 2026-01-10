import express from 'express';
import { query } from 'express-validator';
import { asyncHandler } from '../middlewares/errorHandler.js';
import { validate } from '../middlewares/validate.middleware.js';
import { ApiError } from '../utils/apiError.js';

const router = express.Router();

// Validation rules
const searchRoutesValidation = [
  query('origin')
    .trim()
    .notEmpty()
    .withMessage('Origin is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Origin must be between 2 and 100 characters'),
  query('destination')
    .trim()
    .notEmpty()
    .withMessage('Destination is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Destination must be between 2 and 100 characters'),
  query('date')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format. Use YYYY-MM-DD')
];

const scheduleValidation = [
  query('routeId')
    .optional()
    .isString()
    .withMessage('Invalid route ID'),
  query('date')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format. Use YYYY-MM-DD'),
  query('operator')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Operator name must be less than 100 characters')
];

/**
 * @route   GET /api/search/routes
 * @desc    Search for available bus routes
 * @access  Public
 */
router.get(
  '/routes',
  searchRoutesValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { origin, destination, date } = req.query;
    
    // TODO: Implement actual search logic with searchService
    // const routes = await searchService.findRoutes(origin, destination, date);
    
    // Simulate empty response for now
    const routes = [];
    
    if (routes.length === 0) {
      throw new ApiError('No routes found for the specified criteria', 404);
    }
    
    res.status(200).json({
      success: true,
      count: routes.length,
      data: routes
    });
  })
);

/**
 * @route   GET /api/search/schedule
 * @desc    Search for bus schedules
 * @access  Public
 */
router.get(
  '/schedule',
  scheduleValidation,
  validate,
  asyncHandler(async (req, res) => {
    const { routeId, date, operator } = req.query;
    
    // TODO: Implement actual schedule search logic with searchService
    // const schedules = await searchService.findSchedules({ routeId, date, operator });
    
    // Simulate empty response for now
    const schedules = [];
    
    if (schedules.length === 0) {
      throw new ApiError('No schedules found for the specified criteria', 404);
    }
    
    res.status(200).json({
      success: true,
      count: schedules.length,
      data: schedules
    });
  })
);

export default router;
