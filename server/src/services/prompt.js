export function buildCategorizePrompt(emails) {
  const lines = emails.map(
    (e) =>
      `ID: ${e.id} | Subject: ${String(e.subject || '').slice(0, 500)} | Snippet: ${String(e.snippet || '').slice(0, 600)}`,
  );
  return `You are an email assistant. Categorize each email into exactly one of:
"Important" — personal, work, invoices, security alerts, shipping that matters
"Neutral" — newsletters the user might read, neutral updates
"Disposable" — promo spam, social noise, marketing, low-value notification

Return ONLY a raw JSON array, no markdown.
Format: [{"id": "gmailId", "category": "Disposable"}]

Emails:
${lines.join('\n')}`;
}

export function parseModelJsonArray(text, allowedIds) {
  const set = new Set(allowedIds);
  const match = text.match(/\[.*\]/s);
  if (!match) {
    throw new Error('Resposta do modelo sem JSON array');
  }
  const arr = JSON.parse(match[0]);
  const allowCat = new Set(['Important', 'Neutral', 'Disposable']);
  if (!Array.isArray(arr)) throw new Error('JSON inválido');
  return arr
    .filter(
      (x) =>
        x &&
        typeof x.id === 'string' &&
        typeof x.category === 'string' &&
        allowCat.has(x.category) &&
        set.has(x.id),
    )
    .map((x) => ({ id: x.id, category: x.category }));
}
