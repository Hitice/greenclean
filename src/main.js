import './style.css'
import { login, switchAccount, getAccountInfo, fetchAllIds, fetchDetailsBatch, trashEmailsBatch, getLastAuthError, canAccessGmail } from './gmail.js'
import { initAI, categorizeEmails, getProviders } from './ai.js'
import { CLOUD_SUBSCRIBE_URL, DEFAULT_CLOUD_API_BASE } from './ai-config.js'
import { classifyBatch } from './classifier.js'
import { buildUnsubscribeItems, runUnsubscribeEngine } from './unsubscriber.js'

// ─── Config ──────────────────────────────────────────────────────
const DETAIL_PARALLEL = 25;
const AI_BATCH_SIZE   = 30;
const SETTINGS_KEY = 'gc_settings';
const SESSION_KEY = 'gc_last_scan';
const EMPTY_STAT = '—';

const GMAIL_CATEGORIES = [
  { key: 'promotions', label: 'Promoções', q: 'category:promotions in:inbox' },
  { key: 'social',     label: 'Social',    q: 'category:social in:inbox'     },
  { key: 'updates',    label: 'Atualizações', q: 'category:updates in:inbox' },
  { key: 'primary',    label: 'Principal', q: 'category:primary in:inbox'    },
];

// ─── State ───────────────────────────────────────────────────────
let scanResults    = {}; // { key: { total, disposableIds, keptCount } }
let subscriptions  = [];
let subscriptionGroups = [];
let settings       = loadSettings();
let lastScanUsedAI = false;
let lastScanPlanMode = 'free';

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
const subCount       = document.getElementById('sub-count');
const subAlert       = document.getElementById('subscription-alert');
const subsList       = document.getElementById('subs-list');
const subsSelectAll  = document.getElementById('subs-select-all');
const subsUseGeneralUnsub = document.getElementById('subs-use-general-unsub');
const subsTrashAfter = document.getElementById('subs-trash-after');
const toastContainer = document.getElementById('toast-container');

let activeScan = null;

// ─── Helpers ─────────────────────────────────────────────────────
function migrateLegacySettings(parsed) {
  const base = {
    planMode: 'free',
    cloudBaseUrl: DEFAULT_CLOUD_API_BASE,
    cloudToken: '',
    provider: '',
    apiKey: '',
    model: '',
    ollamaUrl: '',
    aiSendSnippet: true,
    aiMaskSensitive: true,
    ...parsed,
  };
  if (base.planMode) return base;
  if (base.provider) {
    return { ...base, planMode: 'advanced' };
  }
  return { ...base, planMode: 'free' };
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return migrateLegacySettings(parsed);
  } catch (err) {
    console.warn('Invalid saved settings. Resetting.', err);
    return migrateLegacySettings({});
  }
}

function saveSettings(nextSettings) {
  settings = nextSettings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(nextSettings));
}

