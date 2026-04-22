import { config } from '../config.js';
import { logger } from '../logger.js';

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const isProd = config.NODE_ENV === 'production';
  if (status >= 500) {
    logger.error(
      { err, requestId: req.id, path: req.path, method: req.method },
      err.message,
    );
  }
  const body = {
    error: isProd && status === 500 ? 'Erro interno' : err.message || 'Erro',
    requestId: req.id,
  };
  if (!isProd && err.stack) {
    body.stack = err.stack;
  }
  if (res.headersSent) return;
  res.status(status).json(body);
}
