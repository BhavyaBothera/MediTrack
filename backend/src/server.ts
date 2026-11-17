import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import apiRoutes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';
import { medicationScheduler } from './schedulers/medicationScheduler';

const app = express();

// -----------------------------------------------------------------------------
// Reverse Proxy Trust Configuration (P0.4)
// Requires explicit configuration; NEVER unconditionally trusts proxy hops.
// -----------------------------------------------------------------------------
const trustProxyConfig = env.TRUST_PROXY;
if (trustProxyConfig && trustProxyConfig !== 'false') {
  const numericHops = parseInt(String(trustProxyConfig), 10);
  if (!isNaN(numericHops) && numericHops > 0) {
    app.set('trust proxy', numericHops);
    console.log(`[Security] Reverse proxy trust enabled for ${numericHops} upstream hop(s).`);
  } else if (trustProxyConfig === 'true' || trustProxyConfig === '1') {
    app.set('trust proxy', 1);
    console.log('[Security] Reverse proxy trust enabled for 1 upstream hop.');
  } else if (typeof trustProxyConfig === 'string' && trustProxyConfig.includes(',')) {
    const proxyList = trustProxyConfig.split(',').map(s => s.trim()).filter(Boolean);
    app.set('trust proxy', proxyList);
    console.log(`[Security] Reverse proxy trust enabled for IP allowlist: ${proxyList.join(', ')}`);
  } else {
    app.set('trust proxy', trustProxyConfig);
    console.log(`[Security] Reverse proxy trust enabled with config: "${trustProxyConfig}".`);
  }
} else {
  app.set('trust proxy', false);
}

// -----------------------------------------------------------------------------
// CORS Security Configuration (P0.5)
// -----------------------------------------------------------------------------
export function getTrustedOrigins(
  nodeEnv = env.NODE_ENV,
  configuredOrigins: (string | undefined)[] = [env.FRONTEND_URL, ...env.ALLOWED_ORIGINS]
): (string | RegExp)[] {
  const isProd = nodeEnv === 'production';
  const origins: (string | RegExp)[] = [];

  // Parse FRONTEND_URL and ALLOWED_ORIGINS
  const rawOrigins = configuredOrigins.filter(Boolean);

  for (const o of rawOrigins) {
    const trimmed = typeof o === 'string' ? o.trim() : '';
    if (!trimmed) continue;

    // In production, strictly reject localhost / 127.0.0.1 even if misconfigured
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/i.test(trimmed);
    if (isProd && isLocal) {
      console.warn(`[CORS Security] Discarded localhost origin "${trimmed}" in production environment.`);
      continue;
    }
    origins.push(trimmed);
  }

  // Permit localhost/127.0.0.1 development ports only when not in production
  if (!isProd) {
    origins.push(/^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/);
  }

  return origins;
}

export function isOriginAllowed(
  origin: string | undefined,
  nodeEnv = env.NODE_ENV,
  configuredOrigins?: (string | undefined)[]
): boolean {
  if (!origin) return true; // Direct non-browser calls (e.g. curl, tests, mobile SDK)
  const trusted = getTrustedOrigins(nodeEnv, configuredOrigins);
  if (trusted.length === 0) return false; // Missing or empty production configuration fails safely

  return trusted.some(allowed => {
    if (typeof allowed === 'string') {
      return allowed.toLowerCase() === origin.toLowerCase();
    }
    return allowed.test(origin);
  });
}

// Strict CORS Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin, env.NODE_ENV)) {
        callback(null, true);
      } else {
        const corsError = new Error(`CORS Security Policy: Origin "${origin}" is not permitted.`);
        (corsError as any).status = 403;
        callback(corsError);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 86400,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Static Frontend files
const frontendDir = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendDir));

// API Health Check (unthrottled for monitoring)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MediTrack Backend API',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    timezone: env.TIMEZONE,
    scheduler: 'active',
  });
});

// Mount API Routes with Rate Limiting
app.use('/api', apiRateLimiter, apiRoutes);

// Fallback to frontend index.html for SPA client-side routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    res.status(404).json({ success: false, error: 'API route not found' });
    return;
  }
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Centralized Error Handler
app.use(errorHandler);

// Start Server only when executed directly (not when imported in tests)
if (require.main === module) {
  const server = app.listen(env.PORT, () => {
    console.log(`=======================================================`);
    console.log(` MediTrack Backend Server running on http://localhost:${env.PORT}`);
    console.log(` Environment: ${env.NODE_ENV}`);
    console.log(` Default Timezone: ${env.TIMEZONE}`);
    console.log(` Frontend Served from: ${frontendDir}`);
    console.log(`=======================================================`);

    // Start background scheduler
    medicationScheduler.start();
  });

  // Graceful Shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => console.log('HTTP server closed'));
  });

  process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => console.log('HTTP server closed'));
  });
}

export default app;

