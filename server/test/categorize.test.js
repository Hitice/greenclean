import test from 'node:test';
import assert from 'node:assert/strict';
import { UpstreamError } from '../src/services/anthropic.js';
import { startApp, testConfig } from './helpers.js';

const TOKEN = 'test-token';

function post(url, body, headers = {}) {
  return fetch(`${url}/v1/categorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(body),
  });
}

const twoEmails = { emails: [{ id: 'a', subject: 'Sale' }, { id: 'b', subject: 'Meeting' }] };

test('returns only known IDs and valid categories from the model', async (t) => {
  const app = await startApp({
    config: testConfig({ API_TOKENS: TOKEN }),
    complete: async () => '[{"id":"a","category":"Disposable"},{"id":"zzz","category":"Disposable"},{"id":"b","category":"Bogus"}]',
  });
  t.after(app.close);

  const res = await post(app.url, twoEmails);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).results, [{ id: 'a', category: 'Disposable' }]);
});

test('maps provider errors to a generic 502 without upstream detail', async (t) => {
  const app = await startApp({
    config: testConfig({ API_TOKENS: TOKEN }),
    complete: async () => {
      throw new UpstreamError('invalid x-api-key sk-ant-secret-detail', 401);
    },
  });
  t.after(app.close);

  const res = await post(app.url, twoEmails);
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.match(text, /"error":"AI provider error"/);
  assert.doesNotMatch(text, /x-api-key|sk-ant|401/);
});

test('maps unparseable model output and network failures to 502', async (t) => {
  const app = await startApp({
    config: testConfig({ API_TOKENS: TOKEN }),
    complete: async () => 'I cannot help with that',
  });
  t.after(app.close);
  assert.equal((await post(app.url, twoEmails)).status, 502);

  const failing = await startApp({
    config: testConfig({ API_TOKENS: TOKEN }),
    complete: async () => {
      throw new TypeError('fetch failed');
    },
  });
  t.after(failing.close);
  assert.equal((await post(failing.url, twoEmails)).status, 502);
});

test('returns 503 when no AI key is configured', async (t) => {
  const app = await startApp({ config: testConfig({ API_TOKENS: TOKEN }) });
  t.after(app.close);
  assert.equal((await post(app.url, twoEmails)).status, 503);
});

test('rejects bodies over MAX_EMAILS_PER_REQUEST', async (t) => {
  const app = await startApp({
    config: testConfig({ API_TOKENS: TOKEN, MAX_EMAILS_PER_REQUEST: '1' }),
    complete: async () => '[]',
  });
  t.after(app.close);
  assert.equal((await post(app.url, twoEmails)).status, 400);
});

test('sends CORS headers only to allowed origins', async (t) => {
  const app = await startApp({
    config: testConfig({ API_TOKENS: TOKEN, CORS_ORIGINS: 'chrome-extension://allowed' }),
    complete: async () => '[]',
  });
  t.after(app.close);

  const allowed = await fetch(`${app.url}/health`, { headers: { Origin: 'chrome-extension://allowed' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'chrome-extension://allowed');

  const denied = await fetch(`${app.url}/health`, { headers: { Origin: 'https://evil.example' } });
  assert.equal(denied.status, 200);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('ignores malformed client request IDs', async (t) => {
  const app = await startApp({ config: testConfig(), complete: async () => '[]' });
  t.after(app.close);
  const res = await fetch(`${app.url}/health`, { headers: { 'X-Request-Id': 'bad id\twith spaces' } });
  assert.match(res.headers.get('x-request-id'), /^[0-9a-f]{16}$/);
});
