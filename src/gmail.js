/**
 * Gmail API Wrapper for Chrome Extension
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
let lastAuthError = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = 2, baseDelayMs = 450) {
  let attempt = 0;
  while (true) {
    try {
      const response = await fetch(url, options);
      if (!RETRYABLE_STATUS.has(response.status) || attempt >= retries) {
        return response;
      }
    } catch (err) {
      if (attempt >= retries) throw err;
    }

    attempt++;
    await sleep(baseDelayMs * (2 ** (attempt - 1)));
  }
}

async function getToken() {
  return new Promise((resolve) =>
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      lastAuthError = chrome.runtime.lastError?.message || '';
      resolve(token || null);
    })
  );
}

async function requireToken() {
  const token = await getToken();
  if (!token) {
    const reason = lastAuthError ? ` (${lastAuthError})` : '';
    throw new Error(`Authentication token unavailable. Please reconnect your account${reason}.`);
  }
  return token;
}

export function getLastAuthError() {
  return lastAuthError;
}

export async function login() {
  // Always clear any cached token first so the user can pick an account
  const cached = await new Promise((resolve) =>
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      lastAuthError = chrome.runtime.lastError?.message || '';
      resolve(token || null);
    })
  );
  if (cached) {
    await new Promise(r => chrome.identity.removeCachedAuthToken({ token: cached }, r));
  }
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      lastAuthError = chrome.runtime.lastError?.message || '';
      if (chrome.runtime.lastError || !token) {
        reject(chrome.runtime.lastError);
        return;
      }
      resolve(token);
    });
  });
}

export async function switchAccount() {
  // Revoke cached token and force account picker
  const cached = await new Promise(r => chrome.identity.getAuthToken({ interactive: false }, r));
  if (cached) {
    // Revoke from Google servers too, not just local cache
    await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${cached}`);
    await new Promise(r => chrome.identity.removeCachedAuthToken({ token: cached }, r));
  }
  return login();
}

export async function getAccountInfo() {
  const token = await getToken();
  if (!token) return null;
  try {
    // Preferred endpoint for account metadata.
    const r = await fetchWithRetry('https://www.googleapis.com/oauth2/v1/userinfo', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (r.ok) {
      return await r.json(); // { email, name, picture }
    }

    // Fallback: Gmail profile works reliably with gmail.modify scope.
    const gmailProfile = await fetchWithRetry('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!gmailProfile.ok) return null;

    const profile = await gmailProfile.json();
    return {
      email: profile.emailAddress || null,
      name: null,
      picture: null,
    };
  } catch {
    return null;
  }
}

export async function canAccessGmail() {
  const token = await getToken();
  if (!token) return false;

  try {
    const response = await fetchWithRetry('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchAllIds(query, onProgress) {
  const token = await requireToken();
  let allIds = [];
  let pageToken = null;

  do {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('maxResults', 500);
    url.searchParams.set('q', query);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetchWithRetry(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`Gmail API: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    allIds = allIds.concat((data.messages || []).map(m => m.id));
    pageToken = data.nextPageToken || null;
    if (onProgress) onProgress(allIds.length);
  } while (pageToken);

  return allIds;
}

/**
 * Fetch details including From header and List-Unsubscribe for a batch of IDs.
 */
export async function fetchDetailsBatch(ids) {
  const token = await requireToken();
  const results = await Promise.allSettled(
    ids.map(id =>
      fetchWithRetry(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=List-Unsubscribe`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      ).then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(`Message fetch failed (${id}): ${err.error?.message || r.statusText}`);
        }
        return r.json();
      })
    )
  );

  return results
    .filter((r) => r.status === 'fulfilled' && r.value?.id)
    .map((r) => {
      const msg = r.value;
      const headers = msg.payload?.headers || [];
      const get = (name) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
      return {
        id: msg.id,
        snippet: (msg.snippet || '').substring(0, 200),
        subject: get('Subject') || '(No Subject)',
        from: get('From'),
        unsubscribeHeader: get('List-Unsubscribe'),
      };
    });
}

export async function trashEmailsBatch(ids, onProgress) {
  const token = await requireToken();
  const PARALLEL = 10;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += PARALLEL) {
    const chunk = ids.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(id =>
        fetchWithRetry(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/trash`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        }).then(async (r) => {
          if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.error?.message || r.statusText);
          }
          return true;
        })
      )
    );
    failed += results.filter((r) => r.status === 'rejected').length;
    done += chunk.length;
    if (onProgress) onProgress(done, ids.length);
  }

  if (failed > 0) {
    throw new Error(`Falha ao mover ${failed} e-mails para a lixeira.`);
  }
}
