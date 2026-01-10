import express from 'express';
import { param, validationResult } from 'express-validator';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../middlewares/errorHandler.js';
import busbudService from '../services/busbud.service.mjs';

const router = express.Router();

/**
 * @route   GET /details/:id
 * @desc    Get trip details by ID
 * @access  Public
 */
router.get(
  '/:id',
  [
    param('id')
      .notEmpty()
      .withMessage('Trip ID is required')
      .isMongoId()
      .withMessage('Invalid trip ID format')
  ],
  asyncHandler(async (req, res) => {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const formattedErrors = errors.array().map(err => ({
        field: err.param,
        message: err.msg,
        value: err.value
      }));
      throw new ApiError('Validation failed', 400, formattedErrors);
    }

    const { id } = req.params;
    const details = await busbudService.getTripDetails(id);
    
    if (!details) {
      throw new ApiError('Trip not found', 404);
    }
    
    res.json({
      success: true,
      data: details
    });
  })
);

export default router;
