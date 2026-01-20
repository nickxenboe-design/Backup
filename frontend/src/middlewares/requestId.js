import { v4 as uuidv4 } from 'uuid';

/**
 * Middleware to add a unique request ID to each request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requestId = (req, res, next) => {
  // Use existing request ID from headers or generate a new one
  const requestId = req.headers['x-request-id'] || `req_${uuidv4()}`;
  
  // Add request ID to request and response objects
  req.id = requestId;
  res.locals.requestId = requestId;
  
  // Add request ID to response headers
  res.setHeader('X-Request-ID', requestId);
  
  next();
};

export default requestId;
