/**
 * AI modes: free (heuristics only), cloud (a GreenClean API server the user hosts),
 * advanced (the user's own provider key, or a local Ollama). UI labels live in _locales.
 */
export const PLAN_MODES = {
  free: { id: 'free' },
  cloud: { id: 'cloud' },
  advanced: { id: 'advanced' },
};

/** No default cloud server: cloud mode only works with a URL the user enters. */
export const DEFAULT_CLOUD_API_BASE = '';

/** Page where users get a cloud token. Empty hides the link in the settings. */
export const CLOUD_SUBSCRIBE_URL = '';
