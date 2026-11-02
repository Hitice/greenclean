import test from 'node:test';
import assert from 'node:assert/strict';
import { revokeToken } from '../src/gmail.js';

test('revokeToken POSTs the token in the form body, not the URL', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true };
  });

  assert.equal(await revokeToken('ya29.secret-token'), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(String(calls[0].options.body), 'token=ya29.secret-token');
  assert.doesNotMatch(calls[0].url, /secret/);
});

test('revokeToken reports failure without throwing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network down');
  });
  assert.equal(await revokeToken('x'), false);
});
