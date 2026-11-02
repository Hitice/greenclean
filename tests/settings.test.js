import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_DEFAULT_CLOUD_API_BASE,
  migrateLegacySettings,
  parseServiceUrl,
  requiredOrigins,
} from '../src/settings.js';

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return null;
}

test('parseServiceUrl accepts HTTPS and loopback HTTP only', () => {
  assert.equal(parseServiceUrl('https://api.example.com/').host, 'api.example.com');
  assert.equal(parseServiceUrl(' http://localhost:8787 ').port, '8787');
  assert.equal(parseServiceUrl('http://127.0.0.1:8787').hostname, '127.0.0.1');
  assert.equal(codeOf(() => parseServiceUrl('http://api.example.com')), 'insecureUrl');
  assert.equal(codeOf(() => parseServiceUrl('http://192.168.0.10:8787')), 'insecureUrl');
  assert.equal(codeOf(() => parseServiceUrl('http://localhost.evil.example')), 'insecureUrl');
  assert.equal(codeOf(() => parseServiceUrl('ftp://example.com')), 'invalidUrl');
  assert.equal(codeOf(() => parseServiceUrl('javascript:alert(1)')), 'invalidUrl');
  assert.equal(codeOf(() => parseServiceUrl('not a url')), 'invalidUrl');
  assert.equal(codeOf(() => parseServiceUrl('https://user:pass@example.com')), 'invalidUrl');
});

test('requiredOrigins returns nothing for the free plan', () => {
  assert.deepEqual(requiredOrigins({ planMode: 'free', provider: 'openai', apiKey: 'k' }), []);
});

test('requiredOrigins maps each provider to its own host', () => {
  assert.deepEqual(requiredOrigins({ planMode: 'advanced', provider: 'openai', apiKey: 'k' }), ['https://api.openai.com/*']);
  assert.deepEqual(requiredOrigins({ planMode: 'advanced', provider: 'anthropic', apiKey: 'k' }), ['https://api.anthropic.com/*']);
  assert.deepEqual(
    requiredOrigins({ planMode: 'advanced', provider: 'gemini', apiKey: 'k' }),
    ['https://generativelanguage.googleapis.com/*'],
  );
  assert.deepEqual(requiredOrigins({ planMode: 'advanced', provider: 'ollama' }), ['http://localhost:11434/*']);
  assert.deepEqual(
    requiredOrigins({ planMode: 'advanced', provider: 'ollama', ollamaUrl: 'http://127.0.0.1:11500' }),
    ['http://127.0.0.1:11500/*'],
  );
});

test('requiredOrigins validates incomplete or unsafe settings', () => {
  assert.equal(codeOf(() => requiredOrigins({ planMode: 'advanced', provider: 'openai' })), 'apiKeyRequired');
  assert.equal(codeOf(() => requiredOrigins({ planMode: 'advanced', provider: '' })), 'providerRequired');
  assert.equal(codeOf(() => requiredOrigins({ planMode: 'cloud', cloudBaseUrl: 'https://a.example' })), 'cloudRequired');
  assert.equal(
    codeOf(() => requiredOrigins({ planMode: 'cloud', cloudBaseUrl: 'http://a.example', cloudToken: 't' })),
    'insecureUrl',
  );
  assert.deepEqual(
    requiredOrigins({ planMode: 'cloud', cloudBaseUrl: 'https://a.example:8443/api', cloudToken: 't' }),
    ['https://a.example:8443/*'],
  );
});

test('migrateLegacySettings fills defaults and drops the retired cloud URL', () => {
  assert.equal(migrateLegacySettings({}).planMode, 'free');
  assert.equal(migrateLegacySettings({}).cloudBaseUrl, '');
  assert.equal(migrateLegacySettings({ provider: 'openai' }).planMode, 'advanced');
  assert.equal(migrateLegacySettings({ planMode: 'cloud', cloudBaseUrl: LEGACY_DEFAULT_CLOUD_API_BASE }).cloudBaseUrl, '');
  assert.equal(migrateLegacySettings({ cloudBaseUrl: 'https://mine.example' }).cloudBaseUrl, 'https://mine.example');
  assert.equal(migrateLegacySettings({ aiMaskSensitive: false }).aiMaskSensitive, false);
});
