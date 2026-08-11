import {optionalClient, raise, requireClient} from './client';
import type {AutomationTelegramPrefRow} from './rows';

export type TelegramPref = {
  automation_id: string;
  notify_on: 'always' | 'failure';
};

// This user's per-automation Telegram preferences -- personal, like stars, so
// RLS narrows to own rows and org_id keeps workspaces apart.
export async function list(orgId: string): Promise<TelegramPref[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('automation_telegram_prefs')
      .select('automation_id,notify_on')
      .eq('org_id', orgId);
  raise(error, 'telegramPrefs.list');
  return ((data || []) as unknown as
      Pick<AutomationTelegramPrefRow, 'automation_id' | 'notify_on'>[])
      .map((row) => ({
        automation_id: row.automation_id,
        notify_on: row.notify_on === 'always' ? 'always' : 'failure',
      }));
}

// One row per (automation, me). Insert, and on the duplicate key update the
// row instead -- NOT an upsert (the house rule); two explicit statements, the
// second reached only on 23505, so a concurrent set from another window
// resolves to one of the two values rather than an error.
export async function set(
    orgId: string, automationId: string, notifyOn: 'always' | 'failure'): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('automation_telegram_prefs')
      .insert({org_id: orgId, automation_id: automationId, notify_on: notifyOn});
  if (!error) {
    return;
  }
  if (error.code !== '23505') {
    raise(error, 'telegramPrefs.set');
  }
  const {error: updateError} = await client
      .from('automation_telegram_prefs')
      .update({notify_on: notifyOn})
      .eq('org_id', orgId)
      .eq('automation_id', automationId);
  raise(updateError, 'telegramPrefs.set');
}

export async function clear(orgId: string, automationId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
      .from('automation_telegram_prefs')
      .delete()
      .eq('org_id', orgId)
      .eq('automation_id', automationId);
  raise(error, 'telegramPrefs.clear');
}

export type TelegramLink = {
  chat_id: string;
  telegram_username: string | null;
  linked_at: string;
};

// MY linked chat, or null. No orgId: user_telegram belongs to a person, not a
// tenant -- the `account` exception in index.ts. RLS narrows the select to the
// caller's own row, so the chat id read here is only ever the caller's own.
export async function myLink(): Promise<TelegramLink | null> {
  const client = optionalClient();
  if (!client) {
    return null;
  }
  const {data, error} = await client
      .from('user_telegram')
      .select('chat_id,telegram_username,linked_at')
      .maybeSingle();
  raise(error, 'telegramPrefs.myLink');
  return (data as TelegramLink | null) || null;
}

// Record the chat the linking poll found. Insert, and on the duplicate key
// update -- the same not-an-upsert shape as set() above; relinking from a new
// Telegram account is the update path. user_id comes from the column default.
export async function saveLink(chatId: string, username: string | null): Promise<void> {
  const client = requireClient();
  const row = {
    chat_id: chatId,
    telegram_username: username,
    linked_at: new Date().toISOString(),
  };
  const {error} = await client.from('user_telegram').insert(row);
  if (!error) {
    return;
  }
  if (error.code !== '23505') {
    raise(error, 'telegramPrefs.saveLink');
  }
  const {data: userData} = await client.auth.getUser();
  const {error: updateError} = await client
      .from('user_telegram')
      .update(row)
      .eq('user_id', userData.user?.id || '');
  raise(updateError, 'telegramPrefs.saveLink');
}

// Sever MY link. The per-automation prefs survive on purpose: relinking next
// week should not mean re-subscribing to a dozen automations.
export async function unlink(): Promise<void> {
  const client = requireClient();
  const {data: userData} = await client.auth.getUser();
  const {error} = await client
      .from('user_telegram')
      .delete()
      .eq('user_id', userData.user?.id || '');
  raise(error, 'telegramPrefs.unlink');
}
