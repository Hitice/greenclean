import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.js';
import categorizeRouter from './routes/categorize.js';
import { logger } from './logger.js';

function corsOptions() {
  if (config.corsOrigins.length === 0) {
    if (config.NODE_ENV === 'production') {
      logger.warn('CORS_ORIGINS vazio: permitindo qualquer origem (configure em produção).');
    }
    return { origin: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'], maxAge: 86400, credentials: false };
  }
  return {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (config.corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error('Origem CORS não permitida'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    maxAge: 86400,
  };
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '512kb' }));

  app.use(healthRoutes);
  app.use(categorizeRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Não encontrado' });
  });
  app.use(errorHandler);

  return app;
}
