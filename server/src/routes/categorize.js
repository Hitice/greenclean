import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { logger } from '../logger.js';
import { createVerifyBearer } from '../auth/verifyBearer.js';
import { buildCategorizePrompt, parseModelJsonArray } from '../services/prompt.js';

/**
 * @param {{ config: object, complete: (prompt: string) => Promise<string> }} deps
 */
export function createCategorizeRouter({ config, complete }) {
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
    message: { error: 'Too many requests. Try again later.' },
  });

  const r = Router();

  r.post('/v1/categorize', limitCategorize, createVerifyBearer(config), async (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid body',
        details: parsed.error.flatten(),
        requestId: req.id,
      });
    }

    const { emails } = parsed.data;
    const allowedIds = emails.map((e) => e.id);

    let results;
    try {
      const text = await complete(buildCategorizePrompt(emails));
      results = parseModelJsonArray(text, allowedIds);
    } catch (err) {
      if (err.code === 'AI_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'AI provider not configured', requestId: req.id });
      }
      // Provider failures, timeouts and unparseable model output: no upstream detail to the client.
      logger.warn(
        { requestId: req.id, code: err.code || err.name, upstreamStatus: err.upstreamStatus },
        'categorize upstream failure',
      );
      return res.status(502).json({ error: 'AI provider error', requestId: req.id });
    }

    logger.info({ requestId: req.id, count: results.length, auth: req.auth?.type }, 'categorize ok');
    return res.json({ results });
  });

  return r;
}
