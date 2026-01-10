import { validationResult, body, param, query } from 'express-validator';
import logger from '../utils/logger.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Middleware to validate request data
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    logger.warn('Validation failed:', { 
      url: req.originalUrl, 
      errors: errors.array() 
    });
    
    return next(new ApiError('Validation failed', 400, errors.array()));
  }
  
  next();
};

/**
 * Middleware to validate request using express-validator
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(err => ({
      field: err.param,
      message: err.msg,
      value: err.value
    }));
    
    logger.warn('Request validation failed', {
      url: req.originalUrl,
      method: req.method,
      errors: formattedErrors
    });
    
    return next(new ApiError('Validation failed', 400, formattedErrors));
  }
  
  next();
};

/**
 * Middleware factory for validating ID parameters (works with string IDs)
 * @param {string} paramName - Name of the parameter to validate
 * @returns {Array} Express-validator validation chain
 */
const validateObjectId = (paramName) => [
  param(paramName)
    .isString()
    .withMessage('ID must be a string')
    .notEmpty()
    .withMessage('ID is required')
];

/**
 * Middleware to validate pagination query parameters
 * @returns {Array} Express-validator validation chain
 */
const validatePagination = () => [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100')
    .toInt()
];

/**
 * Middleware to validate sorting query parameters
 * @param {Array} allowedFields - Array of allowed field names for sorting
 * @returns {Array} Express-validator validation chain
 */
const validateSorting = (allowedFields = []) => [
  query('sortBy')
    .optional()
    .isIn(allowedFields)
    .withMessage(`Sort field must be one of: ${allowedFields.join(', ')}`),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be either "asc" or "desc"')
];

/**
 * Middleware to validate file uploads
 * @param {string} fieldName - Name of the file field
 * @param {Array} allowedTypes - Allowed MIME types
 * @param {number} maxSize - Maximum file size in bytes
 * @returns {Function} Express middleware function
 */
const validateFileUpload = (fieldName, allowedTypes = [], maxSize = 5 * 1024 * 1024) => {
  return (req, res, next) => {
    if (!req.file) {
      return next(new ApiError(`No ${fieldName} file uploaded`, 400));
    }

    if (allowedTypes.length > 0 && !allowedTypes.includes(req.file.mimetype)) {
      return next(new ApiError(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`, 400));
    }

    if (req.file.size > maxSize) {
      return next(new ApiError(`File size exceeds the maximum allowed size of ${maxSize / 1024 / 1024}MB`, 400));
    }

    next();
  };
};

/**
 * Middleware to validate IDs in request parameters (works with string IDs)
 * @param  {...string} params - Parameter names to validate as IDs
 * @returns {import('express').RequestHandler} Express middleware function
 */
const validateMongoIds = (...params) => {
  return (req, res, next) => {
    const errors = [];
    
    params.forEach(param => {
      const value = req.params[param];
      if (value && (typeof value !== 'string' || value.trim() === '')) {
        errors.push({
          field: param,
          message: 'Invalid ID format',
          value
        });
      }
    });
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors
      });
    }
    
    next();
  };
};

/**
 * Middleware to validate request body against a schema
 * @param {Object} schema - Joi validation schema
 * @returns {import('express').RequestHandler} Express middleware function
 */
const validateSchema = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        type: detail.type
      }));
      
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        errors
      });
    }
    
    next();
  };
};

/**
 * Validator for cart items
 */
const validateCartItem = [
  body('tripId').isString().withMessage('Trip ID is required'),
  body('origin').isString().withMessage('Origin is required'),
  body('destination').isString().withMessage('Destination is required'),
  body('departureDate').isISO8601().withMessage('Invalid departure date'),
  body('passengers')
    .isArray({ min: 1 })
    .withMessage('At least one passenger is required'),
  body('passengers.*.name')
    .isString()
    .withMessage('Passenger name is required'),
  body('passengers.*.age')
    .isInt({ min: 0 })
    .withMessage('Passenger age must be a positive number'),
];

/**
 * Validator for booking creation
 */
const validateBooking = [
  body('payment').isObject().withMessage('Payment details are required'),
  body('payment.method').isString().withMessage('Payment method is required'),
  body('payment.card').optional().isObject().withMessage('Card details must be an object'),
  body('contactInfo').isObject().withMessage('Contact information is required'),
  body('contactInfo.email').isEmail().withMessage('Valid email is required'),
];

/**
 * Validator for cart status update
 */
const validateCartStatus = [
  body('status')
    .isString()
    .isIn(['active', 'completed', 'cancelled'])
    .withMessage('Invalid cart status'),
];

/**
 * Validator for cart expiration extension
 */
const validateExtendExpiration = [
  body('minutes')
    .optional()
    .isInt({ min: 1, max: 1440 })
    .withMessage('Expiration extension must be between 1 and 1440 minutes'),
];

/**
 * Validator for booking cancellation
 */
const validateCancelBooking = [
  body('reason')
    .optional()
    .isString()
    .withMessage('Cancellation reason must be a string'),
];

/**
 * Validator for query parameters
 */
const validateQueryParams = [
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'cancelled', 'completed'])
    .withMessage('Invalid status value'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),
];

/**
 * Validator for ID parameters
 */
const validateIdParam = [
  param('id')
    .isString()
    .withMessage('Invalid ID format')
    .notEmpty()
    .withMessage('ID is required')
];

/**
 * Validator for cart ID parameter
 */
const validateCartIdParam = [
  param('cartId')
    .isString()
    .withMessage('Invalid cart ID format')
    .notEmpty()
    .withMessage('Cart ID is required')
];

/**
 * Validator for item ID parameter
 */
const validateItemIdParam = [
  param('itemId')
    .isString()
    .withMessage('Invalid item ID format')
    .notEmpty()
    .withMessage('Item ID is required')
];

export {
  validate,
  validateRequest,
  validateObjectId,
  validatePagination,
  validateSorting,
  validateFileUpload,
  validateMongoIds,
  validateSchema,
  validateCartItem,
  validateBooking,
  validateCartStatus,
  validateExtendExpiration,
  validateCancelBooking,
  validateQueryParams,
  validateIdParam,
  validateCartIdParam,
  validateItemIdParam
};