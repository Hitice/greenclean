/**
 * GreenClean Background Service Worker
 * Handles unsubscribe URL visits in the background via tab automation.
 */

const LOAD_TIMEOUT_MS = 8000;

/**
 * Opens a URL in a background tab, waits for it to load, then closes it.
 * Handles one-click HTTP unsubscribe pages (RFC 8058).
 */
async function visitAndClose(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve({ url, status: 'failed' });
        return;
      }

      const tabId = tab.id;
      const cleanup = (result) => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        chrome.tabs.remove(tabId, () => cleanup({ url, status: 'timeout' }));
      }, LOAD_TIMEOUT_MS);

      function listener(id, info) {
        if (id === tabId && info.status === 'complete') {
          clearTimeout(timeout);
          setTimeout(() => {
            chrome.tabs.remove(tabId, () => cleanup({ url, status: 'done' }));
          }, 1500); // brief pause so the page can register the visit
        }
      }

      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

/**
 * Process a batch of unsubscribe actions sequentially.
 * Reports progress back to the popup via sendResponse callback.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'UNSUBSCRIBE_BATCH') return false;

  const { items } = message; // Array of { id, httpUrl, mailtoUrl }
  (async () => {
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Report progress
      chrome.runtime.sendMessage({
        type: 'UNSUBSCRIBE_PROGRESS',
        done: i,
        total: items.length,
        current: item.id,
      }).catch(() => {}); // popup may be closed

      if (item.httpUrl) {
        const result = await visitAndClose(item.httpUrl);
        results.push({ ...item, ...result, method: 'http' });
      } else if (item.mailtoUrl) {
        // mailto: is handled by the popup via Gmail API — just mark done
        results.push({ ...item, status: 'mailto', method: 'mailto' });
      }
    }

    chrome.runtime.sendMessage({
      type: 'UNSUBSCRIBE_COMPLETE',
      results,
    }).catch(() => {});

    sendResponse({ ok: true, count: results.length });
  })();

  return true; // keep message channel open for async
});
