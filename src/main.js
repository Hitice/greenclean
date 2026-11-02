import '@fontsource-variable/outfit'
import './style.css'
import { login, switchAccount, getAccountInfo, fetchAllIds, fetchDetailsBatch, trashEmailsBatch, getLastAuthError, canAccessGmail } from './gmail.js'
import { initAI, categorizeEmails, getProviders } from './ai.js'
import { CLOUD_SUBSCRIBE_URL } from './ai-config.js'
import { classifyBatch } from './classifier.js'
import { buildUnsubscribeItems, runUnsubscribeEngine } from './unsubscriber.js'
import { t, applyI18n } from './i18n.js'
import { migrateLegacySettings, requiredOrigins, SettingsError } from './settings.js'
import { collectTrashCandidates, toPreviewItem } from './scan-results.js'

// ─── Config ──────────────────────────────────────────────────────
const DETAIL_PARALLEL = 25;
const AI_BATCH_SIZE   = 30;
const SETTINGS_KEY = 'gc_settings';
const SESSION_KEY = 'gc_last_scan';
const EMPTY_STAT = '-';

const GMAIL_CATEGORIES = [
  { key: 'promotions', labelKey: 'categoryPromotions', q: 'category:promotions in:inbox' },
  { key: 'social',     labelKey: 'categorySocial',     q: 'category:social in:inbox'     },
  { key: 'updates',    labelKey: 'categoryUpdates',    q: 'category:updates in:inbox'    },
  { key: 'primary',    labelKey: 'categoryPrimary',    q: 'category:primary in:inbox'    },
];

const SETTINGS_ERROR_KEYS = {
  invalidUrl: 'errInvalidUrl',
  insecureUrl: 'errInsecureUrl',
  cloudRequired: 'errCloudRequired',
  apiKeyRequired: 'errApiKeyRequired',
  providerRequired: 'errProviderRequired',
};

class ScanCancelledError extends Error {
  constructor() {
    super('scan cancelled');
    this.name = 'ScanCancelledError';
  }
}

// ─── State ───────────────────────────────────────────────────────
let scanResults    = {}; // { key: { total, disposableIds, disposableItems, keptCount } }
let subscriptions  = [];
let subscriptionGroups = [];
let settings       = loadSettings();
let lastScanUsedAI = false;
let lastScanPlanMode = 'free';
let trashCandidates = [];

// ─── UI refs ─────────────────────────────────────────────────────
const btnLogin         = document.getElementById('btn-login');
const btnOpenSettings  = document.getElementById('btn-open-settings');
const btnScan          = document.getElementById('btn-scan');
const btnClean         = document.getElementById('btn-clean');
const btnCancelScan    = document.getElementById('btn-cancel-scan');
const postCleanActions = document.getElementById('post-clean-actions');
const btnBackHome      = document.getElementById('btn-back-home');
const btnRescan        = document.getElementById('btn-rescan');
const btnSaveSettings  = document.getElementById('btn-save-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnViewSubs      = document.getElementById('btn-view-subs');
const btnCloseSubs     = document.getElementById('btn-close-subs');
const btnTrashSubs     = document.getElementById('btn-trash-subs');
const settingsModal    = document.getElementById('settings-modal');
const subsModal        = document.getElementById('subs-modal');
const trashModal       = document.getElementById('trash-modal');
const trashList        = document.getElementById('trash-list');
const trashSelectAll   = document.getElementById('trash-select-all');
const trashCount       = document.getElementById('trash-count');
const btnCloseTrash    = document.getElementById('btn-close-trash');
const btnConfirmTrash  = document.getElementById('btn-confirm-trash');
const planModeSelect   = document.getElementById('plan-mode');
const cloudPanel       = document.getElementById('cloud-panel');
const advancedPanel    = document.getElementById('advanced-panel');
const cloudApiBase     = document.getElementById('cloud-api-base');
const cloudTokenInput  = document.getElementById('cloud-token');
const cloudSubscribeLink = document.getElementById('cloud-subscribe-link');
const inputApiKey      = document.getElementById('api-key');
const selectProvider   = document.getElementById('provider-select');
const inputModel       = document.getElementById('model-input');
const inputOllamaUrl   = document.getElementById('ollama-url');
const inputAiSendSnippet = document.getElementById('ai-send-snippet');
const inputAiMaskSensitive = document.getElementById('ai-mask-sensitive');
const ollamaRow        = document.getElementById('ollama-url-row');
const apiKeyGroup      = document.getElementById('api-key-group');
const aiPrivacyGroup   = document.getElementById('ai-privacy-group');
const settingsHintBottom = document.getElementById('settings-hint-bottom');
const statsGrid        = document.getElementById('stats-grid');
const dashboardHint    = document.getElementById('dashboard-hint');

const statTotal      = document.getElementById('stat-total');
const statToDelete   = document.getElementById('stat-to-delete');
const scanProgress   = document.getElementById('scan-progress');
const progressFill   = document.getElementById('progress-fill');
const progressStatus = document.getElementById('progress-status');
const categoryCards  = document.getElementById('category-cards');
const emailPreview   = document.getElementById('email-preview');
const emailItems     = document.getElementById('email-items');
const subTitle       = document.getElementById('sub-title');
const subAlert       = document.getElementById('subscription-alert');
const subsList       = document.getElementById('subs-list');
const subsSelectAll  = document.getElementById('subs-select-all');
const subsUseGeneralUnsub = document.getElementById('subs-use-general-unsub');
const subsTrashAfter = document.getElementById('subs-trash-after');
const toastContainer = document.getElementById('toast-container');

let activeScan = null;

// ─── Helpers ─────────────────────────────────────────────────────
function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return migrateLegacySettings(parsed);
  } catch {
    // Do not log the error: JSON.parse messages quote the input, which may contain API keys.
    console.warn('Invalid saved settings. Resetting.');
    return migrateLegacySettings({});
  }
}

