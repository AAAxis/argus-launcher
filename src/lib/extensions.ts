// Chrome extension ids are 32 lowercase letters restricted to a-p. Accepts
// a bare id or any Web Store URL (chromewebstore.google.com/detail/.../<id>
// or the older chrome.google.com/webstore/detail/.../<id>).
export function parseWebstoreExtensionId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-p]{32}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    const segments = new URL(trimmed).pathname.split('/').filter(Boolean);
    const last = segments.at(-1) || '';
    return /^[a-p]{32}$/.test(last) ? last : null;
  } catch {
    return null;
  }
}
