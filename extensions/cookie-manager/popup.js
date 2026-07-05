const statusEl = document.querySelector('#status');
const seedStatusEl = document.querySelector('#seed-status');
const titleEl = document.querySelector('#title');

function setStatus(text) {
  statusEl.textContent = text;
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function showProfileName() {
  try {
    const response = await fetch(chrome.runtime.getURL('profile-meta.json'));
    if (!response.ok) {
      return;
    }
    const meta = await response.json();
    if (meta?.name) {
      titleEl.textContent = `Cookies · ${meta.name}`;
    }
  } catch (error) {
    // No profile-meta.json (e.g. loaded outside a profile launch) -- keep
    // the generic "Cookies" title.
  }
}

void showProfileName();

async function showSeedStatus() {
  const state = await chrome.storage.local.get(['argysSeedCookiesImported', 'seededAt', 'seededCount']);
  if (state.argysSeedCookiesImported) {
    const when = state.seededAt ? new Date(state.seededAt).toLocaleString() : 'unknown time';
    seedStatusEl.textContent = `Auto-imported ${state.seededCount ?? 0} cookies on ${when}`;
    seedStatusEl.className = 'seed-status seeded';
  } else {
    seedStatusEl.textContent = 'No cookies auto-imported for this profile';
    seedStatusEl.className = 'seed-status not-seeded';
  }
}

void showSeedStatus();

document.querySelector('#export-all').addEventListener('click', async () => {
  setStatus('Exporting all cookies...');
  const result = await send({type: 'export-all-cookies'});
  setStatus(`Exported ${result.count || 0} cookies`);
});

document.querySelector('#export-domain').addEventListener('click', async () => {
  setStatus('Exporting current site...');
  const result = await send({type: 'export-current-site-cookies'});
  setStatus(`Exported ${result.count || 0} cookies`);
});

document.querySelector('#import-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  setStatus('Importing...');
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;
    if (!Array.isArray(cookies)) {
      throw new Error('No cookies array found');
    }
    const result = await send({type: 'import-cookies', cookies});
    setStatus(`Imported ${result.count || 0} cookies`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  } finally {
    event.target.value = '';
  }
});