function saveSettings(nextSettings) {
  settings = nextSettings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
}

function categoryLabel(key) {
  const category = GMAIL_CATEGORIES.find((c) => c.key === key);
  return category ? t(category.labelKey) : key;
}

function errorText(err) {
  return err?.message || t('unknownError');
}

function settingsErrorText(err) {
  if (err instanceof SettingsError) return t(SETTINGS_ERROR_KEYS[err.code] || 'unknownError');
  return errorText(err);
}

function assertScanActive(scanContext) {
  if (!scanContext || scanContext.cancelled) {
    throw new ScanCancelledError();
  }
}

function cancelActiveScan() {
  if (activeScan) {
    activeScan.cancelled = true;
  }
}

async function saveScanSession() {
  const payload = {
    scanResults,
    subscriptions,
    lastScanUsedAI,
    lastScanPlanMode,
    savedAt: new Date().toISOString(),
  };

  if (chrome?.storage?.local) {
    await chrome.storage.local.set({ [SESSION_KEY]: payload });
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

async function loadScanSession() {
  if (chrome?.storage?.local) {
    const data = await chrome.storage.local.get(SESSION_KEY);
    return data?.[SESSION_KEY] || null;
  }

  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

async function clearScanSession() {
  if (chrome?.storage?.local) {
    await chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  localStorage.removeItem(SESSION_KEY);
}

function buildAIConfigForInit() {
  return {
    planMode: settings.planMode || 'free',
    provider: settings.provider,
    apiKey: settings.apiKey,
    model: settings.model,
    ollamaUrl: settings.ollamaUrl,
    cloudBaseUrl: (settings.cloudBaseUrl || '').trim(),
    cloudToken: (settings.cloudToken || '').trim(),
  };
}

function hasConfiguredAI() {
  const mode = settings.planMode || 'free';
  if (mode === 'free') return false;
  if (mode === 'cloud') {
    return Boolean((settings.cloudBaseUrl || '').trim() && (settings.cloudToken || '').trim());
  }
  if (mode === 'advanced') {
    if (settings.provider === 'ollama') return true;
    return Boolean(settings.provider && settings.apiKey);
  }
  return false;
}

/**
 * Ask Chrome for optional host access. Resolves without a prompt when already granted;
 * resolves false when the user declines or the API is unavailable.
 */
async function requestHostAccess(origins) {
  if (!origins.length) return true;
  if (!chrome?.permissions?.request) return false;
  try {
    return await chrome.permissions.request({ origins });
  } catch (err) {
    console.warn('Host permission request failed:', err?.message);
    return false;
  }
}

function describeOrigins(origins) {
  return origins.map((origin) => origin.replace(/\/\*$/, '')).join(', ');
}

function setProgress(pct, label) {
  progressFill.style.width = `${Math.min(pct, 100)}%`;
  progressStatus.textContent = label;
}

function showToast(message, type = 'success', timeoutMs = 3200) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), timeoutMs);
}

function setStatsVisible(visible) {
  statsGrid.classList.toggle('hidden', !visible);
  dashboardHint.classList.toggle('hidden', visible);
}

function setPrimaryActionsVisible(visible) {
  [btnScan, btnClean, btnCancelScan].forEach((el) => {
    el.classList.toggle('hidden', !visible);
  });
}

function setPostCleanActionsVisible(visible) {
  if (!postCleanActions) return;
  postCleanActions.classList.toggle('hidden', !visible);
}

function hasAnyScanData(results = {}) {
  return Object.values(results).some((entry) => (entry?.total || 0) > 0);
}

function resetStats() {
  statTotal.textContent = EMPTY_STAT;
  statToDelete.textContent = EMPTY_STAT;
}

function updateDashboardHint(text) {
  dashboardHint.textContent = text;
}

function selectedCategoryKeys() {
  return [...categoryCards.querySelectorAll('.cat-checkbox:checked')].map((cb) => cb.dataset.key);
}

function recalcToDelete() {
  const total = collectTrashCandidates(scanResults, selectedCategoryKeys()).length;
  statToDelete.textContent = total.toLocaleString();
  btnClean.disabled = total === 0;
}

function extractSenderAddress(from = '') {
  const angleMatch = from.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].trim().toLowerCase();
  const plainMatch = from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch ? plainMatch[0].trim().toLowerCase() : '';
}

