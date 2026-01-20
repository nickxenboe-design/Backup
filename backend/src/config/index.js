import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Configure dotenv with the correct path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: `${__dirname}/../../.env` });

const config = {
  // Environment
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isTest: process.env.NODE_ENV === 'test',
  
  // API
  api: {
    prefix: '/api',
    version: process.env.API_VERSION || '1.0',
    name: process.env.APP_NAME || 'Uniglade API',
    description: 'Uniglade Bus Booking API',
    contact: 'support@uniglade.com'
  },

  // Busbud API
  busbud: {
    baseUrl: process.env.BUSBUD_BASE_URL || 'https://napi-preview.busbud.com',
    publicToken: process.env.BUSBUD_PUBLIC_TOKEN || undefined,
    apiKey: process.env.BUSBUD_API_KEY || process.env.BUSBUD_PUBLIC_TOKEN || undefined,
    apiVersion: process.env.BUSBUD_API_VERSION || '3',
    profile: process.env.BUSBUD_PROFILE || 'https://schema.busbud.com/v3/anything.json',
    timeout: parseInt(process.env.BUSBUD_TIMEOUT_MS) || 10000
  },

  // WhatsApp configuration
  whatsapp: {
    webhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    // Add any other WhatsApp-related configurations here
  },

  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
  },

  // Security
  security: {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    },
    helmet: {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"]
        }
      },
      hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true
      },
      noCache: true,
      frameguard: {
        action: 'deny'
      }
    },
    requestSizeLimit: '10mb'
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    file: process.env.LOG_FILE || 'logs/app.log',
    errorFile: process.env.ERROR_LOG_FILE || 'logs/error.log',
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d',
    colorize: process.env.LOG_COLORIZE !== 'false'
  },

  // Monitoring
  monitoring: {
    enabled: process.env.MONITORING_ENABLED !== 'false',
    metricsPath: '/metrics',
    collectDefaultMetrics: true,
    requestDurationBuckets: [0.1, 5, 15, 50, 100, 200, 500, 1000, 2000, 5000],
    dbQueryDurationBuckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000]
  },

  // Cache
  cache: {
    enabled: process.env.CACHE_ENABLED === 'true',
    ttl: parseInt(process.env.CACHE_TTL_MS) || 300000, // 5 minutes
    max: parseInt(process.env.CACHE_MAX_ITEMS) || 1000
  },
  
  // Database (PostgreSQL)
  database: {
    url: process.env.DATABASE_URL || '',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS, 10) || 10,
    idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10) || 30000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    issuer: process.env.JWT_ISSUER || 'uniglade-api',
    audience: process.env.JWT_AUDIENCE || 'uniglade-client'
  },

  // Request validation
  validation: {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true
  },
  
  // WhatsApp configuration for logging (moved to logConfig)
};

// Validate required environment variables
const requiredVars = [
  'BUSBUD_PUBLIC_TOKEN',
  'BUSBUD_API_KEY',
  'JWT_SECRET'
];

if (config.isProduction) {
  requiredVars.push('DATABASE_URL');
}

for (const envVar of requiredVars) {
  if (!process.env[envVar] || process.env[envVar].trim() === '') {
    console.error(`❌ Missing required environment variable: ${envVar}`);
    console.error('Please check your .env file and ensure all required variables are set.');
    process.exit(1);
  }
}

// Log configuration (without sensitive data)
const logConfig = {
  env: config.env,
  port: config.port,
  api: {
    prefix: config.api.prefix,
    version: config.api.version
  },
  busbud: {
    baseUrl: config.busbud.baseUrl,
    publicToken: config.busbud.publicToken ? '***' : 'Not configured',
    apiVersion: config.busbud.apiVersion
  },
  whatsapp: {
    webhookSecret: config.whatsapp.webhookSecret ? '***' : 'Not configured',
    verifyToken: config.whatsapp.verifyToken ? '***' : 'Not configured'
  },
  rateLimit: {
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max
  },
  monitoring: {
    enabled: config.monitoring.enabled,
    metricsPath: config.monitoring.metricsPath
  },
  cache: {
    enabled: config.cache.enabled,
    ttl: config.cache.ttl,
    max: config.cache.max
  },
  database: {
    url: config.database.url ? '***' : 'Not configured',
    maxConnections: config.database.maxConnections
  },
  whatsapp: {
    webhookConfigured: !!config.whatsapp.webhookSecret,
    verifyTokenConfigured: !!config.whatsapp.verifyToken
  }
};

console.log('🚀 Loaded configuration:', JSON.stringify(logConfig, null, 2));

// Export configuration
export default config;
