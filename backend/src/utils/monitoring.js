import { logger } from './logger.js';
import { Counter, Histogram, Gauge, register } from 'prom-client';

// Enable default metrics
import collectDefaultMetrics from 'prom-client/lib/defaultMetrics';
collectDefaultMetrics({ timeout: 5000 });

// Request metrics
const httpRequestDurationMicroseconds = new Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 5, 15, 50, 100, 200, 300, 400, 500, 1000, 2000, 5000]
});

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

const httpRequestErrorsTotal = new Counter({
  name: 'http_request_errors_total',
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route', 'status_code', 'error_type']
});

// Application metrics
const operations = new Counter({
  name: 'app_operations_total',
  help: 'Total number of operations',
  labelNames: ['operation', 'service']
});

const operation_duration_seconds = new Histogram({
  name: 'app_operation_duration_seconds',
  help: 'Operation duration in seconds',
  labelNames: ['operation', 'service'],
  buckets: [0.1, 0.3, 0.5, 1, 2, 5]
});

const errors = new Counter({
  name: 'app_operation_errors_total',
  help: 'Total number of operation errors',
  labelNames: ['operation', 'service', 'error']
});

// Business metrics
const activeCartsGauge = new Gauge({
  name: 'active_carts_count',
  help: 'Number of active shopping carts'
});

const completedPurchasesTotal = new Counter({
  name: 'completed_purchases_total',
  help: 'Total number of completed purchases',
  labelNames: ['currency', 'payment_method']
});

/**
 * Middleware to track HTTP request metrics
 */
export const httpMetricsMiddleware = (req, res, next) => {
  const start = process.hrtime();
  const path = req.route?.path || req.path;

  res.on('finish', () => {
    const duration = process.hrtime(start);
    const durationMs = duration[0] * 1000 + duration[1] / 1e6;

    const labels = {
      method: req.method,
      route: path,
      status_code: res.statusCode
    };

    httpRequestDurationMicroseconds.observe(labels, durationMs);
    httpRequestsTotal.inc(labels);

    if (res.statusCode >= 400) {
      httpRequestErrorsTotal.inc({
        ...labels,
        error_type: res.statusCode >= 500 ? '5xx' : '4xx'
      });
    }
  });

  next();
};

/**
 * Track operation metrics
 * @param {string} operation - Operation name (e.g., 'find', 'create', 'update')
 * @param {string} service - Service name (e.g., 'cart', 'booking')
 * @param {Function} fn - Async function to execute
 * @returns {Promise<*>} Result of the function
 */
export const trackOperation = async (operation, service, fn) => {
  const start = Date.now();
  const labels = { operation, service };

  try {
    operations.inc(labels);
    const result = await fn();
    operation_duration_seconds.observe(labels, (Date.now() - start) / 1000);
    return result;
  } catch (error) {
    errors.inc({ ...labels, error: error.name });
    throw error;
  }
};

/**
 * Update active carts gauge
 * @param {number} count - Number of active carts
 */
export const updateActiveCarts = (count) => {
  activeCartsGauge.set(count);};

/**
 * Track a completed purchase
 * @param {string} currency - Currency code (e.g., 'USD', 'EUR')
 * @param {string} paymentMethod - Payment method used
 * @param {number} amount - Purchase amount
 */
export const trackPurchase = (currency, paymentMethod, amount = 1) => {
  completedPurchasesTotal.inc({ currency, payment_method: paymentMethod }, amount);
};

/**
 * Get all metrics for Prometheus
 * @returns {Promise<string>} Prometheus metrics
 */
export const getMetrics = async () => {
  try {
    return await register.metrics();
  } catch (error) {
    logger.error('Failed to collect metrics', { error: error.message });
    throw error;
  }
};

/**
 * Reset all metrics (for testing)
 */
export const resetMetrics = () => {
  register.resetMetrics();
};

// Error tracking
export const trackError = (error, context = {}) => {
  logger.error('Application error', {
    error: error.message,
    stack: error.stack,
    name: error.name,
    ...context
  });

  // Increment error counter
  if (context.type === 'http') {
    httpRequestErrorsTotal.inc({
      method: context.method,
      route: context.route,
      status_code: context.statusCode,
      error_type: error.name || 'unknown'
    });
  } else if (context.type === 'db') {
    dbErrorsTotal.inc({
      operation: context.operation,
      collection: context.collection,
      error_type: error.name || 'unknown'
    });
  }
};
