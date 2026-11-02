import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { logger } from '../logger.js';

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time check of a token against a list. Both sides are hashed first so
 * timingSafeEqual always compares equal-length buffers, and every entry is compared
 * so the position of a match does not change the timing.
 */
export function tokenInList(token, allowed) {
  const candidate = digest(token);
  let match = false;
  for (const entry of allowed) {
    if (timingSafeEqual(candidate, digest(entry))) match = true;
  }
  return match;
}

/**
 * 1) HS256 JWT signed with JWT_SECRET (preferred)
 * 2) Static token listed in API_TOKENS
 */
export function createVerifyBearer(config) {
  return function verifyBearer(req, res, next) {
    const h = req.headers.authorization || '';
    const m = h.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1].trim() : null;

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated', requestId: req.id });
    }

    if (config.hasJwt) {
      try {
        const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
        req.auth = { type: 'jwt', sub: payload.sub, plan: payload.plan };
        return next();
      } catch (e) {
        logger.debug({ err: e.message }, 'invalid JWT, trying static tokens');
      }
    }

    if (config.apiTokens.length > 0 && tokenInList(token, config.apiTokens)) {
      req.auth = { type: 'static' };
      return next();
    }

    return res.status(401).json({ error: 'Invalid token', requestId: req.id });
  };
}