function buildSubscriptionGroups(items = []) {
  const groupMap = new Map();

  items.forEach((sub) => {
    const address = extractSenderAddress(sub.from || '');
    const domain = address.includes('@') ? address.split('@')[1] : '';
    const key = domain || address || String(sub.from || t('unknownSender')).toLowerCase();

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        domain: domain || null,
        displayLabel: domain ? `@${domain}` : (address || sub.from || t('unknownSender')),
        ids: [],
        fromSamples: new Set(),
        items: [],
      });
    }

    const group = groupMap.get(key);
    if (sub?.id) group.ids.push(sub.id);
    if (sub?.from) group.fromSamples.add(sub.from);
    group.items.push(sub);
  });

  return [...groupMap.values()]
    .map((group) => ({
      ...group,
      count: group.items.length,
      fromSamples: [...group.fromSamples].slice(0, 2),
    }))
    .sort((a, b) => b.count - a.count);
}

function refreshSubscriptionState(items) {
  subscriptions = Array.isArray(items) ? items : [];
  subscriptionGroups = buildSubscriptionGroups(subscriptions);
  subTitle.textContent = t('subscriptionsDetected', [subscriptionGroups.length.toLocaleString()]);
  subAlert.classList.toggle('hidden', subscriptionGroups.length === 0);
}

function updateSubsActionButtonLabel() {
  if (!btnTrashSubs) return;
  btnTrashSubs.textContent = subsTrashAfter.checked ? t('btnTrashSelected') : t('btnDone');
}

async function resetToHomeState() {
  cancelActiveScan();
  activeScan = null;
  scanResults = {};
  refreshSubscriptionState([]);
  resetStats();
  setStatsVisible(false);
  setProgress(0, t('progressInit'));
  scanProgress.classList.add('hidden');
  categoryCards.classList.add('hidden');
  emailPreview.classList.add('hidden');
  categoryCards.innerHTML = '';
  emailItems.innerHTML = '';
  btnClean.disabled = true;
  setPostCleanActionsVisible(false);
  setPrimaryActionsVisible(true);
  btnCancelScan.classList.add('hidden');
  btnScan.textContent = t('btnScan');
  lastScanPlanMode = 'free';
  await clearScanSession();
  await updateAccountUI();
}

function getSelectedSubscriptionIds() {
  const selectedGroupKeys = [...subsList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((el) => el.dataset.groupKey)
    .filter(Boolean);

  if (!selectedGroupKeys.length) return [];

  const idSet = new Set();
  selectedGroupKeys.forEach((key) => {
    const group = subscriptionGroups.find((item) => item.key === key);
    if (!group) return;
    group.ids.forEach((id) => idSet.add(id));
  });

  return [...idSet];
}

async function getAuthTokenInteractiveAware() {
  const silentToken = await new Promise((resolve) =>
    chrome.identity.getAuthToken({ interactive: false }, (token) => resolve(token || null))
  );

  if (silentToken) return silentToken;
  return new Promise((resolve) =>
    chrome.identity.getAuthToken({ interactive: true }, (token) => resolve(token || null))
  );
}

/**
 * Decide whether this scan can use AI. Called first in the scan click handler so the
 * permission prompt (if any) still runs inside the user gesture.
 */
async function resolveScanAI() {
  if (!hasConfiguredAI()) return false;
  let origins;
  try {
    origins = requiredOrigins(settings);
  } catch {
    showToast(t('toastAiSettingsInvalid'), 'error', 5200);
    return false;
  }
  const granted = await requestHostAccess(origins);
  if (!granted) {
    showToast(t('toastAiPermissionMissing'), 'error', 5200);
    return false;
  }
  return true;
}

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  applyI18n(document);

  if (cloudSubscribeLink) {
    if (CLOUD_SUBSCRIBE_URL) {
      cloudSubscribeLink.href = CLOUD_SUBSCRIBE_URL;
    } else {
      cloudSubscribeLink.classList.add('hidden');
    }
  }

  selectProvider.innerHTML = '';
  const providers = getProviders();
  Object.entries(providers).forEach(([id, p]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.label;
    selectProvider.appendChild(opt);
  });

  fillSettingsForm();
  initAI(buildAIConfigForInit());

  setStatsVisible(false);
  resetStats();
  setPrimaryActionsVisible(true);
  setPostCleanActionsVisible(false);
  btnCancelScan.classList.add('hidden');
  refreshSubscriptionState([]);

  loadScanSession()
    .then((session) => {
      if (!session?.scanResults) return;
      scanResults = session.scanResults;
      refreshSubscriptionState(Array.isArray(session.subscriptions) ? session.subscriptions : []);
      lastScanUsedAI = Boolean(session.lastScanUsedAI);
      lastScanPlanMode = session.lastScanPlanMode || settings.planMode || 'free';

      const hasScanData = hasAnyScanData(scanResults);
      if (hasScanData) {
        categoryCards.classList.remove('hidden');
        emailPreview.classList.remove('hidden');
        scanProgress.classList.add('hidden');
        setStatsVisible(true);
        renderCategoryCards();
        renderSummaryTable();
        recalcToDelete();

        const totalInbox = Object.values(scanResults).reduce((sum, r) => sum + (r.total || 0), 0);
        statTotal.textContent = totalInbox.toLocaleString();
        showToast(t('toastLastScanRestored'));
      }
    })
    .catch((err) => {
      console.warn('Could not restore the last scan:', err);
    });

  // Auto-detect existing login
  updateAccountUI().then(() => {
    // Detect tab account only after UI is ready
    setTimeout(detectTabAccount, 500);
  });
}

