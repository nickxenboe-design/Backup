import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

export const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });

  next();
};

export const apiLogger = (service) => {
  return {
    info: (message, meta = {}) => {
      logger.info({
        service,
        message,
        ...meta
      });
    },
    error: (message, error, meta = {}) => {
      logger.error({
        service,
        message,
        error: error.message || error,
        stack: error.stack,
        ...meta
      });
    }
  };
};

// No need for default export as we're using named exports
