import { randomBytes } from 'node:crypto';

export function requestId(req, res, next) {
  const id = req.get('X-Request-Id') || randomBytes(8).toString('hex');
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
