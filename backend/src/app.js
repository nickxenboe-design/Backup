import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import xss from 'xss-clean';
import compression from 'compression';
import morgan from 'morgan';
import logger from './utils/logger.js';
import { requestLogger } from './utils/logger.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import routes from './routes/index.js';
import cartRoutes from './routes/cart.routes.js';
import './utils/createLogsDir.js'; // Ensure logs directory exists
import config from './config/index.js';

// Configure dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'PORT', 'NODE_ENV', 'CLIENT_URL'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Initialize app
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// In-memory storage for active carts
app.locals.carts = new Map();

// Security middleware
// Enforce HTTPS behind proxy in production
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    if (proto !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
  }
  next();
});

app.use(helmet({
  // Configure only essentials to avoid breaking cross-origin fetch for APIs
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? config.security.helmet.contentSecurityPolicy : false,
  crossOriginEmbedderPolicy: false,
  // Enable HSTS in production
  hsts: process.env.NODE_ENV === 'production' ? config.security.helmet.hsts : false,
  frameguard: config.security.helmet.frameguard,
  noCache: config.security.helmet.noCache
}));

// Development logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Rate limiting
// Base limiter (applies to most /api routes)
const BASE_RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 500;
const BASE_RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || (60 * 60 * 1000);

// Payments polling limiter (higher allowance for frequent polls)
const POLL_RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_POLL_MAX) || 600;
const POLL_RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_POLL_WINDOW_MS) || (15 * 60 * 1000);

const getClientIpForRateLimit = (req) => {
  try {
    const cf = String(req.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const xffRaw = String(req.headers['x-forwarded-for'] || '').trim();
    if (xffRaw) {
      const first = xffRaw.split(',')[0]?.trim();
      if (first) return first;
    }
    const xrip = String(req.headers['x-real-ip'] || '').trim();
    if (xrip) return xrip;
  } catch {}
  return req.ip;
};

const SEARCH_RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_SEARCH_MAX) || 300;
const SEARCH_RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_SEARCH_WINDOW_MS) || (15 * 60 * 1000);

// Specific limiter for payments polling endpoint
const pollLimiter = rateLimit({
  max: POLL_RATE_LIMIT_MAX,
  windowMs: POLL_RATE_LIMIT_WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many payment status requests, please slow down.',
  keyGenerator: (req) => {
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    return `${getClientIpForRateLimit(req)}|${ua}`;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      path: req.originalUrl,
      ip: req.ip,
      clientIp: getClientIpForRateLimit(req),
      xForwardedFor: req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      message: 'Too many payment status requests, please slow down.'
    });
    return res.status(429).send('Too many payment status requests, please slow down.');
  }
});

// Apply poll limiter specifically to payments polling
app.use('/api/payments/poll', pollLimiter);

const searchLimiter = rateLimit({
  max: SEARCH_RATE_LIMIT_MAX,
  windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many search requests, please slow down.',
  keyGenerator: (req) => {
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    return `${getClientIpForRateLimit(req)}|${ua}`;
  },
  handler: (req, res) => {
    logger.warn('Search rate limit exceeded', {
      path: req.originalUrl,
      ip: req.ip,
      clientIp: getClientIpForRateLimit(req),
      xForwardedFor: req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      message: 'Too many search requests, please slow down.'
    });
    return res.status(429).send('Too many search requests, please slow down.');
  }
});
app.use('/api/search', searchLimiter);

// Base limiter for the rest of /api, skipping the payments polling path
const baseLimiter = rateLimit({
  max: BASE_RATE_LIMIT_MAX,
  windowMs: BASE_RATE_LIMIT_WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  skip: (req) => req && req.path && (req.path.startsWith('/payments/poll') || req.path.startsWith('/search')),
  keyGenerator: (req) => {
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    return `${getClientIpForRateLimit(req)}|${ua}`;
  },
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', {
      path: req.originalUrl,
      ip: req.ip,
      clientIp: getClientIpForRateLimit(req),
      xForwardedFor: req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      message: 'Too many requests from this IP, please try again later.'
    });
    return res.status(429).send('Too many requests from this IP, please try again later.');
  }
});
app.use('/api', baseLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Data sanitization
app.use(xss());

// Prevent parameter pollution
app.use(hpp({
  whitelist: [
    'duration', 'ratingsQuantity', 'ratingsAverage',
    'maxGroupSize', 'difficulty', 'price'
  ]
}));

// Compression
app.use(compression());

// CORS configuration
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];
const PROD_FALLBACK = [process.env.CLIENT_URL, process.env.CHATBOT_URL, process.env.WHATSAPP_WEBHOOK_URL].filter(Boolean);

const resolveAllowedOrigins = () => {
  if (process.env.NODE_ENV === 'production') {
    return ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : PROD_FALLBACK;
  }
  // Non-production: restrict to explicit list or known localhost dev origins
  if (ALLOWED_ORIGINS.length) return ALLOWED_ORIGINS;
  return DEV_ORIGINS;
};

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (no origin header)
    if (!origin) return callback(null, true);
    const allowed = resolveAllowedOrigins();
    if (allowed.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-client-branch']
}));

// Client branch detection (frontend vs chatbot)
app.use((req, res, next) => {
  const raw = (req.headers['x-client-branch'] || '').toString().toLowerCase();
  let branch = 'unknown';
  let branchCode = null;
  if (/^\d{2}$/.test(raw)) {
    branchCode = raw;
  } else if (raw === 'online' || raw === 'frontend' || raw === 'web') {
    branchCode = '01';
  } else if (raw === 'chatbot' || raw === 'bot') {
    branchCode = '02';
  } else if (raw === 'harare') {
    branchCode = '03';
  } else if (raw === 'gweru') {
    branchCode = '04';
  }

  if (branchCode === '01') branch = 'online';
  else if (branchCode === '02') branch = 'chatbot';
  else if (branchCode === '03') branch = 'harare';
  else if (branchCode === '04') branch = 'gweru';

  req.clientBranch = branch;
  req.clientBranchCode = branchCode;
  res.locals.clientBranch = branch;
  res.locals.clientBranchCode = branchCode;
  next();
});

// Request logging
app.use(requestLogger);

// Routes
app.use('/api', routes);
app.use('/api/cart', cartRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    database: process.env.DATABASE_URL ? 'postgres' : 'in-memory',
    environment: process.env.NODE_ENV
  });
});

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

// Start server
const startServer = async () => {
  try {
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
      logger.info(`📊 Database: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'In-memory'}`);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err) => {
      logger.error('Unhandled Rejection:', err);
      server.close(() => process.exit(1));
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('Uncaught Exception:', err);
      process.exit(1);
    });

    // Handle SIGTERM
    process.on('SIGTERM', () => {
      logger.info('👋 SIGTERM RECEIVED. Shutting down gracefully');
      server.close(() => {
        logger.info('💥 Process terminated!');
      });
    });

    return server;
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

// Cart cleanup is disabled
logger.info('Cart cleanup scheduler is disabled - cart functionality has been removed');

export default app;