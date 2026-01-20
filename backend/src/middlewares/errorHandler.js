import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';
import { error as errorResponse } from '../utils/response.js';

/**
 * Wraps an async function to handle errors and pass them to the error handler
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped async function with error handling
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    const requestId = req.id || `req_${Date.now()}`;
    Promise.resolve(fn(req, res, next)).catch((error) => {
      // Attach request context to error for better logging
      error.requestId = requestId;
      error.path = req.path;
      error.method = req.method;
      next(error);
    });
  };
};

/**
 * @desc    Error handler middleware
 * @param   {Error} err - Error object
 * @param   {Object} req - Express request object
 * @param   {Object} res - Express response object
 * @param   {Function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  let error = err;
  
  // Handle non-ApiError instances
  if (!(err instanceof ApiError)) {
    // Handle specific error types
    if (err.name === 'ValidationError') {
      // Handle validation errors
      const messages = [err.message];
      error = ApiError.badRequest('Validation failed', messages);
    } else if (err.name === 'JsonWebTokenError') {
      error = ApiError.unauthorized('Invalid token. Please log in again.');
    } else if (err.name === 'TokenExpiredError') {
      error = ApiError.unauthorized('Your token has expired. Please log in again.');
    } else {
      // Default to 500 Internal Server Error
      error = new ApiError(err.message || 'Internal Server Error', 500);
    }
  }

  // Log the error with Winston
  const logContext = {
    requestId: error.requestId || req.id,
    status: error.statusCode,
    path: error.path || req.path,
    method: error.method || req.method,
    ip: req.ip,
    ...(req.user && { userId: req.user.id }),
    ...(error.errors && { errors: error.errors }),
    ...(process.env.NODE_ENV === 'development' && { 
      stack: error.stack,
      ...(error.originalError && { originalError: error.originalError })
    })
  };

  if (error.statusCode >= 500) {
    logger.error(error.message, logContext);
  } else {
    logger.warn(error.message, logContext);
  }

  // Send error response using the response utility
  errorResponse(res, error, error.statusCode);
};

/**
 * @desc    Handle 404 errors
 * @param   {Object} req - Express request object
 * @param   {Object} res - Express response object
 * @param   {Function} next - Express next function
 */
const notFound = (req, res, next) => {
  next(ApiError.notFound(`The requested resource ${req.originalUrl} was not found`));
};

/**
 * @desc    Handle 405 Method Not Allowed errors
 * @param   {Object} req - Express request object
 * @param   {Object} res - Express response object
 * @param   {Function} next - Express next function
 */
const methodNotAllowed = (req, res, next) => {
  next(ApiError.methodNotAllowed(`Method ${req.method} not allowed for ${req.originalUrl}`));
};

export { errorHandler, notFound, methodNotAllowed };
