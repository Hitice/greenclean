/**
 * Ponto de entrada — API profissional GreenClean (IA na nuvem)
 */
import 'dotenv/config';
import { createApp } from './src/app.js';
import { config } from './src/config.js';
import { logger } from './src/logger.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, env: config.NODE_ENV },
    'API escutando',
  );
});

if (!config.hasAnthropic) {
  logger.warn('ANTHROPIC_API_KEY ausente — /ready e classificação falham.');
}
if (!config.hasJwt && config.apiTokens.length === 0) {
  logger.warn('Nenhum método de auth: defina JWT_SECRET (produção) ou API_TOKENS (dev).');
}

function shutdown(signal) {
  logger.info({ signal }, 'encerrando');
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
