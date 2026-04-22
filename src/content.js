/**
 * GreenClean Content Script
 * Detects the current logged-in user in Gmail.
 */

function detectEmail() {
  // Method 1: Page Title (usually "Inbox (10) - user@gmail.com - Gmail")
  const title = document.title;
  const match = title.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
  if (match) return match[1];

  // Method 2: Aria-label on account button (for newer Gmail layouts)
  const accountBtn = document.querySelector('a[aria-label*="@gmail.com"], a[aria-label*="Google Account:"]');
  if (accountBtn) {
    const label = accountBtn.getAttribute('aria-label');
    const emailMatch = label.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
    if (emailMatch) return emailMatch[1];
  }

  return null;
}

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_TAB_EMAIL') {
    const email = detectEmail();
    sendResponse({ email });
  }
  return true;
});
