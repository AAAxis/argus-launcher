const statusEl = document.querySelector('#status');

function setStatus(text) {
  statusEl.textContent = text;
}

async function send(message) {
  return chrome.runtime.sendMessage(message);
}

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
