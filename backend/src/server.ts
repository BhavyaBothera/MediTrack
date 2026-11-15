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

// Middlewares
app.use(cors({ origin: true, credentials: true }));
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

