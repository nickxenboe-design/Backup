import rateLimit from 'express-rate-limit';
import { ApiError } from '../utils/apiError.js';
import { logger } from '../utils/logger.js';

/**
 * Rate limiting middleware
 * @param {Object} options - Rate limiting options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum number of requests per window
 * @param {string} options.message - Error message when rate limit is exceeded
 * @param {boolean} options.standardHeaders - Enable standard rate limit headers
 * @param {boolean} options.legacyHeaders - Enable legacy rate limit headers
 * @returns {Function} Express middleware
 */
export const createRateLimiter = ({
  windowMs = 15 * 60 * 1000, // 15 minutes
  max = 100, // limit each IP to 100 requests per windowMs
  message = 'Too many requests, please try again later',
  standardHeaders = true,
  legacyHeaders = false,
  keyGenerator = (req) => req.ip,
  skip = (req) => false,
  handler = (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      method: req.method,
      path: req.path,
      requestId: req.id
    });
    next(ApiError.tooManyRequests(options.message));
  }
} = {}) => {
  return rateLimit({
    windowMs,
    max,
    message,
    standardHeaders,
    legacyHeaders,
    keyGenerator,
    skip,
    handler
  });
};

// Default rate limiters
export const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.'
});

export const authLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many login attempts, please try again later.'
});

export const publicApiLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // limit each IP to 1000 requests per hour
  message: 'Too many requests from this IP, please try again after an hour'
});

// Admin rate limiter (less restrictive)
export const adminLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // limit each IP to 1000 requests per hour
  message: 'Too many admin requests, please try again later.'
});