async function detectTabAccount() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    // tab.url is only exposed for hosts the extension can access; without it, rely on the
    // content script (Gmail only) answering, and on lastError for any other tab.
    if (tab.url && !tab.url.startsWith('https://mail.google.com/')) return;

    // Send message and handle potential "Receiving end does not exist" error
    chrome.tabs.sendMessage(tab.id, { type: 'GET_TAB_EMAIL' }, async (response) => {
      if (chrome.runtime.lastError) {
        // Content script not ready yet, just ignore
        return;
      }

      const tabEmail = response?.email;
      const currentInfo = await getAccountInfo();

      if (tabEmail && tabEmail !== currentInfo?.email) {
        const alertEl = document.getElementById('tab-account-alert');
        const titleEl = document.getElementById('detected-account-title');
        if (alertEl && titleEl) {
          titleEl.textContent = t('switchToAccount', [tabEmail]);
          alertEl.classList.remove('hidden');

          document.getElementById('btn-switch-detected').onclick = async () => {
            try {
              alertEl.classList.add('hidden');
              await switchAccount();
              await updateAccountUI();
              showToast(t('toastSwitchedToTabAccount'));
            } catch {
              showToast(t('toastSwitchFailed'), 'error');
            }
          };
        }
      }
    });
  } catch {
    // Silently fail tab detection to avoid blocking main UI
  }
}

function handleProviderChange() {
  const hasProvider = Boolean(selectProvider.value);
  const isOllama = selectProvider.value === 'ollama';
  ollamaRow.classList.toggle('hidden', !isOllama || !hasProvider);
  apiKeyGroup.classList.toggle('hidden', isOllama || !hasProvider);
}

function handlePlanModeChange() {
  const mode = planModeSelect.value;
  cloudPanel?.classList.toggle('hidden', mode !== 'cloud');
  advancedPanel?.classList.toggle('hidden', mode !== 'advanced');
  if (aiPrivacyGroup) {
    aiPrivacyGroup.classList.toggle('hidden', mode === 'free');
  }
  if (settingsHintBottom) {
    if (mode === 'free') {
      settingsHintBottom.textContent = t('settingsHintFree');
    } else if (mode === 'cloud') {
      settingsHintBottom.textContent = t('settingsHintCloud');
    } else {
      settingsHintBottom.textContent = t('settingsHintAdvanced');
    }
  }
  if (mode === 'advanced') {
    handleProviderChange();
  }
}

function fillSettingsForm() {
  planModeSelect.value = settings.planMode || 'free';
  cloudApiBase.value = settings.cloudBaseUrl || '';
  cloudTokenInput.value = settings.cloudToken || '';
  if (settings.provider) selectProvider.value = settings.provider;
  inputApiKey.value = settings.apiKey || '';
  inputModel.value = settings.model || '';
  inputOllamaUrl.value = settings.ollamaUrl || '';
  inputAiSendSnippet.checked = settings.aiSendSnippet !== false;
  inputAiMaskSensitive.checked = settings.aiMaskSensitive !== false;
  handleProviderChange();
  handlePlanModeChange();
}

selectProvider.addEventListener('change', handleProviderChange);
planModeSelect.addEventListener('change', handlePlanModeChange);
btnCancelScan.addEventListener('click', () => {
  cancelActiveScan();
  showToast(t('toastCancelling'), 'error', 1800);
});
btnBackHome?.addEventListener('click', async () => {
  await resetToHomeState();
  showToast(t('toastHomeRestored'));
});
btnRescan?.addEventListener('click', async () => {
  setPostCleanActionsVisible(false);
  setPrimaryActionsVisible(true);
  btnCancelScan.classList.add('hidden');
  await clearScanSession();
  btnScan.click();
});

async function updateAccountUI() {
  const btn = btnLogin;
  try {
    const info = await getAccountInfo();
    if (!info?.email) {
      const hasGmailAccess = await canAccessGmail();
      if (hasGmailAccess) {
        btn.textContent = t('accountConnectedNoProfile');
        btn.title = t('accountConnectedNoProfileTitle');
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-account');
        btnScan.disabled = false;
        updateDashboardHint(t('hintConnectedNoProfile'));
        return;
      }

      btn.textContent = t('btnConnect');
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-account');
      btn.title = t('connectTitle');
      btnScan.disabled = true;
      updateDashboardHint(t('hintConnectToEnable'));
      return;
    }
    btn.textContent = info.email.split('@')[0];
    btn.title = t('accountTitle', [info.email]);
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-account');
    btnScan.disabled = false;
    updateDashboardHint(t('hintReady'));
  } catch (err) {
    console.error('Account UI update failed:', err);
    btn.textContent = t('btnConnect');
    btnScan.disabled = true;
    updateDashboardHint(t('hintAccountCheckFailed'));
  }
}

