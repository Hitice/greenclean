import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config as defaultConfig } from './config.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/errorHandler.js';
import { createHealthRouter } from './routes/health.js';
import { createCategorizeRouter } from './routes/categorize.js';
import { completeWithAnthropic } from './services/anthropic.js';

const CORS_BASE = {
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  maxAge: 86400,
  credentials: false,
};

function corsOptions(config) {
  // parseConfig guarantees a non-empty list in production; the open policy is for local development.
  if (config.corsOrigins.length === 0) {
    return { ...CORS_BASE, origin: true };
  }
  return {
    ...CORS_BASE,
    // Unknown origins get no CORS headers, so the browser blocks the response.
    origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
  };
}

/**
 * @param {{ config?: object, complete?: (prompt: string) => Promise<string> }} [deps]
 */
export function createApp({ config = defaultConfig, complete } = {}) {
  const completeFn = complete || ((prompt) => completeWithAnthropic(prompt, config));
  const app = express();
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors(corsOptions(config)));
  app.use(express.json({ limit: '512kb' }));

  app.use(createHealthRouter(config));
  app.use(createCategorizeRouter({ config, complete: completeFn }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(errorHandler);

  return app;
}
