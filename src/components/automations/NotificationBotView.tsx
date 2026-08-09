// The Notification bot: the workspace's one Telegram bot for personal run
// notifications, and this member's own link to it.
//
// A view of the Automations tab (fourth chip, after Connectors) rather than a
// Settings section, because everything it configures is consumed here: the
// per-automation "Personal Telegram" setting in the editor is what actually
// subscribes anyone to anything.
//
// Two halves, two audiences. The bot itself -- a BotFather token and the
// @username the deep link opens -- is workspace plumbing, owner-editable like
// connectors. The link below it is personal: each member connects their own
// chat, and RLS keeps every chat id readable by its owner alone, so "the whole
// team uses one bot" never means "the whole team sees each other's chats".
import {useState} from 'react';
import {BookOpen, Check, Send, Unlink} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Field} from '../ui/Field';
import {IntroModal} from '../modals/IntroModal';
import {TagMark} from '../ui/TagChip';
import {TELEGRAM_INTRO_STEPS} from '../../data/telegramIntro';
import {tagPresetFor} from '../../lib/tags';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import * as db from '../../db';

// The Telegram mark from the shared brand catalog -- the same asset the Tags
// column and the card icons draw, so this view cannot drift off-brand.
const TELEGRAM_PRESET = tagPresetFor('telegram');

export function NotificationBotView() {
  const {data, automations, toast} = useWorkspace();
  const org = useOrg();
  const bot = {
    token: org.org?.telegram_bot_token || '',
    name: org.org?.telegram_bot_name || '',
  };
  const link = data.state.telegram_link;

  // The owner's draft. The token input starts empty even when one is saved --
  // the field is write-only in spirit, like a password box; leaving it empty
  // on save keeps the saved token.
  const [tokenDraft, setTokenDraft] = useState('');
  const [nameDraft, setNameDraft] = useState(bot.name);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [linking, setLinking] = useState(false);
  const [testResult, setTestResult] = useState<{ok: boolean; text: string} | null>(null);
  const [testing, setTesting] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const configured = Boolean(bot.token && bot.name);
  // The setup card is plumbing. It shows only while there is something to do
  // with it: an owner setting the bot up, or an owner who asked to change it.
  // Once configured, the view leads with the thing members came for -- their
  // own link -- and the bot shrinks to one quiet line under it.
  const [editingBot, setEditingBot] = useState(false);
  const showSetup = org.isOwner && (!configured || editingBot);

  async function saveBot() {
    const token = tokenDraft.trim() || bot.token;
    const name = nameDraft.trim().replace(/^@/, '');
    if (!token || !name) {
      setSaveError('Both the token and the bot\'s @username are needed.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      await db.orgs.setTelegramBot(org.orgId || '', token, name);
      await org.reload();
      setTokenDraft('');
      setEditingBot(false);
      toast.setMessage('Notification bot saved.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  async function runLink() {
    setLinking(true);
    try {
      await automations.linkTelegram();
    } finally {
      setLinking(false);
    }
  }

  async function runTest() {
    setTesting(true);
    const error = await automations.testTelegram();
    setTesting(false);
    setTestResult(error ?
      {ok: false, text: error} :
      {ok: true, text: 'Sent. Check your Telegram.'});
  }

  return (
    <div className="notification-bot">
      {/* Setup, only while there is setup to do. A member never sees this --
          when the bot is missing they get one sentence on the link card below,
          not a form they cannot submit. */}
      {showSetup && (
        <section className="notification-bot-card">
          <h3>The workspace&apos;s bot</h3>
          <p className="field-hint">
            One bot messages the whole team, each member only about the automations
            they subscribe to. Make one with @BotFather, paste its token here, and
            leave the bot without a webhook — linking depends on that.
          </p>
          <Field label="Bot token">
            <input
              placeholder={bot.token ?
                `Saved (…${bot.token.slice(-6)}) — paste to replace` :
                '123456789:AA… from @BotFather'}
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
            />
          </Field>
          <Field label="Bot username">
            <input
              placeholder="@your_bot"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </Field>
          {saveError && <p className="settings-error">{saveError}</p>}
          <div className="notification-bot-actions">
            <BusyButton busy={saving} busyLabel="Saving" onClick={() => void saveBot()}>
              Save bot
            </BusyButton>
            {configured && (
              <button className="ghost" onClick={() => setEditingBot(false)} type="button">
                Cancel
              </button>
            )}
          </div>
        </section>
      )}

      <section className="notification-bot-card">
        {/* The mark says which service this is before a word is read; About
            answers the two questions people arrive with (what messages me, and
            what does linking share) -- the IntroModal pattern the Cookies tab
            uses, mounted here because only this view opens it. */}
        <div className="notification-bot-head">
          {TELEGRAM_PRESET && <TagMark preset={TELEGRAM_PRESET} size={18} />}
          <h3>Your Telegram</h3>
          <button
            className="ghost notification-bot-about"
            onClick={() => setAboutOpen(true)}
            type="button"
          >
            <BookOpen size={14} /> About
          </button>
        </div>
        {link ? (
          <>
            <p>
              <Check size={14} /> Linked
              {link.telegram_username ? <> as <strong>@{link.telegram_username}</strong></> : ''}
              {link.linked_at ? ` · ${link.linked_at.slice(0, 10)}` : ''}
            </p>
            <div className="notification-bot-actions">
              <BusyButton
                busy={testing}
                busyLabel="Sending"
                className="ghost"
                icon={<Send size={14} />}
                onClick={() => void runTest()}
              >Send a test message</BusyButton>
              <button className="ghost" onClick={() => void automations.unlinkTelegram()}>
                <Unlink size={14} /> Unlink
              </button>
            </div>
            {testResult && (
              <p className={testResult.ok ? 'field-hint' : 'settings-error'}>
                {testResult.text}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="field-hint">
              Opens the bot in Telegram; pressing Start there connects your chat.
              Then pick which automations message you in each automation&apos;s
              editor, under Personal Telegram.
            </p>
            {!configured && (
              <p className="field-hint">
                {org.isOwner ?
                  'Set up the workspace\'s bot above first.' :
                  'The workspace owner hasn\'t set up the notification bot yet.'}
              </p>
            )}
            <div className="notification-bot-actions">
              <span title={configured ? 'Open the bot in Telegram' :
                'Set up the workspace\'s bot first'}>
                <BusyButton
                  busy={linking}
                  busyLabel="Waiting for Start…"
                  disabled={!configured}
                  icon={<Send size={14} />}
                  onClick={() => void runLink()}
                >Link Telegram</BusyButton>
              </span>
            </div>
          </>
        )}
      </section>

      {/* The one line of plumbing that survives setup, and only for the person
          who can act on it. Everyone else's view starts and ends with their
          own link. */}
      {org.isOwner && configured && !showSetup && (
        <p className="notification-bot-footnote">
          Bot: @{bot.name}
          <button
            className="notification-bot-change"
            type="button"
            onClick={() => {
              setNameDraft(bot.name);
              setEditingBot(true);
            }}
          >Change</button>
        </p>
      )}

      {aboutOpen && (
        <IntroModal
          steps={TELEGRAM_INTRO_STEPS}
          onClose={() => setAboutOpen(false)}
        />
      )}
    </div>
  );
}