// Single robust listener for the account button
btnLogin.addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  try {
    const info = await getAccountInfo();
    if (info?.email) {
      btn.textContent = t('btnSwitching');
      await switchAccount();
    } else {
      btn.textContent = t('btnConnecting');
      await login();
    }
    await updateAccountUI();
    const refreshed = await getAccountInfo();
    const accessOk = await canAccessGmail();
    if (!refreshed?.email && !accessOk) {
      const authError = getLastAuthError();
      throw new Error(authError || t('errOAuthNoAccess'));
    }
    showToast(refreshed?.email ? t('toastAccountConnected', [refreshed.email]) : t('toastOAuthConnectedNoProfile'));
  } catch (err) {
    console.error('Login action failed:', err);
    showToast(t('toastConnectFailed', [errorText(err)]), 'error', 5200);
    btn.textContent = originalText;
  } finally {
    btn.disabled = false;
  }
});

// ─── Settings ─────────────────────────────────────────────────────
btnOpenSettings.addEventListener('click', () => {
  fillSettingsForm();
  settingsModal.classList.remove('hidden');
});
btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

btnSaveSettings.addEventListener('click', async () => {
  const nextSettings = {
    planMode: planModeSelect.value,
    cloudBaseUrl: cloudApiBase.value.trim(),
    cloudToken: cloudTokenInput.value.trim(),
    provider: selectProvider.value,
    apiKey: inputApiKey.value.trim(),
    model: inputModel.value.trim(),
    ollamaUrl: inputOllamaUrl.value.trim(),
    aiSendSnippet: inputAiSendSnippet.checked,
    aiMaskSensitive: inputAiMaskSensitive.checked,
  };

  let origins;
  try {
    origins = requiredOrigins(nextSettings);
  } catch (err) {
    // Invalid or incomplete settings: keep the modal open so the user can fix them.
    showToast(settingsErrorText(err), 'error', 5200);
    return;
  }

  // Save before prompting: on some platforms the popup closes while Chrome shows the
  // permission dialog. A missing grant is detected again when a scan starts.
  saveSettings(nextSettings);
  initAI(buildAIConfigForInit());

  const granted = await requestHostAccess(origins);
  if (!granted) {
    showToast(t('toastPermissionDenied', [describeOrigins(origins)]), 'error', 6000);
  } else if (nextSettings.planMode === 'free') {
    showToast(t('toastSavedFree'));
  } else if (nextSettings.planMode === 'cloud') {
    showToast(t('toastSavedCloud'));
  } else {
    showToast(t('toastSavedAdvanced'));
  }
  settingsModal.classList.add('hidden');
});

// ─── Subscriptions modal ──────────────────────────────────────────
btnViewSubs.addEventListener('click', () => {
  subsList.innerHTML = '';
  subscriptionGroups.forEach((group) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'sub-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.groupKey = String(group.key || '');
    checkbox.checked = true;

    const textWrap = document.createElement('div');
    textWrap.className = 'sub-text';
    const from = document.createElement('div');
    from.className = 'sub-from';
    from.textContent = `${group.displayLabel} (${group.count})`;
    const subject = document.createElement('div');
    subject.className = 'sub-subject';
    subject.textContent = group.fromSamples.join(' • ') || t('unidentifiedSenders');

    textWrap.appendChild(from);
    textWrap.appendChild(subject);
    wrapper.appendChild(checkbox);
    wrapper.appendChild(textWrap);
    subsList.appendChild(wrapper);
  });

  subsSelectAll.checked = true;
  updateSubsActionButtonLabel();
  subsModal.classList.remove('hidden');
});
btnCloseSubs.addEventListener('click', () => subsModal.classList.add('hidden'));

subsSelectAll.addEventListener('change', () => {
  const checked = subsSelectAll.checked;
  subsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = checked;
  });
});

subsList.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== 'checkbox') return;
  const allItems = [...subsList.querySelectorAll('input[type="checkbox"]')];
  subsSelectAll.checked = allItems.length > 0 && allItems.every((item) => item.checked);
});

subsTrashAfter.addEventListener('change', updateSubsActionButtonLabel);

