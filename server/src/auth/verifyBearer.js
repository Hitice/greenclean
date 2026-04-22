import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * 1) JWT (HS256) com JWT_SECRET — preferido em produção
 * 2) Token estático em API_TOKENS — dev/legado
 */
export function verifyBearer(req, res, next) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  const token = m ? m[1].trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado', requestId: req.id });
  }

  if (config.hasJwt) {
    try {
      const payload = jwt.verify(token, config.JWT_SECRET, {
        algorithms: ['HS256'],
      });
      req.auth = { type: 'jwt', sub: payload.sub, plan: payload.plan };
      return next();
    } catch (e) {
      logger.debug({ err: e.message }, 'JWT inválido, tentando token estático');
    }
  }

  if (config.apiTokens.length > 0 && config.apiTokens.includes(token)) {
    req.auth = { type: 'static' };
    return next();
  }

  return res.status(401).json({ error: 'Token inválido', requestId: req.id });
}
