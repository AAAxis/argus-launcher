// Personal Telegram notifications through the workspace's own bot, with no
// server leg.
//
// The abandoned first design routed linking and sending through the landing
// site so the token could stay server-side. It also meant a deploy, env vars
// and a webhook secret before the first message could flow. This one treats
// the bot token like every other connector credential in the schema -- org-
// readable, sent from the launcher's main process -- and linking works because
// the bot has NO webhook: the launcher opens t.me/<bot>?start=<code> and main
// watches the bot's getUpdates feed for the code coming back
// (electron/telegram-link.cjs).
import {native} from '../native';

// The code that ties a /start press to this launcher. Random enough that a
// stranger cannot collide with a live link window; single-use because the
// poll only accepts its own code and stops.
export function mintLinkCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function botDeepLink(botName: string, code: string): string {
  return `https://t.me/${botName.replace(/^@/, '')}?start=${code}`;
}

// Send to one chat through the workspace bot. Fire-and-forget from the run
// pipeline; the boolean is for the Notification bot view's test button.
//
// `parseMode: 'HTML'` marks `text` as Telegram markup -- used by the run
// summaries, which arrive from composeFinishTelegram with every interpolated
// value escaped. Main retries unformatted if Telegram cannot parse it, so a
// bad tag costs the formatting and not the message.
export async function sendTelegram(
    botToken: string, chatId: string, text: string, parseMode?: 'HTML',
): Promise<{ok: boolean; error?: string}> {
  if (!native?.telegramSend) {
    return {ok: false, error: 'Telegram needs the desktop app.'};
  }
  return native.telegramSend(botToken, chatId, text, parseMode);
}