function assertScanActive(scanContext) {
  if (!scanContext || scanContext.cancelled) {
    throw new Error('Análise cancelada pelo usuário.');
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

async function requestCloudHostPermissionIfNeeded(url) {
  if (!url || !chrome?.permissions?.request) return;
  try {
    const u = new URL(url);
    const origin = `${u.protocol}//${u.host}/*`;
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (has) return;
    await chrome.permissions.request({ origins: [origin] });
  } catch (err) {
    console.warn('Host opcional não concedido (IA nuvem pode falhar):', err);
  }
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

function recalcToDelete() {
  let total = 0;
  categoryCards.querySelectorAll('.cat-checkbox:checked').forEach(cb => {
    total += (scanResults[cb.dataset.key]?.disposableIds?.length || 0);
  });
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
    const key = domain || address || String(sub.from || '(remetente desconhecido)').toLowerCase();

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        domain: domain || null,
        displayLabel: domain ? `@${domain}` : (address || sub.from || '(remetente desconhecido)'),
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
  subCount.textContent = subscriptionGroups.length.toLocaleString();
  subAlert.classList.toggle('hidden', subscriptionGroups.length === 0);
}

function updateSubsActionButtonLabel() {
  if (!btnTrashSubs) return;
  btnTrashSubs.textContent = subsTrashAfter.checked ? 'Lixeira selecionados' : 'Concluído';
}

async function resetToHomeState() {
  cancelActiveScan();
  activeScan = null;
  scanResults = {};
  refreshSubscriptionState([]);
  resetStats();
  setStatsVisible(false);
  setProgress(0, 'Inicializando...');
  scanProgress.classList.add('hidden');
  categoryCards.classList.add('hidden');
  emailPreview.classList.add('hidden');
  categoryCards.innerHTML = '';
  emailItems.innerHTML = '';
  btnClean.disabled = true;
  setPostCleanActionsVisible(false);
  setPrimaryActionsVisible(true);
  btnCancelScan.classList.add('hidden');
  btnScan.textContent = 'Analisar caixa';
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

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  if (cloudSubscribeLink) {
    cloudSubscribeLink.href = CLOUD_SUBSCRIBE_URL;
  }

  selectProvider.innerHTML = '';
  const providers = getProviders();
  Object.entries(providers).forEach(([id, p]) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = p.label;
    selectProvider.appendChild(opt);
  });

  planModeSelect.value = settings.planMode || 'free';
  cloudApiBase.value = settings.cloudBaseUrl || '';
  cloudTokenInput.value = settings.cloudToken || '';
  if (settings.provider) selectProvider.value = settings.provider;
  if (settings.apiKey) inputApiKey.value = settings.apiKey;
  if (settings.model) inputModel.value = settings.model;
  if (settings.ollamaUrl) inputOllamaUrl.value = settings.ollamaUrl;
  inputAiSendSnippet.checked = settings.aiSendSnippet !== false;
  inputAiMaskSensitive.checked = settings.aiMaskSensitive !== false;
  handleProviderChange();
  handlePlanModeChange();

  initAI(buildAIConfigForInit());

  setStatsVisible(false);
  resetStats();
  setPrimaryActionsVisible(true);
  setPostCleanActionsVisible(false);
  btnCancelScan.classList.add('hidden');

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
        showToast('Última análise restaurada.');
      }
    })
    .catch((err) => {
      console.warn('Falha ao restaurar sessão:', err);
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
    if (!tab?.url?.includes('mail.google.com')) return;

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
        const emailEl = document.getElementById('detected-email');
        if (alertEl && emailEl) {
          emailEl.textContent = tabEmail;
          alertEl.classList.remove('hidden');

          document.getElementById('btn-switch-detected').onclick = async () => {
            try {
              alertEl.classList.add('hidden');
              await switchAccount();
              await updateAccountUI();
              showToast('Conta da aba ativa selecionada.');
            } catch (err) {
              showToast('Não foi possível trocar de conta agora.', 'error');
            }
          };
        }
      }
    });
  } catch (err) {
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
      settingsHintBottom.textContent = 'Plano grátis: tudo ocorre no seu computador, sem chaves de API.';
    } else if (mode === 'cloud') {
      settingsHintBottom.textContent = 'A nuvem processa a classificação; veja a política de privacidade no site.';
    } else {
      settingsHintBottom.textContent = 'Chaves e Ollama ficam apenas neste navegador (modo avançado).';
    }
  }
  if (mode === 'advanced') {
    handleProviderChange();
  }
}

selectProvider.addEventListener('change', handleProviderChange);
planModeSelect.addEventListener('change', handlePlanModeChange);
btnCancelScan.addEventListener('click', () => {
  cancelActiveScan();
  showToast('Cancelando análise...', 'error', 1800);
});
btnBackHome?.addEventListener('click', async () => {
  await resetToHomeState();
  showToast('Tela inicial restaurada.');
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
        btn.textContent = 'conectado';
        btn.title = 'Conectado via OAuth. Perfil indisponível, mas Gmail autorizado.';
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-account');
        btnScan.disabled = false;
        updateDashboardHint('Conectado sem perfil visível. Você já pode analisar a caixa.');
        return;
      }

      btn.textContent = 'Conectar';
      btn.classList.add('btn-primary');
      btn.classList.remove('btn-account');
      btn.title = 'Clique para conectar sua conta Gmail';
      btnScan.disabled = true;
      updateDashboardHint('Conecte sua conta para habilitar a análise.');
      return;
    }
    btn.textContent = info.email.split('@')[0];
    btn.title = `Conectado como ${info.email}. Clique para trocar de conta.`;
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-account');
    btnScan.disabled = false;
    updateDashboardHint('Pronto para analisar. Os contadores aparecem quando a varredura iniciar.');
  } catch (err) {
    console.error('Account UI update failed:', err);
    btn.textContent = 'Conectar';
    btnScan.disabled = true;
    updateDashboardHint('Falha ao verificar conta. Tente conectar novamente.');
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
      btn.textContent = 'Trocando...';
      await switchAccount();
    } else {
      btn.textContent = 'Conectando...';
      await login();
    }
    await updateAccountUI();
    const refreshed = await getAccountInfo();
    const accessOk = await canAccessGmail();
    if (!refreshed?.email && !accessOk) {
      const authError = getLastAuthError();
      throw new Error(authError || 'OAuth autenticou, mas o Gmail não respondeu com acesso válido.');
    }
    showToast(refreshed?.email ? `Conta conectada: ${refreshed.email}` : 'OAuth conectado. Perfil indisponível, mas Gmail autorizado.');
  } catch (err) {
    console.error('Login action failed:', err);
    showToast(`Falha ao conectar: ${err?.message || 'erro desconhecido'}`, 'error', 5200);
    btn.textContent = originalText;
  } finally {
    btn.disabled = false;
  }
});

