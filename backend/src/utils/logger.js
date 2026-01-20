import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

const shouldRedact = () => {
  try {
    return isProduction || String(process.env.LOG_REDACT_SENSITIVE || '') === '1';
  } catch (_) {
    return isProduction;
  }
};

const maskEmail = (value) => {
  try {
    const s = String(value || '');
    const at = s.indexOf('@');
    if (at <= 1) return '***REDACTED***';
    return `${s[0]}***${s.slice(at)}`;
  } catch (_) {
    return '***REDACTED***';
  }
};

const maskPhone = (value) => {
  try {
    const s = String(value || '').replace(/\s+/g, '');
    if (s.length <= 4) return '***REDACTED***';
    return `***${s.slice(-4)}`;
  } catch (_) {
    return '***REDACTED***';
  }
};

const redactSensitive = (value, depth = 0) => {
  if (!shouldRedact()) return value;
  if (value == null) return value;
  if (depth > 6) return '***TRUNCATED***';

  if (Array.isArray(value)) {
    if (value.length > 25) return `***REDACTED_ARRAY(${value.length})***`;
    return value.map((v) => redactSensitive(v, depth + 1));
  }

  if (typeof value !== 'object') return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = String(k || '').toLowerCase();

    if (
      key === 'authorization' ||
      key === 'cookie' ||
      key === 'set-cookie' ||
      key === 'password' ||
      key === 'pass' ||
      key === 'token' ||
      key === 'api_key' ||
      key === 'apikey' ||
      key === 'x-busbud-token' ||
      key === 'busbud_api_key'
    ) {
      out[k] = '***REDACTED***';
      continue;
    }

    if (key === 'email' || key.endsWith('_email')) {
      out[k] = maskEmail(v);
      continue;
    }

    if (key === 'phone' || key.endsWith('_phone')) {
      out[k] = maskPhone(v);
      continue;
    }

    if (
      key === 'first_name' ||
      key === 'last_name' ||
      key === 'firstname' ||
      key === 'lastname' ||
      key === 'name'
    ) {
      out[k] = '***REDACTED***';
      continue;
    }

    if (
      key === 'passengers' ||
      key === 'purchaser' ||
      key === 'purchaserdetails' ||
      key === 'address' ||
      key === 'answers' ||
      key === 'requestbody' ||
      key === 'rawresponse' ||
      key === 'headers'
    ) {
      out[k] = '***REDACTED***';
      continue;
    }

    out[k] = redactSensitive(v, depth + 1);
  }
  return out;
};

const redactFormat = winston.format((info) => {
  try {
    if (!shouldRedact()) return info;
    const next = { ...info };
    for (const k of Object.keys(next)) {
      if (k === 'level' || k === 'message' || k === 'timestamp') continue;
      next[k] = redactSensitive(next[k]);
    }
    return next;
  } catch (_) {
    return info;
  }
});

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  firestore: 4,  // Custom level for Firestore operations
  debug: 5,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  firestore: 'cyan',
  debug: 'blue',
};

// Add colors to winston
winston.addColors(colors);

// Format for console logs
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  redactFormat(),
  winston.format.printf(
    (info) => `[${info.timestamp}] ${info.level}: ${info.message}${
      Object.keys(info).length > 3 
        ? '\n' + JSON.stringify(Object.assign({}, info, {
          level: undefined,
          message: undefined,
          timestamp: undefined,
        }), null, 2)
        : ''
    }`
  )
);

// Format for file logs
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  redactFormat(),
  winston.format.json()
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../../logs');
try {
  // This will be handled by the file system operations
} catch (err) {
  console.error('Error creating logs directory:', err);
}

// Create logger instance
const logger = winston.createLogger({
  levels,
  level: isProduction ? 'info' : 'debug',
  format: fileFormat,
  defaultMeta: { service: 'uniglade-api' },
  transports: [
    // Console transport for all levels in development, errors only in production
    new winston.transports.Console({
      format: consoleFormat,
      level: isProduction ? 'error' : 'debug',
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      level: isProduction ? 'info' : 'debug',
    }),
    
    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
    }),
    
    // Firestore-specific logs
    new winston.transports.File({
      filename: path.join(logsDir, 'firestore.log'),
      level: isProduction ? 'warn' : 'firestore',
    })
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(logsDir, 'rejections.log') })
  ]
});

// Create a stream for morgan to use
const stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// Request logger middleware
const requestLogger = (req, res, next) => {
  try {
    // Only log the four agent headers when explicitly present in the request
    const mode = req.get('x-agent-mode');
    const email = req.get('x-agent-email');
    const id = req.get('x-agent-id');
    const name = req.get('x-agent-name');

    const agentHeaders = {};
    if (mode != null) agentHeaders['x-agent-mode'] = mode;
    if (email != null) agentHeaders['x-agent-email'] = email;
    if (id != null) agentHeaders['x-agent-id'] = id;
    if (name != null) agentHeaders['x-agent-name'] = name;

    // Sanitize and include ALL headers in logs (do not enrich)
    const rawHeaders = req.headers || {};
    const allHeaders = {};
    for (const [k, v] of Object.entries(rawHeaders)) {
      const key = String(k).toLowerCase();
      if (key === 'authorization' || key === 'cookie' || key === 'set-cookie') {
        allHeaders[key] = '***REDACTED***';
      } else {
        allHeaders[key] = v;
      }
    }

    const meta = {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      body: isProduction ? undefined : req.body,
      bodyKeys: isProduction ? Object.keys(req.body || {}) : undefined,
      query: req.query,
      params: req.params,
      clientBranch: req.clientBranch || (res.locals && res.locals.clientBranch) || 'unknown',
      headers: isProduction ? undefined : allHeaders
    };

    if (Object.keys(agentHeaders).length) {
      meta.agentHeaders = agentHeaders;
    }

    logger.http(`${req.method} ${req.originalUrl}`, meta);
  } catch (_) {
    // Fallback to minimal logging on error
    logger.http(`${req.method} ${req.originalUrl}`, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      body: isProduction ? undefined : req.body,
      query: req.query,
      params: req.params,
      clientBranch: req.clientBranch || (res.locals && res.locals.clientBranch) || 'unknown'
    });
  }
  next();
};

// Custom Firestore logger
const firestoreLogger = {
  info: (message, meta = {}) => {
    logger.log('firestore', message, { ...meta, type: 'firestore' });
  },
  error: (message, meta = {}) => {
    logger.error(`Firestore Error: ${message}`, { ...meta, type: 'firestore' });
  },
  debug: (message, meta = {}) => {
    logger.debug(`Firestore Debug: ${message}`, { ...meta, type: 'firestore' });
  }
};

// Add firestore logger to the main logger
logger.firestore = firestoreLogger;

export { logger, requestLogger, stream, firestoreLogger };
export default logger;
