/**
 * Scan result helpers without DOM dependencies (unit tested in tests/scan-results.test.js).
 */

const MAX_FROM_LENGTH = 120;
const MAX_SUBJECT_LENGTH = 140;

function clip(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Compact record kept for the pre-trash preview. */
export function toPreviewItem(email) {
  return {
    id: String(email.id),
    from: clip(email.from, MAX_FROM_LENGTH),
    subject: clip(email.subject, MAX_SUBJECT_LENGTH),
  };
}

/**
 * Messages that will be moved to Trash for the selected categories, deduplicated by ID.
 * Sessions saved before previews existed only have IDs; those items get hasDetails: false.
 * @param {Record<string, { disposableIds?: string[], disposableItems?: object[] }>} scanResults
 * @param {string[]} categoryKeys
 */
export function collectTrashCandidates(scanResults, categoryKeys) {
  const seen = new Set();
  const candidates = [];
  for (const key of categoryKeys) {
    const result = scanResults?.[key];
    if (!result) continue;
    const details = new Map((result.disposableItems || []).map((item) => [item.id, item]));
    for (const id of result.disposableIds || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const item = details.get(id);
      candidates.push({
        id,
        category: key,
        from: item?.from || '',
        subject: item?.subject || '',
        hasDetails: Boolean(item),
      });
    }
  }
  return candidates;
}
