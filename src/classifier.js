/**
 * Heuristic email classifier — runs BEFORE AI to catch obvious disposables.
 * Returns 'Disposable', 'Subscription', or null (= needs AI).
 */

// --- Keyword lists (subject + snippet) ---
const DISPOSABLE_SUBJECT_PATTERNS = [
  /\b(\d+\s*%\s*off|desconto|promoção|promo|oferta|sale|deal|coupon|cupom)\b/i,
  /\b(limited\s*time|últimas\s*horas|expira|apenas\s*hoje|only\s*today|act\s*now)\b/i,
  /\b(winner|you('ve| have)\s*been\s*selected|parabéns|você\s*ganhou|congratulations)\b/i,
  /\b(free\s*gift|brinde|ganhe\s*grátis|grátis|frete\s*grátis|free\s*shipping)\b/i,
  /\b(black\s*friday|cyber\s*monday|liquidação|clearance)\b/i,
  /\b(newsletter|informativo|boletim|weekly\s*digest|monthly\s*update)\b/i,
  /\b(notification|notificação|new\s*follower|liked\s*your|commented\s*on)\b/i,
  /\b(unsubscribe|cancelar\s*inscrição|opt[\s-]out|manage\s*preferences)\b/i,
  /\b(job\s*alert|vaga|oportunidade\s*de\s*emprego|recrutamento)\b/i,
];

const DISPOSABLE_SENDER_PATTERNS = [
  /no.?reply/i,
  /noreply/i,
  /newsletter/i,
  /marketing/i,
  /notifications?@/i,
  /alerts?@/i,
  /updates?@/i,
  /promo@/i,
  /news@/i,
  /donotreply/i,
];

const SUBSCRIPTION_SNIPPET_PATTERNS = [
  /unsubscribe/i,
  /cancelar\s*inscrição/i,
  /opt[\s-]out/i,
  /manage\s*(your\s*)?(preferences|subscriptions)/i,
  /view\s*(this\s*email\s*in|in)\s*(your\s*)?browser/i,
  /gerenciar\s*preferências/i,
  /remover\s*da\s*lista/i,
];

/**
 * Classify a single email heuristically.
 * @param {{ subject: string, snippet: string, from: string }} email
 * @returns {'Disposable' | 'Subscription' | null}
 */
export function classifyHeuristic(email) {
  const subject = email.subject || '';
  const snippet = email.snippet || '';
  const from    = email.from    || '';
  const unsubscribeHeader = email.unsubscribeHeader || '';

  // RFC-standard unsubscribe header is a strong signal for mailing lists.
  if (unsubscribeHeader.trim()) {
    return 'Subscription';
  }

  // Check for subscription patterns in snippet (highest signal)
  if (SUBSCRIPTION_SNIPPET_PATTERNS.some(p => p.test(snippet))) {
    return 'Subscription';
  }

  // Check sender patterns
  if (DISPOSABLE_SENDER_PATTERNS.some(p => p.test(from))) {
    return 'Disposable';
  }

  // Check subject patterns
  if (DISPOSABLE_SUBJECT_PATTERNS.some(p => p.test(subject))) {
    return 'Disposable';
  }

  return null; // Needs AI
}

/**
 * Classify a batch of emails heuristically.
 * Returns { disposable: [], subscriptions: [], needsAI: [] }
 */
export function classifyBatch(emails) {
  const disposable    = [];
  const subscriptions = [];
  const needsAI       = [];

  for (const email of emails) {
    const result = classifyHeuristic(email);
    if (result === 'Subscription') subscriptions.push(email);
    else if (result === 'Disposable') disposable.push(email);
    else needsAI.push(email);
  }

  return { disposable, subscriptions, needsAI };
}
