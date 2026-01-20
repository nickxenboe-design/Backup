import { validationResult } from 'express-validator';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware to validate request using express-validator
 * @param {Array} validations - Array of validation chains
 * @param {Object} options - Options
 * @param {boolean} options.failFast - Stop validation on first error
 * @returns {Function} Express middleware
 */
export const validateRequest = (validations = [], { failFast = true } = {}) => {
  return async (req, res, next) => {
    const requestId = req.id || `req_${Date.now()}`;
    const log = (level, message, data = {}) => {
      logger[level](`[Validation] ${message}`, { requestId, ...data });
    };

    try {
      // Run all validations
      await Promise.all(validations.map(validation => validation.run(req)));

      const errors = validationResult(req);
      
      if (errors.isEmpty()) {
        return next();
      }

      const errorList = errors.array();
      log('warn', 'Validation failed', { errors: errorList });

      // If failFast is true, return only the first error
      const errorMessages = failFast 
        ? [errorList[0].msg]
        : errorList.map(err => err.msg);

      // Use the first specific validation message as the main error message
      const primaryMessage = errorMessages[0] || 'Validation failed';
      next(ApiError.badRequest(primaryMessage, errorMessages));
    } catch (error) {
      log('error', 'Validation error', { 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      next(ApiError.internal('Error validating request'));
    }
  };
};

/**
 * Middleware to validate request body against a schema using Joi
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Options
 * @param {boolean} options.abortEarly - Stop validation on first error
 * @returns {Function} Express middleware
 */
export const validateSchema = (schema, { abortEarly = false } = {}) => {
  return async (req, res, next) => {
    const requestId = req.id || `req_${Date.now()}`;
    const log = (level, message, data = {}) => {
      logger[level](`[SchemaValidation] ${message}`, { requestId, ...data });
    };

    try {
      const { error, value } = schema.validate(req.body, { 
        abortEarly,
        stripUnknown: true
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        log('warn', 'Schema validation failed', { errors: errorMessages });
        return next(ApiError.badRequest('Invalid request data', errorMessages));
      }

      // Replace req.body with the validated value
      req.body = value;
      next();
    } catch (error) {
      log('error', 'Schema validation error', { 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      next(ApiError.internal('Error validating request schema'));
    }
  };
};

/**
 * Middleware to validate request parameters
 * @param {Object} paramSchema - Schema for request parameters
 * @returns {Function} Express middleware
 */
export const validateParams = (paramSchema) => {
  return async (req, res, next) => {
    const requestId = req.id || `req_${Date.now()}`;
    const log = (level, message, data = {}) => {
      logger[level](`[ParamValidation] ${message}`, { requestId, ...data });
    };

    try {
      const { error, value } = Joi.object(paramSchema).validate(req.params, {
        abortEarly: false,
        allowUnknown: false
      });

      if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        log('warn', 'Parameter validation failed', { errors: errorMessages });
        return next(ApiError.badRequest('Invalid parameters', errorMessages));
      }

      // Replace req.params with validated values
      req.params = value;
      next();
    } catch (error) {
      log('error', 'Parameter validation error', { 
        error: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      next(ApiError.internal('Error validating parameters'));
    }
  };
};
