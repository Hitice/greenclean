/**
 * Thin wrapper over chrome.i18n. Messages live in public/_locales/<locale>/messages.json.
 * Outside the extension (plain Vite dev server) the key itself is returned.
 */

export function t(key, substitutions) {
  const api = globalThis.chrome?.i18n;
  const value = api?.getMessage ? api.getMessage(key, substitutions) : '';
  return value || key;
}

const ATTRIBUTE_BINDINGS = [
  ['i18nPlaceholder', 'placeholder'],
  ['i18nTitle', 'title'],
  ['i18nAriaLabel', 'aria-label'],
];

/**
 * Translate static markup: data-i18n sets textContent, data-i18n-placeholder,
 * data-i18n-title and data-i18n-aria-label set the matching attribute.
 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  for (const [dataKey, attribute] of ATTRIBUTE_BINDINGS) {
    const selector = `[data-${dataKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    root.querySelectorAll(selector).forEach((el) => {
      el.setAttribute(attribute, t(el.dataset[dataKey]));
    });
  }
  const lang = globalThis.chrome?.i18n?.getUILanguage?.();
  if (lang && root.documentElement) root.documentElement.lang = lang;
}