btnTrashSubs.addEventListener('click', async () => {
  const selectedIds = getSelectedSubscriptionIds();
  const selectedSet = new Set(selectedIds);
  const selectedSubs = subscriptions.filter((s) => selectedSet.has(s.id));
  const shouldRunGeneralUnsub = subsUseGeneralUnsub.checked;
  const shouldTrashAfter = subsTrashAfter.checked;

  if (!selectedSubs.length) {
    showToast(t('toastSelectOneSubscription'), 'error');
    return;
  }
  if (!shouldRunGeneralUnsub && !shouldTrashAfter) {
    showToast(t('toastSelectOneAction'), 'error', 4200);
    return;
  }

  subsModal.classList.add('hidden');
  scanProgress.classList.remove('hidden');

  const items = buildUnsubscribeItems(selectedSubs);
  const needsMailToken = shouldRunGeneralUnsub && items.some((item) => !item.httpUrl && item.mailtoUrl);
  const token = needsMailToken ? await getAuthTokenInteractiveAware() : null;
  const runnableItems = token ? items : items.filter((item) => item.httpUrl);
  const skippedMailto = items.length - runnableItems.length;

  if (shouldRunGeneralUnsub && skippedMailto > 0) {
    showToast(t('toastMailtoSkipped'), 'error', 4200);
  }

  try {
    let unsubSummary = { done: 0, failed: 0 };

    if (shouldRunGeneralUnsub) {
      setProgress(0, t('progressUnsubscribing', [String(runnableItems.length)]));
      unsubSummary = await runUnsubscribeEngine(runnableItems, token, (done, total, current) => {
        const safeTotal = Math.max(total, 1);
        setProgress((done / safeTotal) * 80, t('progressUnsubscribeStep', [String(done), String(total), current || '']));
      });
    }

    if (shouldTrashAfter) {
      setProgress(80, t('progressTrashingCount', [String(selectedIds.length)]));
      await trashEmailsBatch(selectedIds, (done, total) =>
        setProgress(80 + (done / total) * 20, t('progressTrashStep', [String(done), String(total)]))
      );
      refreshSubscriptionState(subscriptions.filter((sub) => !selectedSet.has(sub.id)));
    }

    renderSummaryTable();
    await saveScanSession();
    setProgress(100, t('progressSubsDone', [
      String(unsubSummary.done),
      String(unsubSummary.failed),
      String(shouldRunGeneralUnsub ? skippedMailto : 0),
    ]));
    showToast(t('toastSubsDone'));
  } catch (err) {
    showToast(t('toastSubsFailed', [errorText(err)]), 'error', 4500);
    setProgress(100, t('progressSubsFailed'));
  }
});

