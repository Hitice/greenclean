import { parseConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

// Low-entropy on purpose: a test-only value that secret scanners should not flag.
export const SECRET = 'x'.repeat(40);

export function testConfig(overrides = {}) {
  return parseConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...overrides });
}

/**
 * Start an app on an ephemeral port. Returns { url, close }.
 */
export async function startApp(deps) {
  const server = createApp(deps).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