// ─── Settings ─────────────────────────────────────────────────────
btnOpenSettings.addEventListener('click', () => {
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

  if (nextSettings.planMode === 'cloud' && nextSettings.cloudBaseUrl) {
    await requestCloudHostPermissionIfNeeded(nextSettings.cloudBaseUrl);
  }

  saveSettings(nextSettings);
  initAI(buildAIConfigForInit());
  if (nextSettings.planMode === 'free') {
    showToast('Plano grátis salvo — só heurística local.');
  } else if (nextSettings.planMode === 'cloud') {
    showToast('Plano de IA na nuvem salvo. Verifique token e URL.');
  } else {
    showToast('Modo avançado (chave/Ollama) salvo.');
  }
  settingsModal.classList.add('hidden');
});

// ─── Subscriptions modal ──────────────────────────────────────────
btnViewSubs.addEventListener('click', () => {
  subsList.innerHTML = '';
  subscriptionGroups.forEach((group) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'sub-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.groupKey = String(group.key || '');
    checkbox.checked = true;

    const textWrap = document.createElement('div');
    const from = document.createElement('div');
    from.className = 'sub-from';
    from.textContent = `${group.displayLabel} (${group.count})`;
    const subject = document.createElement('div');
    subject.className = 'sub-subject';
    subject.textContent = group.fromSamples.join(' • ') || 'Remetentes não identificados';

    textWrap.appendChild(from);
    textWrap.appendChild(subject);
    wrapper.appendChild(checkbox);
    wrapper.appendChild(textWrap);
    subsList.appendChild(wrapper);
  });

  subsSelectAll.checked = true;
  subsList.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = true;
  });
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
  const selectedSubs = subscriptions.filter(s => selectedIds.includes(s.id));

  if (!selectedSubs.length) {
    showToast('Selecione ao menos uma inscrição.', 'error');
    return;
  }

  subsModal.classList.add('hidden');
  scanProgress.classList.remove('hidden');

  const items = buildUnsubscribeItems(selectedSubs);
  const needsMailToken = items.some((item) => !item.httpUrl && item.mailtoUrl);
  const token = needsMailToken ? await getAuthTokenInteractiveAware() : null;
  const runnableItems = token ? items : items.filter((item) => item.httpUrl);
  const skippedMailto = items.length - runnableItems.length;
  const shouldRunGeneralUnsub = subsUseGeneralUnsub.checked;
  const shouldTrashAfter = subsTrashAfter.checked;

  if (!shouldRunGeneralUnsub && !shouldTrashAfter) {
    showToast('Escolha ao menos uma ação: unsubscribe geral ou mover para lixeira.', 'error', 4200);
    return;
  }

  if (shouldRunGeneralUnsub && skippedMailto > 0) {
    showToast('Alguns cancelamentos por mailto foram ignorados por falta de autenticação.', 'error', 4200);
  }

  try {
    let unsubSummary = { done: 0, failed: 0 };

    if (shouldRunGeneralUnsub) {
      setProgress(0, `Cancelando ${runnableItems.length} inscrições...`);
      unsubSummary = await runUnsubscribeEngine(runnableItems, token, (done, total, current) => {
        const safeTotal = Math.max(total, 1);
        setProgress((done / safeTotal) * 80, `Cancelando: ${done}/${total} — ${current || ''}`);
      });
    }

    if (shouldTrashAfter) {
      const allIdsToTrash = [...selectedIds];
      setProgress(80, `Movendo ${allIdsToTrash.length} e-mails para lixeira...`);
      await trashEmailsBatch(allIdsToTrash, (done, total) =>
        setProgress(80 + (done / total) * 20, `Lixeira: ${done}/${total}`)
      );

      const selectedSet = new Set(selectedIds);
      refreshSubscriptionState(subscriptions.filter((sub) => !selectedSet.has(sub.id)));
    }

    renderSummaryTable();
    await saveScanSession();
    setProgress(100, `Concluído. Cancelados: ${unsubSummary.done}, falhas: ${unsubSummary.failed}, mailto ignorados: ${shouldRunGeneralUnsub ? skippedMailto : 0}.`);
    showToast('Processo de inscrições concluído.');
    if (shouldRunGeneralUnsub) {
      console.log('Unsubscribe engine complete:', unsubSummary);
    }
  } catch (err) {
    showToast(`Falha ao processar inscrições: ${err.message || 'erro desconhecido'}`, 'error', 4500);
    setProgress(100, 'Falha ao processar inscrições.');
  }
});