// ─── Scan ─────────────────────────────────────────────────────────
btnScan.addEventListener('click', async () => {
  cancelActiveScan();
  const scanContext = { cancelled: false };
  activeScan = scanContext;

  const useAI = await resolveScanAI();

  const account = await getAccountInfo();
  const hasGmailAccess = account?.email ? true : await canAccessGmail();
  if (!hasGmailAccess) {
    const authError = getLastAuthError();
    showToast(
      authError ? t('toastGmailSessionUnavailable', [authError]) : t('toastConnectBeforeScan'),
      'error',
      5200
    );
    activeScan = null;
    return;
  }

  btnScan.disabled = true;
  btnClean.disabled = true;
  btnScan.textContent = t('btnScanning');
  setPrimaryActionsVisible(true);
  setPostCleanActionsVisible(false);
  scanResults = {};
  refreshSubscriptionState([]);
  lastScanUsedAI = useAI;
  lastScanPlanMode = settings.planMode || 'free';
  resetStats();
  categoryCards.innerHTML = '';
  emailItems.innerHTML = '';
  scanProgress.classList.remove('hidden');
  setProgress(0, t('progressNewScan'));
  categoryCards.classList.remove('hidden');
  emailPreview.classList.remove('hidden');
  subAlert.classList.add('hidden');
  setStatsVisible(true);
  btnCancelScan.classList.remove('hidden');
  updateDashboardHint(
    !lastScanUsedAI
      ? t('hintScanHeuristic')
      : lastScanPlanMode === 'cloud'
        ? t('hintScanCloud')
        : t('hintScanAdvanced'),
  );

  if (lastScanUsedAI) {
    initAI(buildAIConfigForInit());
  }

  try {
    let grandTotal = 0;
    const allCategoryIds = {};

    // ── Phase 1: Collect all message IDs per category ────────────────
    for (let i = 0; i < GMAIL_CATEGORIES.length; i++) {
      assertScanActive(scanContext);
      const { key, labelKey, q } = GMAIL_CATEGORIES[i];
      const label = t(labelKey);
      setProgress((i / GMAIL_CATEGORIES.length) * 20, t('progressScanningCategory', [label]));
      try {
        const ids = await fetchAllIds(q, (n) =>
          setProgress((i / GMAIL_CATEGORIES.length) * 20, t('progressCategoryFound', [label, n.toLocaleString()]))
        );
        assertScanActive(scanContext);
        allCategoryIds[key] = ids;
        grandTotal += ids.length;
      } catch (err) {
        assertScanActive(scanContext);
        allCategoryIds[key] = [];
        console.error(`Scan error for ${key}:`, err);
      }
    }
    statTotal.textContent = grandTotal.toLocaleString();

    // ── Phase 2: Fetch details + classify per category ───────────────
    let catIndex = 0;
    const subMap = new Map();
    for (const { key, labelKey } of GMAIL_CATEGORIES) {
      assertScanActive(scanContext);
      const label = t(labelKey);
      const ids = allCategoryIds[key] || [];
      if (ids.length === 0) {
        scanResults[key] = { total: 0, disposableIds: [], disposableItems: [], keptCount: 0 };
        catIndex++;
        continue;
      }

      const basePct = 20 + (catIndex / GMAIL_CATEGORIES.length) * 70;
      const slicePct = 70 / GMAIL_CATEGORIES.length;
      let emails = [];

      // Fetch details in parallel batches
      for (let i = 0; i < ids.length; i += DETAIL_PARALLEL) {
        assertScanActive(scanContext);
        const chunk = ids.slice(i, i + DETAIL_PARALLEL);
        const pct = basePct + ((i / ids.length) * slicePct * 0.5);
        setProgress(pct, t('progressFetching', [
          label,
          Math.min(i + DETAIL_PARALLEL, ids.length).toLocaleString(),
          ids.length.toLocaleString(),
        ]));
        const details = await fetchDetailsBatch(chunk);
        assertScanActive(scanContext);
        emails = emails.concat(details);
      }

      // Heuristic pre-filter
      setProgress(basePct + slicePct * 0.5, t('progressHeuristic', [label]));
      const { disposable: hDisposable, subscriptions: hSubs, needsAI } = classifyBatch(emails);
      hSubs.forEach((sub) => {
        if (sub?.id) subMap.set(sub.id, sub);
      });

      const disposableIdSet = new Set(hDisposable.map((e) => e.id));
      const subscriptionIdSet = new Set(hSubs.map((e) => e.id));

      if (lastScanUsedAI && needsAI.length > 0) {
        // AI on what heuristic didn't catch
        const totalBatches = Math.ceil(needsAI.length / AI_BATCH_SIZE);
        for (let b = 0; b < totalBatches; b++) {
          assertScanActive(scanContext);
          const batch = needsAI.slice(b * AI_BATCH_SIZE, (b + 1) * AI_BATCH_SIZE);
          const pct = basePct + slicePct * 0.5 + ((b / Math.max(totalBatches, 1)) * slicePct * 0.5);
          setProgress(pct, t('progressAiBatch', [label, String(b + 1), String(totalBatches)]));
          try {
            const results = await categorizeEmails(batch, {
              includeSnippet: settings.aiSendSnippet !== false,
              maskSensitive: settings.aiMaskSensitive !== false,
            });
            assertScanActive(scanContext);
            results.forEach((r) => {
              if (r?.category === 'Disposable' && r?.id) disposableIdSet.add(r.id);
            });
          } catch (err) {
            assertScanActive(scanContext);
            console.error(`AI batch ${b + 1} (${key}) error:`, err);
          }
        }
      }

      scanResults[key] = {
        total: emails.length,
        disposableIds: [...disposableIdSet],
        // Sender and subject kept locally so the user can review each message before trashing.
        disposableItems: emails.filter((e) => disposableIdSet.has(e.id)).map(toPreviewItem),
        keptCount: Math.max(emails.length - disposableIdSet.size - subscriptionIdSet.size, 0),
      };
      catIndex++;
    }

    refreshSubscriptionState([...subMap.values()]);

    setProgress(100, t('progressScanDone'));
    renderCategoryCards();
    renderSummaryTable();
    recalcToDelete();
    await saveScanSession();
    showToast(lastScanUsedAI ? t('toastScanDoneAi') : t('toastScanDoneHeuristic'));
  } catch (err) {
    console.error('Scan failed:', err);
    if (err instanceof ScanCancelledError) {
      showToast(t('scanCancelled'));
      setProgress(100, t('scanCancelled'));
    } else {
      showToast(t('toastScanFailed', [errorText(err)]), 'error', 4800);
      setProgress(100, t('progressScanFailed'));
    }
  } finally {
    btnScan.disabled = false;
    btnScan.textContent = t('btnScan');
    btnCancelScan.classList.add('hidden');
    activeScan = null;
  }
});

// ─── Trash preview and clean ──────────────────────────────────────
function selectedTrashIds() {
  return [...trashList.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.dataset.id);
}

function updateTrashSelection() {
  const selected = selectedTrashIds().length;
  trashCount.textContent = t('previewCount', [selected.toLocaleString(), trashCandidates.length.toLocaleString()]);
  btnConfirmTrash.textContent = t('btnConfirmTrash', [selected.toLocaleString()]);
  btnConfirmTrash.disabled = selected === 0;
  trashSelectAll.checked = selected === trashCandidates.length;
}

