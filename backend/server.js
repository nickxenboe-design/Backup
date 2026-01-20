import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import xss from 'xss-clean';
import compression from 'compression';
import morgan from 'morgan';

// ES module helpers
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables (explicitly from backend/.env so it works regardless of process cwd)
dotenv.config({ path: path.join(__dirname, '.env') });

// Dynamically import internal modules AFTER dotenv is loaded.
// With ESM, static imports are evaluated before this file executes, which can cause
// Firebase initialization to run before env vars like FIREBASE_CREDENTIALS_FILE are set.
const { logger, requestLogger } = await import('./src/utils/logger.js');
const { startOdooBusListener } = await import('./src/routes/odooBusListener.js');
const { gated } = await import('./src/middleware/manager.js');
const middlewareControlRoutes = (await import('./src/routes/middlewareControl.js')).default;
const pricingControlRoutes = (await import('./src/routes/pricingControl.js')).default;
const adminRoutes = (await import('./src/routes/admin.js')).default;
const { loadPricingSettings } = await import('./src/config/runtimeSettings.js');
const adminAuthRoutes = (await import('./src/routes/auth.js')).default;
const adminsRoutes = (await import('./src/routes/admins.routes.js')).default;
const adminConfigRoutes = (await import('./src/routes/adminConfig.routes.js')).default;
const adminUsersRoutes = (await import('./src/routes/adminUsers.routes.js')).default;
const userAuthV1Routes = (await import('./src/routes/api/v1/auth.routes.js')).default;
const agentsV1Routes = (await import('./src/routes/api/v1/agents.routes.js')).default;
const adminReportsRoutes = (await import('./src/routes/adminReports.routes.js')).default;
const passengerDocRoutes = (await import('./src/routes/passengerDoc.routes.js')).default;
const webhookRoutes = (await import('./src/routes/webhook.routes.js')).default;
const { errorHandler } = await import('./src/middlewares/errorHandler.js');

const searchRoutes = (await import('./src/routes/search.js')).default;
const eaglelinerRoutes = (await import('./src/routes/eagleliner.js')).default;
const selectTripsRoutes = (await import('./src/routes/selectTrips.js')).default;
const addTripDetailsRoutes = (await import('./src/routes/addTripDetails.js')).default;
const purchaseRoutes = (await import('./src/routes/purchase.js')).default;
const paymentRoutes = (await import('./src/routes/payment.routes.js')).default;
const ticketRoutes = (await import('./src/routes/ticket.js')).default;
const { optionalUserAuth } = await import('./src/middleware/userAuth.js');
const agentHeaderContext = (await import('./src/middleware/agentHeaderContext.js')).default;

// Validate required env vars
const requiredEnvVars = ['BUSBUD_PUBLIC_TOKEN'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
  logger.error(`Missing env vars: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Create Express app
const app = express();
app.disable('x-powered-by');

app.set('trust proxy', 1);

// -------------------------
// CORS configuration
// -------------------------

// -------------------------
// CORS configuration
// -------------------------
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const devOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:2000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];
const prodFallbackOrigins = [
  process.env.CLIENT_URL,
  process.env.CHATBOT_URL,
  process.env.WHATSAPP_WEBHOOK_URL
].filter(Boolean);

const allowedOrigins = envOrigins.length
  ? envOrigins
  : (process.env.NODE_ENV === 'production' ? prodFallbackOrigins : devOrigins);

// Add x-request-id to allowed headers
const corsOptions = {
  origin: allowedOrigins,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-request-id',
    'x-trip-id',
    'x-custom-header1',
    'x-custom-header2',
    'x-cart-id',
    'x-client-branch',
    'x-agent-mode',
    'x-agent-key',
    'x-agent-email',
    'x-agent-id',
    'x-agent-name'
  ],
  exposedHeaders: ['x-request-id'],
  credentials: true
};

app.use(gated('cors', cors(corsOptions), true));

console.log('✅ CORS enabled for:', allowedOrigins);



// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'src/views'));

// -------------------------
// Middleware
// -------------------------
app.use(gated('helmet', helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: process.env.NODE_ENV === 'production' ? { maxAge: 63072000, includeSubDomains: true, preload: true } : false
}), true));

if (process.env.NODE_ENV === 'development') app.use(gated('morgan', morgan('dev'), true));
const BASE_RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 100;
const BASE_RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || (60*60*1000);
const POLL_RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_POLL_MAX) || 600;
const POLL_RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_POLL_WINDOW_MS) || (15*60*1000);

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
const SEARCH_RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_SEARCH_WINDOW_MS) || (15*60*1000);

const pollLimiter = rateLimit({
  max: POLL_RATE_LIMIT_MAX,
  windowMs: POLL_RATE_LIMIT_WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many payment status requests',
  keyGenerator: (req) => {
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    return `${getClientIpForRateLimit(req)}|${ua}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      path: req.originalUrl,
      ip: req.ip,
      clientIp: getClientIpForRateLimit(req),
      xForwardedFor: req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      message: options && options.message,
    });
    res.status(429).send(options && options.message ? options.message : 'Too many requests');
  }
});
app.use('/api/payments/poll', gated('pollRateLimit', pollLimiter, true));