// ─── Scan ─────────────────────────────────────────────────────────
btnScan.addEventListener('click', async () => {
  cancelActiveScan();
  const scanContext = { cancelled: false };
  activeScan = scanContext;

  const account = await getAccountInfo();
  const hasGmailAccess = account?.email ? true : await canAccessGmail();
  if (!hasGmailAccess) {
    const authError = getLastAuthError();
    showToast(
      authError
        ? `Sessão Gmail indisponível: ${authError}`
        : 'Conecte sua conta Gmail antes de analisar.',
      'error',
      5200
    );
    activeScan = null;
    return;
  }

  btnScan.disabled = true;
  btnClean.disabled = true;
  btnScan.textContent = 'Analisando...';
  setPrimaryActionsVisible(true);
  setPostCleanActionsVisible(false);
  scanResults = {};
  refreshSubscriptionState([]);
  lastScanUsedAI = hasConfiguredAI();
  lastScanPlanMode = settings.planMode || 'free';
  resetStats();
  categoryCards.innerHTML = '';
  emailItems.innerHTML = '';
  scanProgress.classList.remove('hidden');
  setProgress(0, 'Iniciando nova análise...');
  categoryCards.classList.remove('hidden');
  emailPreview.classList.remove('hidden');
  subAlert.classList.add('hidden');
  setStatsVisible(true);
  btnCancelScan.classList.remove('hidden');
  updateDashboardHint(
    !lastScanUsedAI
      ? 'Analisando apenas com heurística local (plano grátis).'
      : lastScanPlanMode === 'cloud'
        ? 'Analisando com heurística + IA na nuvem (assinatura).'
        : 'Analisando com heurística + IA (chave ou Ollama local).',
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
      const { key, label, q } = GMAIL_CATEGORIES[i];
      setProgress((i / GMAIL_CATEGORIES.length) * 20, `Escaneando ${label}...`);
      try {
        const ids = await fetchAllIds(q, (n) =>
          setProgress((i / GMAIL_CATEGORIES.length) * 20, `${label}: ${n.toLocaleString()} encontrados`)
        );
        assertScanActive(scanContext);
        allCategoryIds[key] = ids;
        grandTotal += ids.length;
      } catch (err) {
        assertScanActive(scanContext);
        allCategoryIds[key] = [];
        console.error(`Scan error for ${label}:`, err);
      }
    }
    statTotal.textContent = grandTotal.toLocaleString();

    // ── Phase 2: Fetch details + classify per category ───────────────
    let catIndex = 0;
    const subMap = new Map();
    for (const { key, label } of GMAIL_CATEGORIES) {
      assertScanActive(scanContext);
      const ids = allCategoryIds[key] || [];
      if (ids.length === 0) {
        scanResults[key] = { total: 0, disposableIds: [], keptCount: 0 };
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
        setProgress(pct, `${label}: buscando ${Math.min(i + DETAIL_PARALLEL, ids.length).toLocaleString()}/${ids.length.toLocaleString()}`);
        const details = await fetchDetailsBatch(chunk);
        assertScanActive(scanContext);
        emails = emails.concat(details);
      }

      // Heuristic pre-filter
      setProgress(basePct + slicePct * 0.5, `${label}: análise heurística...`);
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
          setProgress(pct, `${label}: IA classificando lote ${b + 1}/${totalBatches}`);
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
            console.error(`AI batch ${b + 1} (${label}) error:`, err);
          }
        }
      }

      scanResults[key] = {
        total: emails.length,
        disposableIds: [...disposableIdSet],
        keptCount: Math.max(emails.length - disposableIdSet.size - subscriptionIdSet.size, 0),
      };
      catIndex++;
    }

    refreshSubscriptionState([...subMap.values()]);

    setProgress(100, 'Análise concluída.');
    renderCategoryCards();
    renderSummaryTable();
    recalcToDelete();
    await saveScanSession();
    showToast(lastScanUsedAI ? 'Análise finalizada com IA.' : 'Análise heurística finalizada.');
  } catch (err) {
    console.error('Scan failed:', err);
    if (String(err.message || '').includes('cancelada')) {
      showToast('Análise cancelada.');
      setProgress(100, 'Análise cancelada.');
    } else {
      showToast(`Falha na análise: ${err.message || 'erro desconhecido'}`, 'error', 4800);
      setProgress(100, 'Análise com falha.');
    }
  } finally {
    btnScan.disabled = false;
    btnScan.textContent = 'Analisar caixa';
    btnCancelScan.classList.add('hidden');
    activeScan = null;
  }
});