function renderTrashPreview() {
  const fragment = document.createDocumentFragment();
  for (const item of trashCandidates) {
    const row = document.createElement('label');
    row.className = 'sub-item preview-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.id = item.id;

    const textWrap = document.createElement('div');
    textWrap.className = 'sub-text';
    const from = document.createElement('div');
    from.className = 'sub-from';
    from.textContent = item.hasDetails ? (item.from || t('unknownSender')) : t('previewNoDetails');
    const subject = document.createElement('div');
    subject.className = 'sub-subject';
    subject.textContent = item.hasDetails ? (item.subject || t('noSubject')) : item.id;
    const category = document.createElement('span');
    category.className = 'preview-category';
    category.textContent = categoryLabel(item.category);

    textWrap.appendChild(from);
    textWrap.appendChild(subject);
    row.appendChild(checkbox);
    row.appendChild(textWrap);
    row.appendChild(category);
    fragment.appendChild(row);
  }
  trashList.replaceChildren(fragment);
}

btnClean.addEventListener('click', () => {
  trashCandidates = collectTrashCandidates(scanResults, selectedCategoryKeys());
  if (!trashCandidates.length) return;
  renderTrashPreview();
  updateTrashSelection();
  trashModal.classList.remove('hidden');
});

btnCloseTrash.addEventListener('click', () => trashModal.classList.add('hidden'));
trashList.addEventListener('change', updateTrashSelection);
trashSelectAll.addEventListener('change', () => {
  trashList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = trashSelectAll.checked;
  });
  updateTrashSelection();
});

btnConfirmTrash.addEventListener('click', async () => {
  const ids = selectedTrashIds();
  if (!ids.length) return;
  trashModal.classList.add('hidden');

  btnClean.disabled = true;
  btnScan.disabled = true;
  scanProgress.classList.remove('hidden');
  try {
    // messages.trash: moves to Gmail Trash; nothing is deleted permanently.
    await trashEmailsBatch(ids, (done, total) =>
      setProgress((done / total) * 100, t('progressRemoving', [done.toLocaleString(), total.toLocaleString()]))
    );
    setProgress(100, t('progressCleanDone'));
    showToast(t('toastCleanDone'));
    scanResults = {};
    trashCandidates = [];
    resetStats();
    setStatsVisible(false);
    categoryCards.innerHTML = '';
    emailItems.innerHTML = '';
    categoryCards.classList.add('hidden');
    emailPreview.classList.add('hidden');
    scanProgress.classList.add('hidden');
    setPrimaryActionsVisible(false);
    setPostCleanActionsVisible(true);
    updateDashboardHint(t('hintCleanDone'));
    await saveScanSession();
  } catch (err) {
    showToast(t('toastCleanFailed', [errorText(err)]), 'error', 4800);
    btnScan.disabled = false;
    btnClean.disabled = false;
  }
});

// ─── Render ───────────────────────────────────────────────────────
function renderCategoryCards() {
  const fragment = document.createDocumentFragment();
  for (const { key, labelKey } of GMAIL_CATEGORIES) {
    const r = scanResults[key];
    if (!r || r.total === 0) continue;
    const disposableCount = r.disposableIds?.length || 0;

    const card = document.createElement('div');
    card.className = 'cat-card';

    const label = document.createElement('label');
    label.className = 'cat-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'cat-checkbox';
    checkbox.dataset.key = key;
    checkbox.checked = disposableCount > 0;
    checkbox.disabled = disposableCount === 0;
    checkbox.addEventListener('change', recalcToDelete);
    const name = document.createElement('span');
    name.className = 'cat-name';
    name.textContent = t(labelKey);
    label.append(checkbox, name);

    const stats = document.createElement('div');
    stats.className = 'cat-stats';
    const toRemove = document.createElement('span');
    toRemove.className = 'badge badge-disposable';
    toRemove.title = t('badgeToRemoveTitle');
    toRemove.textContent = t('badgeToRemove', [disposableCount.toLocaleString()]);
    const kept = document.createElement('span');
    kept.className = 'badge badge-kept';
    kept.title = t('badgeKeptTitle');
    kept.textContent = t('badgeKept', [(r.keptCount || 0).toLocaleString()]);
    stats.append(toRemove, kept);

    card.append(label, stats);
    fragment.appendChild(card);
  }
  categoryCards.replaceChildren(fragment);
}

function summaryRow(label, count, badgeClass) {
  const row = document.createElement('tr');
  const labelCell = document.createElement('td');
  labelCell.textContent = label;
  const countCell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `badge ${badgeClass}`;
  badge.textContent = count.toLocaleString();
  countCell.appendChild(badge);
  row.append(labelCell, countCell);
  return row;
}

function renderSummaryTable() {
  const totalDisposable = Object.values(scanResults).reduce((s, r) => s + (r.disposableIds?.length || 0), 0);
  const totalKept       = Object.values(scanResults).reduce((s, r) => s + (r.keptCount || 0), 0);
  const method = !lastScanUsedAI
    ? t('methodHeuristic')
    : lastScanPlanMode === 'cloud'
      ? t('methodHeuristicCloud')
      : t('methodHeuristicAdvanced');

  emailItems.replaceChildren(
    summaryRow(t('summaryDisposable', [method]), totalDisposable, 'badge-disposable'),
    summaryRow(t('summaryKept', [method]), totalKept, 'badge-kept'),
    summaryRow(t('summarySubscriptions'), subscriptionGroups.length, 'badge-subscription'),
  );
}

init();
