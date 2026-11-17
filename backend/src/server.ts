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

// Trust reverse proxy if explicitly enabled or in production
if (env.TRUST_PROXY || env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// -----------------------------------------------------------------------------
// CORS Security Configuration
// -----------------------------------------------------------------------------
const isProduction = env.NODE_ENV === 'production';

// Explicit list of trusted origins
const trustedOrigins: (string | RegExp)[] = [
  env.FRONTEND_URL,
  ...env.ALLOWED_ORIGINS,
];

// Permit localhost/127.0.0.1 development ports only when not in production
if (!isProduction) {
  trustedOrigins.push(/^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/);
}

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Direct non-browser calls (e.g. curl, tests, mobile SDK)
  return trustedOrigins.some(allowed => {
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
      if (isOriginAllowed(origin)) {
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

// Start Server
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

export default app;

