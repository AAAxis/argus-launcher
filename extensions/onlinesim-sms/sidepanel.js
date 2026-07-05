const els = {
  status: document.getElementById('status'),
  phone: document.getElementById('phone'),
  smsOperation: document.getElementById('sms-operation'),
  smsCode: document.getElementById('sms-code'),
  smsText: document.getElementById('sms-text'),
  smsService: document.getElementById('sms-service'),
  smsCountry: document.getElementById('sms-country'),
  fetchPhone: document.getElementById('fetch-phone'),
  setupPanel: document.getElementById('setup-panel'),
  mainPanel: document.getElementById('main-panel'),
  setupApiKey: document.getElementById('setup-api-key'),
  setupSave: document.getElementById('setup-save'),
  setupError: document.getElementById('setup-error'),
  changeApiKey: document.getElementById('change-api-key'),
};

let smsPollTimer = null;
let smsPollAttempts = 0;

async function copyText(text) {
  await navigator.clipboard.writeText(text || '');
}

function setButtonBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
    button.textContent = busyText || button.textContent;
    button.classList.add('is-busy');
    button.disabled = true;
  } else {
    button.textContent = button.dataset.idleText || button.textContent;
    delete button.dataset.idleText;
    button.classList.remove('is-busy');
    button.disabled = false;
  }
}

function renderSmsState(state) {
  if (state.operationId) els.smsOperation.value = state.operationId;
  if (state.phone) els.phone.value = state.phone;
  if (state.smsCode) els.smsCode.value = state.smsCode;
  if (state.smsText) {
    els.smsText.value = state.smsText;
    els.smsText.classList.add('has-text');
  }
}

function stopSmsPolling() {
  if (smsPollTimer) clearInterval(smsPollTimer);
  smsPollTimer = null;
  smsPollAttempts = 0;
}

async function checkSmsState(options = {}) {
  const operationId = els.smsOperation.value.trim();
  if (!operationId) {
    if (!options.silent) els.status.textContent = 'No SMS operation yet.';
    return null;
  }

  try {
    const state = await OnlineSim.getState(operationId);
    renderSmsState(state);
    if (state.smsCode || state.smsText) {
      els.status.textContent = state.smsCode ? `SMS code received: ${state.smsCode}` : 'SMS received.';
      stopSmsPolling();
    } else if (!options.silent) {
      els.status.textContent = state.status ? `Waiting for SMS (${state.status})...` : 'Waiting for SMS...';
    }
    return state;
  } catch (error) {
    if (!options.silent) els.status.textContent = `SMS check: ${error.message}`;
    return null;
  }
}

function startSmsPolling() {
  stopSmsPolling();
  smsPollAttempts = 0;
  smsPollTimer = setInterval(async () => {
    smsPollAttempts += 1;
    await checkSmsState({silent: true});
    if (smsPollAttempts >= 60) {
      stopSmsPolling();
      els.status.textContent = 'Stopped SMS listener after 5 minutes.';
    }
  }, 5000);
}

async function fetchOnlineSimNumber() {
  const config = await OnlineSim.getConfig();
  if (!config.onlinesimEnabled) return;
  setButtonBusy(els.fetchPhone, true, 'Getting...');
  await OnlineSim.saveConfig({
    ...config,
    onlinesimCountry: els.smsCountry.value,
    onlinesimService: els.smsService.value,
  });

  els.status.textContent = 'Requesting OnlineSim number...';
  try {
    const result = await OnlineSim.requestNumber();
    if (result.skipped) return;
    els.phone.value = result.phone;
    els.smsOperation.value = result.operationId || '';
    els.smsCode.value = '';
    els.smsText.value = '';
    els.smsText.classList.remove('has-text');
    els.status.textContent = result.operationId ?
      `OnlineSim number ready. Listening for SMS ${result.operationId}.` :
      'OnlineSim number ready.';
    if (result.operationId) {
      await checkSmsState({silent: true});
      startSmsPolling();
    }
  } catch (error) {
    els.status.textContent = `OnlineSim: ${error.message}`;
  } finally {
    setButtonBusy(els.fetchPhone, false);
  }
}

async function populateSmsSelectors() {
  const config = await OnlineSim.getConfig();
  const stored = await chrome.storage.local.get({
    lastOnlineSimNumber: '',
    lastOnlineSimOperationId: '',
    lastOnlineSimSmsCode: '',
    lastOnlineSimSmsText: '',
  });

  els.smsService.textContent = '';
  for (const service of OnlineSim.services()) {
    const option = document.createElement('option');
    option.value = service.slug;
    option.textContent = service.label;
    els.smsService.append(option);
  }

  els.smsCountry.textContent = '';
  for (const country of OnlineSim.countries()) {
    const option = document.createElement('option');
    option.value = country.code;
    option.textContent = `${country.name} (+${country.code})`;
    els.smsCountry.append(option);
  }

  const preferredService = config.onlinesimService || 'facebook';
  els.smsService.value = preferredService;
  els.smsCountry.value = config.onlinesimCountry || '1';
  els.phone.value = stored.lastOnlineSimNumber || '';
  els.smsOperation.value = stored.lastOnlineSimOperationId || '';
  els.smsCode.value = stored.lastOnlineSimSmsCode || '';
  els.smsText.value = stored.lastOnlineSimSmsText || '';
  if (els.smsOperation.value && !els.smsCode.value && !els.smsText.value) {
    startSmsPolling();
  }
}

// First launch (or key cleared via "Change API key"): no key saved yet, so
// show the setup screen with a link to onlinesim.io instead of the main SMS
// UI. Saving a non-empty key switches straight to the main panel.
async function showSetupIfNeeded() {
  const config = await OnlineSim.getConfig();
  if (config.onlinesimApiKey) {
    els.setupPanel.hidden = true;
    els.mainPanel.hidden = false;
    await populateSmsSelectors();
  } else {
    els.setupApiKey.value = '';
    els.setupError.textContent = '';
    els.setupPanel.hidden = false;
    els.mainPanel.hidden = true;
  }
}

els.setupSave.addEventListener('click', async () => {
  const key = els.setupApiKey.value.trim();
  if (!key) {
    els.setupError.textContent = 'Enter an API key first.';
    return;
  }
  const config = await OnlineSim.getConfig();
  await OnlineSim.saveConfig({...config, onlinesimApiKey: key});
  await showSetupIfNeeded();
});

els.changeApiKey.addEventListener('click', async () => {
  const config = await OnlineSim.getConfig();
  await OnlineSim.saveConfig({...config, onlinesimApiKey: ''});
  await showSetupIfNeeded();
});

els.smsService.addEventListener('change', async () => {
  const config = await OnlineSim.getConfig();
  await OnlineSim.saveConfig({...config, onlinesimService: els.smsService.value});
});
els.smsCountry.addEventListener('change', async () => {
  const config = await OnlineSim.getConfig();
  await OnlineSim.saveConfig({...config, onlinesimCountry: els.smsCountry.value});
});
els.fetchPhone.addEventListener('click', fetchOnlineSimNumber);

document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy]');
  if (!button) return;
  const input = document.getElementById(button.dataset.copy);
  await copyText(input?.value || '');
  const original = button.textContent;
  button.textContent = 'Copied';
  setTimeout(() => {
    button.textContent = original;
  }, 900);
});

void showSetupIfNeeded();
