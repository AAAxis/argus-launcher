-- Telegram rework: linking and sending moved entirely into the launcher.
--
-- 20260812 shipped the landing-webhook design and was applied in that shape;
-- the rework replaced it the same day (spec: docs/superpowers/specs/
-- 2026-08-09-automations-upgrade-design.md, "Telegram", revision note). This
-- is the delta between the two. Everything here is re-runnable.

-- ---------------------------------------------------------------------------
-- organizations: the workspace's notification bot
-- ---------------------------------------------------------------------------
--
-- One shared bot per workspace (BotFather-minted, e.g. @montigatenotifybot)
-- whose only job is messaging members about their own runs. The token is
-- org-readable like every connector credential in this schema -- the launcher
-- is what sends, and a member who can run a shared workflow can already read
-- the workspace's other tokens; see the connectors migration for the full
-- plaintext reasoning. The UI gates editing to owners.
alter table public.organizations add column if not exists telegram_bot_token text;
alter table public.organizations add column if not exists telegram_bot_name text;

-- organizations carries per-column UPDATE grants (see the baseline); without
-- these an owner's save is refused at the grant layer before RLS ever runs.
-- Table-level SELECT already covers reading them.
grant update("telegram_bot_token") on table public.organizations to authenticated;
grant update("telegram_bot_name") on table public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- user_telegram: written by the launcher now, not a webhook
-- ---------------------------------------------------------------------------
--
-- Linking opens t.me/<bot>?start=<code> and the launcher watches the bot's
-- getUpdates feed (the bot has NO webhook, so the feed is free) for that code,
-- then records the chat that sent it. Only ever about yourself, in every
-- direction -- nobody can read or rewrite anyone else's chat id.
alter table public.user_telegram alter column user_id set default auth.uid();

grant insert, update on public.user_telegram to authenticated;

drop policy if exists "link own telegram" on public.user_telegram;
create policy "link own telegram"
  on public.user_telegram for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "relink own telegram" on public.user_telegram;
create policy "relink own telegram"
  on public.user_telegram for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- telegram_link_codes: the webhook design's code store, never used
-- ---------------------------------------------------------------------------
--
-- The code now lives only in the launcher's memory for the two minutes a link
-- is in flight; nothing server-side ever sees it.
drop table if exists public.telegram_link_codes;
