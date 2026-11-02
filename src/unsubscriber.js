/**
 * Unsubscribe Engine
 * Parses List-Unsubscribe headers and orchestrates unsubscription.
 */

/**
 * Parse a List-Unsubscribe header into { httpUrl, mailtoUrl }.
 * Header format: "<https://...>, <mailto:...>"
 */
export function parseUnsubscribeHeader(header = '') {
  const httpMatch   = header.match(/<(https?:\/\/[^>]+)>/i);
  const mailtoMatch = header.match(/<mailto:([^>]+)>/i);
  return {
    httpUrl:    httpMatch   ? httpMatch[1]   : null,
    mailtoUrl:  mailtoMatch ? mailtoMatch[1] : null,
  };
}

// One recipient, no whitespace, control characters or list separators.
const MAILTO_ADDRESS = /^[^\s\x00-\x1f\x7f@,;<>"]+@[^\s\x00-\x1f\x7f@,;<>"]+\.[^\s\x00-\x1f\x7f@,;<>"]+$/;

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function utf8ToBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeHeaderValue(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${utf8ToBase64(value)}?=`;
}

/**
 * Build the RFC 5322 message for a mailto: unsubscribe.
 * The mailto value comes from the sender's List-Unsubscribe header, so it is untrusted:
 * only a single address is accepted and CR/LF are removed from the subject, which
 * prevents injecting extra headers (Bcc, Cc) or body content into a mail sent from
 * the user's account.
 * @param {string} mailto - "unsub@example.com" or "unsub@example.com?subject=Unsubscribe"
 * @returns {string}
 */
export function buildMailtoUnsubscribeMessage(mailto) {
  const [rawAddress, params = ''] = String(mailto || '').split('?');
  const address = safeDecode(rawAddress).trim();
  if (!MAILTO_ADDRESS.test(address)) {
    throw new Error('Invalid mailto unsubscribe address.');
  }

  const rawSubject = params.match(/(?:^|&)subject=([^&]*)/i)?.[1] || '';
  const subject = safeDecode(rawSubject).replace(/[\x00-\x1f\x7f]+/g, ' ').trim() || 'Unsubscribe';

  return [
    `To: ${address}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please unsubscribe me from this mailing list.',
  ].join('\r\n');
}

/**
 * Send a mailto: unsubscribe via Gmail API (creates and sends an email).
 * @param {string} mailto - The mailto address/value from the header
 * @param {string} token  - Auth token
 */
export async function sendMailtoUnsubscribe(mailto, token) {
  if (!token) {
    throw new Error('No Gmail token available for mailto unsubscribe.');
  }

  const raw = utf8ToBase64(buildMailtoUnsubscribeMessage(mailto))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Gmail send error: ${err.error?.message}`);
  }
  return true;
}

/**
 * Prepare unsubscribe items from subscription email list.
 * Returns items ready to be sent to the background worker.
 */
export function buildUnsubscribeItems(subscriptions) {
  return subscriptions
    .map(s => {
      const { httpUrl, mailtoUrl } = parseUnsubscribeHeader(s.unsubscribeHeader || '');
      if (!httpUrl && !mailtoUrl) return null;
      return { id: s.id, from: s.from, subject: s.subject, httpUrl, mailtoUrl };
    })
    .filter(Boolean);
}

/**
 * Run the unsubscribe engine:
 * - HTTP URLs → sent to background service worker (tab automation)
 * - mailto: URLs → sent directly via Gmail API
 */
export async function runUnsubscribeEngine(items, token, onProgress) {
  const httpItems    = items.filter(i => i.httpUrl);
  const mailtoItems  = items.filter(i => !i.httpUrl && i.mailtoUrl);
  const results      = { done: 0, failed: 0, total: items.length };

  // ── mailto: via Gmail API ────────────────────────────────────────
  for (const item of mailtoItems) {
    try {
      await sendMailtoUnsubscribe(item.mailtoUrl, token);
      results.done++;
    } catch (err) {
      console.error(`Mailto unsub failed for ${item.from}:`, err);
      results.failed++;
    }
    if (onProgress) onProgress(results.done + results.failed, results.total, item.from);
  }

  // ── HTTP URLs → Background Service Worker ────────────────────────
  if (httpItems.length > 0) {
    await new Promise((resolve) => {
      // Listen for progress and completion messages from background worker
      const listener = (msg) => {
        if (msg.type === 'UNSUBSCRIBE_PROGRESS') {
          if (onProgress) onProgress(
            results.done + results.failed + msg.done,
            results.total,
            msg.current
          );
        }
        if (msg.type === 'UNSUBSCRIBE_COMPLETE') {
          msg.results.forEach(r => {
            if (r.status === 'done') results.done++;
            else results.failed++;
          });
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);

      chrome.runtime.sendMessage({
        type: 'UNSUBSCRIBE_BATCH',
        items: httpItems,
      });
    });
  }

  return results;
}
