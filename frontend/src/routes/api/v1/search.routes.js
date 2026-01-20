import express from 'express';
import { body, query } from 'express-validator';
import { 
  searchTrips,
  getTripDetails,
  getAvailableSeats,
  getLocations
} from '../../../api/v1/search/search.controller.js';
import { validateRequest } from '../../../middlewares/validateRequest.js';
import { authenticate } from '../../../middlewares/auth.js';

const router = express.Router();

// Get available locations (cities, terminals, etc.)
router.get('/locations', getLocations);

// Search for available trips
router.get(
  '/trips',
  [
    query('from').isString().notEmpty().withMessage('Origin is required'),
    query('to').isString().notEmpty().withMessage('Destination is required'),
    query('date').isISO8601().withMessage('Valid date is required'),
    query('passengers').optional().isInt({ min: 1 }).withMessage('Number of passengers must be at least 1')
  ],
  validateRequest,
  searchTrips
);

// Get trip details
router.get(
  '/trips/:tripId',
  [
    query('date').isISO8601().withMessage('Valid date is required')
  ],
  validateRequest,
  getTripDetails
);

// Get available seats for a specific trip
router.get(
  '/trips/:tripId/seats',
  [
    query('date').isISO8601().withMessage('Valid date is required')
  ],
  validateRequest,
  getAvailableSeats
);

// Get popular routes
router.get('/routes/popular', (req, res) => {
  // Implementation will be added later
  res.json({ message: 'List of popular routes will be returned here' });
});

export default router;
