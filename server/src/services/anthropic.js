import { config as defaultConfig } from '../config.js';
import { logger } from '../logger.js';

export class AiNotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not configured');
    this.code = 'AI_NOT_CONFIGURED';
  }
}

export class UpstreamError extends Error {
  constructor(message, upstreamStatus) {
    super(message);
    this.code = 'UPSTREAM_ERROR';
    this.upstreamStatus = upstreamStatus;
  }
}

export async function completeWithAnthropic(userPrompt, config = defaultConfig) {
  if (!config.hasAnthropic) {
    throw new AiNotConfiguredError();
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
    signal: AbortSignal.timeout(config.ANTHROPIC_TIMEOUT_MS),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // Log only the status and error type; never the request or the upstream message body.
    logger.warn({ status: res.status, type: err.error?.type }, 'Anthropic API error');
    throw new UpstreamError(err.error?.message || res.statusText, res.status);
  }

  const data = await res.json();
  return data.content?.find((block) => block.type === 'text')?.text || '';
}
