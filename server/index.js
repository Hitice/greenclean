/**
 * Entry point: GreenClean cloud AI API.
 */
import 'dotenv/config';
import { createApp } from './src/app.js';
import { config } from './src/config.js';
import { logger } from './src/logger.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    'API listening',
  );
});

if (!config.hasAnthropic) {
  logger.warn('ANTHROPIC_API_KEY is missing: /ready and /v1/categorize return 503.');
}
if (!config.hasJwt && config.apiTokens.length === 0) {
  logger.warn('No auth method configured: set JWT_SECRET or API_TOKENS.');
}

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
