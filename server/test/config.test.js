import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';
import { SECRET } from './helpers.js';

test('rejects a JWT secret shorter than 32 characters', () => {
  assert.throws(() => parseConfig({ NODE_ENV: 'test', JWT_SECRET: 'short-secret' }), /JWT_SECRET must be at least 32/);
});

test('accepts a 32+ character JWT secret and enables JWT auth', () => {
  const config = parseConfig({ NODE_ENV: 'test', JWT_SECRET: SECRET });
  assert.equal(config.hasJwt, true);
});

test('refuses production without CORS_ORIGINS', () => {
  assert.throws(() => parseConfig({ NODE_ENV: 'production' }), /CORS_ORIGINS is required in production/);
});

test('accepts production with CORS_ORIGINS and parses the list', () => {
  const config = parseConfig({
    NODE_ENV: 'production',
    CORS_ORIGINS: 'chrome-extension://abc, https://admin.example.com',
  });
  assert.deepEqual(config.corsOrigins, ['chrome-extension://abc', 'https://admin.example.com']);
});

test('development allows an empty CORS_ORIGINS', () => {
  assert.deepEqual(parseConfig({ NODE_ENV: 'development' }).corsOrigins, []);
});