// ─── Clean ────────────────────────────────────────────────────────
btnClean.addEventListener('click', async () => {
  const ids = [];
  categoryCards.querySelectorAll('.cat-checkbox:checked').forEach(cb => {
    ids.push(...(scanResults[cb.dataset.key]?.disposableIds || []));
  });
  if (!ids.length) return;
  if (!confirm(
    `Mover ${ids.length.toLocaleString()} itens para a lixeira?\n\n` +
    `Atenção: revise a pasta Lixeira para confirmar se não há mensagens importantes antes da exclusão definitiva.`
  )) return;

  btnClean.disabled = true;
  btnScan.disabled = true;
  try {
    await trashEmailsBatch(ids, (done, total) =>
      setProgress((done / total) * 100, `Removendo: ${done.toLocaleString()} / ${total.toLocaleString()}`)
    );
    setProgress(100, 'Limpeza concluída.');
    showToast('E-mails enviados para a lixeira. Confira itens importantes na Lixeira.');
    scanResults = {};
    resetStats();
    setStatsVisible(false);
    categoryCards.innerHTML = '';
    emailItems.innerHTML = '';
    categoryCards.classList.add('hidden');
    emailPreview.classList.add('hidden');
    scanProgress.classList.add('hidden');
    setPrimaryActionsVisible(false);
    setPostCleanActionsVisible(true);
    updateDashboardHint('Limpeza concluída. Revise descadastros ou volte ao início para nova análise.');
    await saveScanSession();
  } catch (err) {
    showToast(`Falha na limpeza: ${err.message || 'erro desconhecido'}`, 'error', 4800);
    btnScan.disabled = false;
    btnClean.disabled = false;
  }
});

// ─── Render ───────────────────────────────────────────────────────
function renderCategoryCards() {
  categoryCards.innerHTML = GMAIL_CATEGORIES.map(({ key, label }) => {
    const r = scanResults[key];
    if (!r || r.total === 0) return '';
    return `
      <div class="cat-card">
        <label class="cat-label">
          <input type="checkbox" class="cat-checkbox" data-key="${key}" ${r.disposableIds.length > 0 ? 'checked' : 'disabled'}>
          <span class="cat-name">${label}</span>
        </label>
        <div class="cat-stats">
          <span class="badge badge-disposable" title="Marcados como descartáveis">${r.disposableIds.length.toLocaleString()} para remover</span>
          <span class="badge badge-kept" title="Marcados como úteis">${r.keptCount.toLocaleString()} mantidos</span>
        </div>
      </div>
    `;
  }).join('');

  categoryCards.querySelectorAll('.cat-checkbox').forEach(cb => {
    cb.addEventListener('change', recalcToDelete);
  });
}

function renderSummaryTable() {
  const totalDisposable = Object.values(scanResults).reduce((s, r) => s + r.disposableIds.length, 0);
  const totalKept       = Object.values(scanResults).reduce((s, r) => s + r.keptCount, 0);
  const totalSubs = subscriptionGroups.length;
  let iaSuffix = '';
  if (lastScanUsedAI) {
    iaSuffix = lastScanPlanMode === 'cloud' ? ' (nuvem)' : ' (avançada)';
  }
  const disposableLabel = lastScanUsedAI
    ? `Heurística + IA${iaSuffix} — descartáveis`
    : 'Heurística — descartáveis';
  const keptLabel = lastScanUsedAI
    ? `Heurística + IA${iaSuffix} — úteis`
    : 'Heurística — úteis';

  emailItems.innerHTML = `
    <tr>
      <td>${disposableLabel}</td>
      <td><span class="badge badge-disposable">${totalDisposable.toLocaleString()}</span></td>
    </tr>
    <tr>
      <td>${keptLabel}</td>
      <td><span class="badge badge-kept">${totalKept.toLocaleString()}</span></td>
    </tr>
    <tr>
      <td>Assinaturas detectadas (domínios)</td>
      <td><span class="badge badge-subscription">${totalSubs.toLocaleString()}</span></td>
    </tr>
  `;
}

init();
