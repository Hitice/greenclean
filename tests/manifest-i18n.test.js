import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const locales = Object.fromEntries(
  readdirSync(path.join(root, 'public/_locales')).map((locale) => [
    locale,
    JSON.parse(read(`public/_locales/${locale}/messages.json`)),
  ]),
);

function usedKeys() {
  const keys = new Set();
  for (const file of readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js'))) {
    const source = read(`src/${file}`);
    for (const m of source.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) keys.add(m[1]);
    for (const m of source.matchAll(/labelKey: '([A-Za-z0-9_]+)'/g)) keys.add(m[1]);
    for (const m of source.matchAll(/^\s+[a-zA-Z]+: '(err[A-Za-z0-9_]+)',$/gm)) keys.add(m[1]);
  }
  for (const m of read('index.html').matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) keys.add(m[1]);
  for (const value of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(value[1]);
  return keys;
}

const placeholders = (message) => (message.match(/\$\d/g) || []).sort().join(',');

test('locales: en is the default and pt_BR exists', () => {
  assert.equal(manifest.default_locale, 'en');
  assert.ok(locales.en && locales.pt_BR);
});

test('locales define the same keys with the same $n substitutions', () => {
  const en = locales.en;
  for (const [locale, messages] of Object.entries(locales)) {
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort(), `${locale} keys differ from en`);
    for (const [key, { message }] of Object.entries(messages)) {
      assert.ok(message.trim(), `${locale}.${key} is empty`);
      assert.equal(placeholders(message), placeholders(en[key].message), `${locale}.${key} substitutions differ`);
      assert.doesNotMatch(message, /[–—]/, `${locale}.${key} contains an en or em dash`);
    }
  }
});

test('every key used by the UI and the manifest exists in every locale', () => {
  const keys = usedKeys();
  assert.ok(keys.size > 100, `only ${keys.size} keys found; extraction is broken`);
  for (const [locale, messages] of Object.entries(locales)) {
    const missing = [...keys].filter((key) => !messages[key]);
    assert.deepEqual(missing, [], `${locale} is missing keys`);
  }
});

test('manifest name and description fit Chrome Web Store limits', () => {
  for (const messages of Object.values(locales)) {
    assert.ok(messages.extName.message.length <= 75);
    assert.ok(messages.extDescription.message.length <= 132);
  }
});

test('manifest: AI hosts are optional, no tabs permission, no remote script sources', () => {
  assert.ok(!manifest.permissions.includes('tabs'));
  for (const host of ['https://api.openai.com/*', 'https://api.anthropic.com/*', 'https://generativelanguage.googleapis.com/*']) {
    assert.ok(!manifest.host_permissions.includes(host), `${host} must not be a required permission`);
    assert.ok(manifest.optional_host_permissions.includes(host), `${host} must be optional`);
  }
  assert.ok(!manifest.host_permissions.some((h) => h.startsWith('http://')));
  assert.equal(manifest.content_security_policy.extension_pages, "script-src 'self'; object-src 'self'");
});

test('package.json version matches the manifest', () => {
  assert.equal(JSON.parse(read('package.json')).version, manifest.version);
});

test('popup loads no third-party resources', () => {
  assert.doesNotMatch(read('index.html'), /https?:\/\/(?!127\.0\.0\.1)/);
});
