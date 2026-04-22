import { Router } from 'express';
import { config } from '../config.js';

const r = Router();

r.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'greenclean-api',
    version: config.APP_VERSION,
    gitSha: config.GIT_SHA,
    anthropicConfigured: config.hasAnthropic,
    jwtAuth: config.hasJwt,
    staticTokens: config.apiTokens.length > 0,
  });
});

r.get('/ready', (_req, res) => {
  if (!config.hasAnthropic) {
    return res.status(503).json({ ready: false, reason: 'ANTHROPIC_API_KEY ausente' });
  }
  return res.json({ ready: true });
});

export default r;
