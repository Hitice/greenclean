import { config } from '../config.js';
import { logger } from '../logger.js';

export async function completeWithAnthropic(userPrompt) {
  if (!config.hasAnthropic) {
    const e = new Error('ANTHROPIC_API_KEY não configurada');
    e.status = 503;
    throw e;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.ANTHROPIC_MODEL,
      max_tokens: config.ANTHROPIC_MAX_TOKENS,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || res.statusText;
    const e = new Error(msg);
    e.status = res.status;
    logger.warn({ status: res.status, body: err }, 'Anthropic API error');
    throw e;
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}
