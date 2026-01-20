/**
 * Utility functions for standardizing API responses
 */

/**
 * Standard success response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {string} message - Success message
 * @param {number} statusCode - HTTP status code (default: 200)
 * @returns {Object} JSON response
 */
const success = (res, { data = null, message = 'Success', statusCode = 200 }) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
    requestId: res.locals.requestId || null
  });
};

/**
 * Standard error response
 * @param {Object} res - Express response object
 * @param {Error|string} error - Error object or error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @returns {Object} JSON response
 */
const error = (res, error, statusCode = 500) => {
  const response = {
    success: false,
    message: error.message || 'An error occurred',
    errors: Array.isArray(error.errors) && error.errors.length ? error.errors : undefined,
    error: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    timestamp: new Date().toISOString(),
    requestId: res.locals.requestId || null
  };

  return res.status(statusCode).json(response);
};

/**
 * Standard paginated response
 * @param {Object} res - Express response object
 * @param {Array} data - Array of items
 * @param {number} total - Total number of items
 * @param {number} page - Current page number
 * @param {number} limit - Number of items per page
 * @param {string} message - Success message
 * @returns {Object} JSON response
 */
const paginated = (res, { data, total, page = 1, limit = 10, message = 'Data retrieved successfully' }) => {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages,
      hasNext,
      hasPrev,
      nextPage: hasNext ? page + 1 : null,
      prevPage: hasPrev ? page - 1 : null
    },
    timestamp: new Date().toISOString(),
    requestId: res.locals.requestId || null
  });
};

export { success, error, paginated };
