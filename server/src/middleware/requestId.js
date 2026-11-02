import { randomBytes } from 'node:crypto';

const CLIENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestId(req, res, next) {
  const fromClient = req.get('X-Request-Id');
  const id = fromClient && CLIENT_ID.test(fromClient) ? fromClient : randomBytes(8).toString('hex');
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
