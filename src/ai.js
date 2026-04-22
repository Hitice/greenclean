/**
 * Engine de classificação por IA: nuvem (pago) ou avançado (BYOK / Ollama).
 * Plano grátis não usa este módulo.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { PLAN_MODES } from './ai-config.js';

let config = { planMode: 'free' };

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const PROVIDERS = {
  gemini: { label: 'Google Gemini', needsKey: true, needsUrl: false },
  openai: { label: 'OpenAI ChatGPT', needsKey: true, needsUrl: false },
  anthropic: { label: 'Anthropic Claude', needsKey: true, needsUrl: false },
  ollama: { label: 'Ollama (local)', needsKey: false, needsUrl: true },
};

export function getProviders() {
  return PROVIDERS;
}

/**
 * @param {object} settings - planMode, provider, apiKey, cloudBaseUrl, cloudToken, model, ollamaUrl
 */
export function initAI(settings = {}) {
  const plan = settings.planMode || PLAN_MODES.free.id;
  config = { ...settings, planMode: plan };
  if (plan !== 'free') {
    console.log(`IA: plano ${plan} inicializado.`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function jsonRequestWithRetry(url, options, retries = 2, baseDelayMs = 600) {
  let attempt = 0;
  while (true) {
    const response = await fetch(url, options);
    if (response.ok) {
      if (options.method === 'POST' && response.status === 204) return { results: [] };
      if (response.status === 204) return { results: [] };
      return response.json();
    }
    const err = await response.json().catch(() => ({}));
    const message = err.error || err.message || err.detail || response.statusText;
    if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) {
      throw new Error(message || `HTTP ${response.status}`);
    }
    attempt++;
    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }
}

function buildPrompt(preparedEmails, includeSnippet) {
  return `
    You are an intelligent email assistant. Categorize the following emails into one of these three categories:
    1. "Important": Personal emails, work-related discussions, invoices, or critical alerts.
    2. "Neutral": Newsletters you actually read, community updates.
    3. "Disposable": Promotional spam, social media notifications, generic marketing.

    Return ONLY a raw JSON array. No markdown, no explanation.
    Format: [{"id": "123", "category": "Disposable"}, {"id": "456", "category": "Important"}]

    Emails:
    ${preparedEmails.map((e) => `ID: ${e.id} | Subject: ${e.subject}${includeSnippet ? ` | Snippet: ${e.snippet}` : ''}`).join('\n')}
  `;
}

// ─── Núvem (seu backend) ─────────────────────────────────────────
async function categorizeCloud(preparedEmails, opts) {
  const base = (config.cloudBaseUrl || '').replace(/\/$/, '');
  const token = config.cloudToken || '';
  if (!base || !token) {
    throw new Error('Configure URL da API e token (plano IA na nuvem).');
  }
  const url = `${base}/v1/categorize`;
  const data = await jsonRequestWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ emails: preparedEmails }),
  });
  return normalizeCategorizeResults(preparedEmails, data);
}

// ─── Avançado: Gemini / OpenAI / Anthropic / Ollama ─────────────
async function generateFromAdvanced(prompt) {
  const { provider, apiKey, model, ollamaUrl } = config;
  switch (provider) {
    case 'gemini':
      return generateGemini(prompt, apiKey);
    case 'openai':
      return generateOpenAI(prompt, apiKey, model || 'gpt-4o-mini');
    case 'anthropic':
      return generateAnthropic(prompt, apiKey, model || 'claude-3-haiku-20240307');
    case 'ollama':
      return generateOllama(prompt, ollamaUrl || 'http://localhost:11434', model || 'llama3');
    default:
      throw new Error(`Provedor desconhecido: ${provider}`);
  }
}

const GEMINI_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];

async function generateGemini(prompt, apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  for (const model of GEMINI_CHAIN) {
    try {
      const m = genAI.getGenerativeModel({ model });
      const result = await m.generateContent(prompt);
      return result.response.text();
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('429') || msg.includes('quota') || msg.includes('404') || msg.includes('not found') || msg.includes('503')) {
        if (msg.includes('503')) await new Promise((r) => setTimeout(r, 4000));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Nenhum modelo Gemini disponível.');
}

async function generateOpenAI(prompt, apiKey, model) {
  const data = await jsonRequestWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });
  return data.choices[0].message.content;
}

async function generateAnthropic(prompt, apiKey, model) {
  const data = await jsonRequestWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  return data.content[0].text;
}

async function generateOllama(prompt, baseUrl, model) {
  const url = baseUrl.replace(/\/$/, '') + '/api/generate';
  const data = await jsonRequestWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  return data.response;
}

function maskSensitiveText(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi, '[dominio]');
}

function prepareEmailItems(emails, options) {
  const includeSnippet = options.includeSnippet !== false;
  const maskSensitive = options.maskSensitive !== false;
  const compact = emails.map((e) => ({
    id: String(e.id || ''),
    subject: String(e.subject || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    snippet: includeSnippet ? String(e.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 220) : '',
  }));
  return compact.map((item) => ({
    ...item,
    subject: maskSensitive ? maskSensitiveText(item.subject) : item.subject,
    snippet: maskSensitive ? maskSensitiveText(item.snippet) : item.snippet,
  }));
}

function normalizeCategorizeResults(preparedEmails, data) {
  const allowed = new Set(['Important', 'Neutral', 'Disposable']);
  const allowedIds = new Set(preparedEmails.map((i) => i.id));
  const list = Array.isArray(data) ? data : data.results || [];
  return list
    .filter((item) => item && typeof item.id === 'string' && allowed.has(item.category))
    .filter((item) => allowedIds.has(item.id))
    .map((item) => ({ id: item.id, category: item.category }));
}

export async function categorizeEmails(emails, options = {}) {
  const plan = config.planMode || 'free';
  if (plan === 'free') {
    throw new Error('IA desativada no plano grátis.');
  }

  const preparedEmails = prepareEmailItems(emails, options);

  if (plan === 'cloud') {
    return categorizeCloud(preparedEmails, options);
  }

  if (plan !== 'advanced') {
    throw new Error('Modo de IA inválido.');
  }

  const includeSnippet = options.includeSnippet !== false;
  const prompt = buildPrompt(preparedEmails, includeSnippet);
  const text = await generateFromAdvanced(prompt);
  const jsonMatch = text.match(/\[.*\]/s);
  if (!jsonMatch) {
    throw new Error('Formato de resposta inválido do modelo.');
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return normalizeCategorizeResults(preparedEmails, parsed);
}