const searchLimiter = rateLimit({
  max: SEARCH_RATE_LIMIT_MAX,
  windowMs: SEARCH_RATE_LIMIT_WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many search requests',
  keyGenerator: (req) => {
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    return `${getClientIpForRateLimit(req)}|${ua}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('Search rate limit exceeded', {
      path: req.originalUrl,
      ip: req.ip,
      clientIp: getClientIpForRateLimit(req),
      xForwardedFor: req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      message: options && options.message,
    });
    res.status(429).send(options && options.message ? options.message : 'Too many requests');
  }
});
app.use('/api/search', gated('searchRateLimit', searchLimiter, true));

const baseLimiter = rateLimit({
  max: BASE_RATE_LIMIT_MAX,
  windowMs: BASE_RATE_LIMIT_WINDOW_MS,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
  skip: (req) => req && req.path && (req.path.startsWith('/api/payments/poll') || req.path.startsWith('/api/search')),
  keyGenerator: (req) => {
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    return `${getClientIpForRateLimit(req)}|${ua}`;
  },
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      path: req.originalUrl,
      ip: req.ip,
      clientIp: getClientIpForRateLimit(req),
      xForwardedFor: req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      requestId: req.requestId,
      message: options && options.message,
    });
    res.status(429).send(options && options.message ? options.message : 'Too many requests');
  }
});
app.use(gated('rateLimit', baseLimiter, true));
app.use(gated('json', express.json({ limit: '10kb' }), true));
app.use(gated('urlencoded', express.urlencoded({ extended: true, limit: '10kb' }), true));
app.use(gated('cookieParser', cookieParser(), true));
app.use(gated('xss', xss(), true));
app.use(gated('hpp', hpp(), true));
app.use(gated('compression', compression(), true));
app.use(gated('httpsRedirect', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
    if (proto !== 'https') return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
}, true));

// Enforce allowed hosts in production to prevent Host header attacks
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && ALLOWED_HOSTS.length) {
  app.use((req, res, next) => {
    const host = String(req.headers.host || '').toLowerCase();
    if (!ALLOWED_HOSTS.includes(host)) {
      return res.status(421).json({ status: 'fail', message: 'Misdirected request' });
    }
    next();
  });
}
// Attach a request ID for correlation if not provided by client/proxy
app.use(gated('requestId', (req, res, next) => {
  const id = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', id);
  req.requestId = id;
  next();
}, true));

// Attach user (JWT). Agent headers are managed by the frontend; no backend enrichment.
app.use(gated('optionalUserAuth', optionalUserAuth, true));

// Normalize/enrich agent context from headers/login/cart (used by downstream routes)
app.use(gated('agentHeaderContext', agentHeaderContext, true));

app.use(gated('clientBranch', (req, res, next) => {
  const raw = (req.headers['x-client-branch'] || '').toString().toLowerCase();
  let branch = 'unknown';
  if (raw === 'frontend' || raw === 'web') branch = 'frontend';
  else if (raw === 'chatbot' || raw === 'bot') branch = 'chatbot';
  req.clientBranch = branch;
  res.locals.clientBranch = branch;
  next();
}, true));

app.use(gated('requestLogger', requestLogger, true));

// -------------------------
// Route Loader with Logs
// -------------------------
const routes = [
  { path: '/api/search', handler: searchRoutes },
  { path: '/api/eagleliner', handler: eaglelinerRoutes },
  { path: '/api/trips', handler: selectTripsRoutes },
  { path: '/api/trips', handler: addTripDetailsRoutes },
  { path: '/api/v1/auth', handler: userAuthV1Routes },
  { path: '/api/v1/agents', handler: agentsV1Routes },
  { path: '/admin/middleware', handler: middlewareControlRoutes },
  { path: '/admin/pricing', handler: pricingControlRoutes },
  { path: '/admin', handler: adminRoutes },
  { path: '/api/purchase', handler: purchaseRoutes },
  { path: '/api/payments', handler: paymentRoutes },
  { path: '/api/ticket', handler: ticketRoutes },
  { path: '/api/auth', handler: adminAuthRoutes },
  { path: '/api/admins', handler: adminsRoutes },
  { path: '/api/admin/config', handler: adminConfigRoutes },
  { path: '/api/admin/users', handler: adminUsersRoutes },
  { path: '/api/admin/reports', handler: adminReportsRoutes },
  { path: '/api/passengers', handler: passengerDocRoutes },
  { path: '/webhook', handler: webhookRoutes }
];

routes.forEach(route => {
  try {
    app.use(route.path, route.handler);
    console.log(`✅ ${route.path} route loaded`);
  } catch (err) {
    console.error(`❌ Failed to load ${route.path} route`, err);
  }
});

// Admin-specific rate limiter
const adminLimiter = rateLimit({
  max: Number(process.env.RATE_LIMIT_ADMIN_MAX) || 200,
  windowMs: Number(process.env.RATE_LIMIT_ADMIN_WINDOW_MS) || (15*60*1000),
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many admin requests'
});
app.use('/admin', adminLimiter);

// Payment handling is now done through Odoo Bus Listener
console.log('ℹ️  Payment handling is managed by Odoo Bus Listener');

app.get('/api/v1/theme', (req, res) => {
  const primary = String(process.env.THEME_PRIMARY || '#652D8E').trim();
  const accent = String(process.env.THEME_ACCENT || '#F59E0B').trim();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ primary, accent });
});

app.get('/runtime-config.json', (req, res) => {
  try {
    const clientDistPath = path.resolve(__dirname, '../frontend/dist');
    const distCfg = path.join(clientDistPath, 'runtime-config.json');
    const publicCfg = path.resolve(__dirname, '../frontend/public/runtime-config.json');
    const cfgPath = fs.existsSync(distCfg) ? distCfg : publicCfg;

    if (!fs.existsSync(cfgPath)) {
      return res.status(404).json({ status: 'fail', message: 'runtime-config.json not found' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(cfgPath);
  } catch (_e) {
    return res.status(500).json({ status: 'error', message: 'Failed to load runtime-config.json' });
  }
});

// -------------------------
// Test Ticket Route (disabled in production)
// -------------------------
if (process.env.NODE_ENV !== 'production') {
  app.get('/test-ticket', (req, res) => {
    const sampleTicket = {
      ticket_no: "TCYZMUEB",
      ref_no: "B1CT4055",
      seat_no: "2:D",
      price: "19.0$ [Online - CASH]",
      booked_by: "API SYSTEM",
      uuid: "123e4567-e89b-12d3-a456-426614174000",
    };

    const samplePassenger = {
      name: "MEMORY BURUNGUDZI",
      phone: "+27 617365102"
    };

    const sampleItinerary = {
      depart_city: "PRETORIA",
      depart_date: "30/12/18",
      depart_time: "06:15",
      arrive_city: "CAPE TOWN",
      arrive_date: "30/12/18",
      arrive_time: "08:15",
    };
  
  const sampleContact = {
    phone: "+263 8677005237"
  };

    res.setHeader('Content-Type', 'text/html');
    res.render('ticket', {
      ticket: sampleTicket,
      passenger: samplePassenger,
      itinerary: sampleItinerary,
      contact: sampleContact,
      qrDataUrl: "",
      assets: { logoBase64: "" }
    });
  });
}

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Serve frontend in production
const clientDistPath = path.resolve(__dirname, '../frontend/dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(clientDistPath)) {
  logger.info(`📦 Serving frontend from ${clientDistPath}`);
  app.use(express.static(clientDistPath, { index: false, maxAge: '1h' }));

  app.get('*', (req, res, next) => {
    const p = req.path || '';
    const acceptHeader = String((req.headers && req.headers.accept) || '').toLowerCase();
    const wantsHtml = acceptHeader.includes('text/html');
    const wantsJson = acceptHeader.includes('application/json');
    if (p.startsWith('/api') || p.startsWith('/admin') || p.startsWith('/test-ticket')) return next();
    if (!wantsHtml || wantsJson) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 404 handler
app.all('*', (req, res) => res.status(404).json({ status: 'fail', message: `Can't find ${req.originalUrl}` }));

// Global error handler (must be after routes)
app.use(errorHandler);

// -------------------------
// Start Odoo Bus Listener
// -------------------------
const startOdooListener = async () => {
  try {
    await startOdooBusListener();
    logger.info('✅ Odoo Bus Listener started successfully');
  } catch (error) {
    logger.error('❌ Failed to start Odoo Bus Listener:', error);
    process.exit(1);
  }
};
// startOdooListener(); // currently disabled

// -------------------------
// Start server
// -------------------------
const startServer = async () => {
  try {
    await loadPricingSettings();

    const server = app.listen(process.env.PORT || 5000, () => {
      console.log(`🚀 Server running on port ${process.env.PORT || 5000}`);
    });

    process.on('unhandledRejection', err => {
      console.error('UNHANDLED REJECTION:', err);
      server.close(() => process.exit(1));
    });

    process.on('uncaughtException', err => {
      console.error('UNCAUGHT EXCEPTION:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('Failed to start server', err);
    process.exit(1);
  }
};

startServer();
