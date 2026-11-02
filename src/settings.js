/**
 * Settings helpers without DOM or chrome.* dependencies (unit tested in tests/settings.test.js).
 */

/** Cloud URL shipped by earlier versions; that deployment no longer exists. */
export const LEGACY_DEFAULT_CLOUD_API_BASE = 'https://greenclean-production.up.railway.app';

export const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

/** Host permission each bring-your-own-key provider needs (declared in optional_host_permissions). */
export const PROVIDER_ORIGINS = {
  gemini: 'https://generativelanguage.googleapis.com/*',
  openai: 'https://api.openai.com/*',
  anthropic: 'https://api.anthropic.com/*',
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

export class SettingsError extends Error {
  /** @param {'invalidUrl' | 'insecureUrl' | 'cloudRequired' | 'apiKeyRequired' | 'providerRequired'} code */
  constructor(code) {
    super(code);
    this.name = 'SettingsError';
    this.code = code;
  }
}

/**
 * Parse a server URL entered by the user. HTTPS is required; plain HTTP is accepted only
 * for localhost and 127.0.0.1, so tokens and mail metadata never travel unencrypted.
 * @returns {URL}
 */
export function parseServiceUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new SettingsError('invalidUrl');
  }
  if (url.username || url.password) throw new SettingsError('invalidUrl');
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:') {
    if (LOOPBACK_HOSTS.has(url.hostname)) return url;
    throw new SettingsError('insecureUrl');
  }
  throw new SettingsError('invalidUrl');
}

/** Host permission pattern for one origin, e.g. https://api.example.com/* */
export function originPattern(url) {
  return `${url.protocol}//${url.host}/*`;
}

/**
 * Host permissions the selected AI mode needs. Throws SettingsError when the settings are incomplete.
 * @returns {string[]}
 */
export function requiredOrigins(settings) {
  const mode = settings.planMode || 'free';
  if (mode === 'cloud') {
    if (!settings.cloudBaseUrl || !settings.cloudToken) throw new SettingsError('cloudRequired');
    return [originPattern(parseServiceUrl(settings.cloudBaseUrl))];
  }
  if (mode === 'advanced') {
    const { provider } = settings;
    if (provider === 'ollama') {
      return [originPattern(parseServiceUrl(settings.ollamaUrl || DEFAULT_OLLAMA_URL))];
    }
    if (PROVIDER_ORIGINS[provider]) {
      if (!settings.apiKey) throw new SettingsError('apiKeyRequired');
      return [PROVIDER_ORIGINS[provider]];
    }
    throw new SettingsError('providerRequired');
  }
  return [];
}

/**
 * Fill defaults for settings saved by any earlier version.
 */
export function migrateLegacySettings(parsed = {}) {
  const base = {
    cloudBaseUrl: '',
    cloudToken: '',
    provider: '',
    apiKey: '',
    model: '',
    ollamaUrl: '',
    aiSendSnippet: true,
    aiMaskSensitive: true,
    ...parsed,
  };
  if (!parsed.planMode) {
    base.planMode = parsed.provider ? 'advanced' : 'free';
  }
  if (base.cloudBaseUrl === LEGACY_DEFAULT_CLOUD_API_BASE) {
    base.cloudBaseUrl = '';
  }
  return base;
}
