// Shared license / entitlement client — talks to the same Supabase backend as the
// Windows app. The account code (VPN-XXXX-XXXX-XXXX) is the license; get_entitlement
// returns whether it's Pro. Loaded by both popup.js (<script>) and background.js
// (importScripts).

const FW_SUPABASE_URL = "https://uhpuqiptxcjluwsetoev.supabase.co";
const FW_SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVocHVxaXB0eGNqbHV3c2V0b2V2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwOTE4OTYsImV4cCI6MjA3MjY2Nzg5Nn0.D_t-dyA4Z192kAU97Oi79At_IDT_5putusXrR0bQ6z8";

async function fwGetAccountId() {
  const r = await chrome.storage.local.get(["accountId"]);
  return r.accountId || null;
}

async function fwSetAccountId(id) {
  await chrome.storage.local.set({ accountId: id });
}

// Mint a fresh anonymous account (VPN-XXXX-XXXX-XXXX), same as the desktop app.
// Returns the new code, or null on failure.
async function fwCreateAccount() {
  try {
    const res = await fwRpc("create_account", {});
    if (!res.ok) return null;
    const d = await res.json();
    return d && d.success ? d.account_id : null;
  } catch (e) {
    return null;
  }
}

// Account is auto-created on first use — the user never types a code. Returns the
// stored code, creating + persisting one if none exists yet.
async function fwEnsureAccount() {
  let id = await fwGetAccountId();
  if (!id) {
    id = await fwCreateAccount();
    if (id) await fwSetAccountId(id);
  }
  return id;
}

async function fwRpc(fn, body) {
  return fetch(`${FW_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: FW_SUPABASE_ANON,
      Authorization: `Bearer ${FW_SUPABASE_ANON}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Returns { exists, is_pro, expires_at }. Never throws.
async function fwGetEntitlement(accountId) {
  if (!accountId) return { exists: false, is_pro: false };
  try {
    const res = await fwRpc("get_entitlement", { p_account_id: accountId });
    if (!res.ok) return { exists: false, is_pro: false };
    const d = await res.json();
    return { exists: !!d.exists, is_pro: !!d.is_pro, expires_at: d.expires_at || null };
  } catch (e) {
    return { exists: false, is_pro: false };
  }
}

// Server metadata only (no passwords). Returns { is_pro, servers:[...] }; each
// server has { id, country, country_code, city, is_default, locked }. Never throws.
async function fwListServers(accountId) {
  if (!accountId) return { is_pro: false, servers: [] };
  try {
    const res = await fwRpc("list_proxy_servers", { p_account_id: accountId });
    if (!res.ok) return { is_pro: false, servers: [] };
    const d = await res.json();
    return { is_pro: !!d.is_pro, servers: Array.isArray(d.servers) ? d.servers : [] };
  } catch (e) {
    return { is_pro: false, servers: [] };
  }
}

// Credentials for one server. Free accounts always get the default server (server
// id ignored server-side); Pro accounts get the requested one. The password lives
// server-side and is only released here — never bundled. Throws on network error
// so the caller can distinguish "offline" from "not authorized".
async function fwGetProxyCredentials(accountId, serverId) {
  if (!accountId) return { authorized: false, reason: "no_account" };
  const res = await fwRpc("get_proxy_credentials", {
    p_account_id: accountId,
    p_server_id: serverId || null,
  });
  if (!res.ok) throw new Error(`get_proxy_credentials HTTP ${res.status}`);
  const d = await res.json();
  return {
    authorized: !!d.authorized,
    reason: d.reason || null,
    is_pro: !!d.is_pro,
    server_id: d.server_id || null,
    country: d.country || null,
    country_code: d.country_code || null,
    city: d.city || null,
    host: d.host || null,
    port: d.port || null,
    username: d.username || null,
    password: d.password || null,
    expires_at: d.expires_at || null,
  };
}
