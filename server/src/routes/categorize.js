import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { verifyBearer } from '../auth/verifyBearer.js';
import { buildCategorizePrompt, parseModelJsonArray } from '../services/prompt.js';
import { completeWithAnthropic } from '../services/anthropic.js';

const bodySchema = z.object({
  emails: z
    .array(
      z.object({
        id: z.string().min(1),
        subject: z.string().optional(),
        snippet: z.string().optional(),
      }),
    )
    .min(1)
    .max(config.MAX_EMAILS_PER_REQUEST),
});

const limitCategorize = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente depois.' },
});

const r = Router();

r.post('/v1/categorize', limitCategorize, verifyBearer, async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Body inválido',
        details: parsed.error.flatten(),
        requestId: req.id,
      });
    }

    const { emails } = parsed.data;
    const allowedIds = emails.map((e) => e.id);

    const prompt = buildCategorizePrompt(emails);
    const text = await completeWithAnthropic(prompt);
    const results = parseModelJsonArray(text, allowedIds);

    logger.info(
      { requestId: req.id, count: results.length, auth: req.auth?.type },
      'categorize ok',
    );
    return res.json({ results });
  } catch (err) {
    if (err.status === 429) {
      return res.status(429).json({ error: 'Limite do provedor de IA', requestId: req.id });
    }
    return next(err);
  }
});

export default r;
