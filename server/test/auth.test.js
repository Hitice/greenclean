import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { tokenInList } from '../src/auth/verifyBearer.js';
import { SECRET, startApp, testConfig } from './helpers.js';

test('tokenInList matches exact tokens of any length and nothing else', () => {
  assert.equal(tokenInList('alpha', ['beta', 'alpha']), true);
  assert.equal(tokenInList('alph', ['alpha']), false);
  assert.equal(tokenInList('alpha-but-longer', ['alpha']), false);
  assert.equal(tokenInList('alpha', []), false);
});

async function categorize(url, token) {
  return fetch(`${url}/v1/categorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ emails: [{ id: '1', subject: 'Hi' }] }),
  });
}

test('bearer auth accepts static tokens and valid JWTs, rejects the rest', async (t) => {
  const config = testConfig({ API_TOKENS: 'static-one,static-two', JWT_SECRET: SECRET });
  const app = await startApp({ config, complete: async () => '[{"id":"1","category":"Neutral"}]' });
  t.after(app.close);

  assert.equal((await categorize(app.url)).status, 401);
  assert.equal((await categorize(app.url, 'static-two')).status, 200);
  assert.equal((await categorize(app.url, 'static-three')).status, 401);
  assert.equal((await categorize(app.url, jwt.sign({ sub: 'u1' }, SECRET, { algorithm: 'HS256' }))).status, 200);
  const forged = jwt.sign({ sub: 'u1' }, 'another-secret-that-is-at-least-32-chars', { algorithm: 'HS256' });
  assert.equal((await categorize(app.url, forged)).status, 401);
});
