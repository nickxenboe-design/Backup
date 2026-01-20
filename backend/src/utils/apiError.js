/**
 * Custom error class for API errors
 * @extends Error
 */
class ApiError extends Error {
  /**
   * Create a new API error
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   * @param {Array} errors - Array of error objects
   * @param {string} stack - Error stack trace
   */
  constructor(
    message = 'Internal Server Error',
    statusCode = 500,
    errors = [],
    stack = ''
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Create a 400 Bad Request error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Bad Request error
   */
  static badRequest(message = 'Bad Request', errors = []) {
    return new ApiError(message, 400, errors);
  }

  /**
   * Create a 401 Unauthorized error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Unauthorized error
   */
  static unauthorized(message = 'Unauthorized', errors = []) {
    return new ApiError(message, 401, errors);
  }

  /**
   * Create a 403 Forbidden error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Forbidden error
   */
  static forbidden(message = 'Forbidden', errors = []) {
    return new ApiError(message, 403, errors);
  }

  /**
   * Create a 404 Not Found error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Not Found error
   */
  static notFound(message = 'Resource not found', errors = []) {
    return new ApiError(message, 404, errors);
  }

  /**
   * Create a 405 Method Not Allowed error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Method Not Allowed error
   */
  static methodNotAllowed(message = 'Method Not Allowed', errors = []) {
    return new ApiError(message, 405, errors);
  }

  /**
   * Create a 409 Conflict error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Conflict error
   */
  static conflict(message = 'Conflict', errors = []) {
    return new ApiError(message, 409, errors);
  }

  /**
   * Create a 422 Unprocessable Entity error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Unprocessable Entity error
   */
  static unprocessableEntity(message = 'Unprocessable Entity', errors = []) {
    return new ApiError(message, 422, errors);
  }

  /**
   * Create a 429 Too Many Requests error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Too Many Requests error
   */
  static tooManyRequests(message = 'Too many requests', errors = []) {
    return new ApiError(message, 429, errors);
  }

  /**
   * Create a 500 Internal Server Error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Internal Server Error
   */
  static internal(message = 'Internal Server Error', errors = []) {
    return new ApiError(message, 500, errors);
  }

  /**
   * Create a 503 Service Unavailable error
   * @param {string} message - Error message
   * @param {Array} errors - Array of error objects
   * @returns {ApiError} Service Unavailable error
   */
  static serviceUnavailable(message = 'Service Unavailable', errors = []) {
    return new ApiError(message, 503, errors);
  }

  /**
   * Helper method to convert validation errors to a consistent format
   * @param {Array} validationErrors - Array of validation errors
   * @returns {Array} Formatted validation errors
   */
  static formatValidationErrors(validationErrors) {
    if (!validationErrors || !Array.isArray(validationErrors)) {
      return [];
    }
    
    return validationErrors.map(error => ({
      field: error.param || error.field || 'unknown',
      message: error.msg || error.message || 'Invalid value',
      ...(error.value !== undefined && { value: error.value })
    }));
  }

  /**
   * Helper method to create a validation error
   * @param {Array} validationErrors - Array of validation errors
   * @returns {ApiError} Validation error
   */
  static validationError(validationErrors = []) {
    const formattedErrors = this.formatValidationErrors(validationErrors);
    return new ApiError(
      'Validation Error',
      400,
      formattedErrors.length > 0 ? formattedErrors : validationErrors
    );
  }

  /**
   * Convert error to JSON
   * @returns {Object} JSON representation of the error
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      errors: this.errors,
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }
}

export { ApiError };
