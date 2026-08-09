// Hand items to a teammate.
//
// What this dialog is NOT is the thing worth stating first, because the word
// "share" points the wrong way. It grants no access. Everyone in this workspace
// already sees every profile, proxy, cookie set and automation -- org_id is the
// only scope on any of them. So there is no "who can see this" question here,
// no permissions, and no warning about credentials or cookies: a teammate could
// already read all of it.
//
// What it moves is responsibility. Sharing offers an item to somebody; when
// they accept, the row's assigned_to becomes them and it shows up under
// "Assigned to me". The approve step is consent, not a gate on data -- work
// should not land on your plate because a colleague decided it should.
//
// The dialog carries its own item list rather than only receiving one. The
// first version took a fixed selection from whichever table opened it, which
// made Share reachable ONLY by ticking a row first -- so on every tab the
// feature looked absent until you happened to select something, and from the
// Team tab it did not exist at all. Carrying the list here means one dialog
// serves a row button, a bulk selection and a cold open, and the preselection
// is just which boxes start ticked.
import {useMemo, useState} from 'react';
import {Search, Send} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Checkbox} from '../ui/Checkbox';
import {Field} from '../ui/Field';
import {Modal} from '../ui/Modal';
import {initials} from '../../lib/text';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {HandoffKind} from '../../types';

export type ShareRequest = {
  kind: HandoffKind;
  // Which boxes start ticked. Empty is legitimate -- that is a cold open from
  // the Team tab, where nothing has been chosen yet.
  ids: string[];
};

const KINDS: Array<{value: HandoffKind; chip: string; noun: string; plural: string}> = [
  {value: 'profile', chip: 'Profiles', noun: 'profile', plural: 'profiles'},
  {value: 'proxy', chip: 'Proxies', noun: 'proxy', plural: 'proxies'},
  {value: 'cookie_set', chip: 'Cookies', noun: 'cookie set', plural: 'cookie sets'},
  {value: 'automation', chip: 'Automations', noun: 'automation', plural: 'automations'},
];

export function ShareModal({request, onClose, onShare}: {
  request: ShareRequest;
  onClose: () => void;
  // Returns how many were offered, or the sentence explaining why none were.
  // Same convention as InviteMemberModal.onInvite: the likely failures are all
  // about the teammate or the selection on screen right now, so they belong
  // beside the control that caused them rather than in a corner toast.
  onShare: (kind: HandoffKind, ids: string[], toUserId: string, note: string) =>
    Promise<{count: number} | {error: string}>;
}) {
  const {data} = useWorkspace();
  const org = useOrg();
  const state = data.state;

  const [kind, setKind] = useState<HandoffKind>(request.kind);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(request.ids));
  const [search, setSearch] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const meta = KINDS.find((item) => item.value === kind) || KINDS[0];

  // Yourself excluded: offer_handoff refuses it, and an entry that always
  // errors is worse than no entry. Taking something for yourself is the
  // "Assigned to" field in the item's own editor, not a hand-off you send
  // yourself.
  //
  // That field can also assign straight to a colleague now
  // (2026-08-07-assign-directly.sql), which makes this dialog the deliberate
  // slower road rather than the only one: use it when you want them to agree
  // before it becomes theirs.
  const teammates = state.members.filter((member) => member.user_id !== org.userId);

  // Trashed rows are excluded everywhere they exist. A soft-deleted profile is
  // still a row, but handing somebody something you have thrown away is never
  // what was meant.
  const options = useMemo(() => {
    if (kind === 'proxy') {
      return state.proxies.map((proxy) => ({
        id: proxy.id,
        name: proxy.name || proxy.host || 'Untitled',
        detail: `${proxy.host}:${proxy.port}`,
      }));
    }
    if (kind === 'cookie_set') {
      return state.cookies.filter((cookie) => !cookie.deleted_at).map((cookie) => ({
        id: cookie.id,
        name: cookie.name || 'Untitled',
        detail: cookie.count ? `${cookie.count} cookies` : '',
      }));
    }
    if (kind === 'automation') {
      // Trashed ones are filtered out for the same reason the profiles branch
      // below drops deleted rows: you cannot share what is on its way out.
      return state.automations
          .filter((automation) => !automation.deleted_at)
          .map((automation) => ({
            id: automation.id,
            name: automation.name || 'Untitled',
            detail: `${automation.steps.length} steps`,
          }));
    }
    return state.profiles.filter((profile) => !profile.deleted_at).map((profile) => ({
      id: profile.id,
      name: profile.name || 'Untitled',
      detail: profile.status || '',
    }));
  }, [kind, state.profiles, state.proxies, state.cookies, state.automations]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) =>
      option.name.toLowerCase().includes(needle) || option.detail.toLowerCase().includes(needle));
  }, [options, search]);

  // Switching kind clears the ticks rather than keeping them. offer_handoff
  // takes one kind per call, so a mixed selection could not be sent -- and
  // silently carrying ids from the previous list would let you press Send on
  // rows you can no longer see.
  function chooseKind(next: HandoffKind) {
    setKind(next);
    setPicked(new Set());
    setSearch('');
  }

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function send() {
    setBusy(true);
    setError('');
    const result = await onShare(kind, [...picked], toUserId, note.trim());
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onClose();
  }

  const count = picked.size;

  // Nobody to hand anything to. Shown instead of the form rather than as a
  // disabled Send, because the fix is on another tab and the dialog should say
  // so rather than leaving somebody hunting for why the button is dead.
  if (teammates.length === 0) {
    return (
      <Modal
        className="small-modal share-modal"
        onClose={onClose}
        title="Nobody to share with yet"
        footer={<button onClick={onClose}>Close</button>}
      >
        <p className="error-detail">
          Sharing hands a profile, proxy, cookie set or automation to someone else on your
          team — they accept it, and it becomes theirs to look after. Invite a teammate from
          the Team tab first.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      className="small-modal share-modal"
      onClose={onClose}
      title="Share with a teammate"
      subtitle={count === 0 ?
        'Pick what to hand over.' :
        `${count} ${count === 1 ? meta.noun : meta.plural} selected`}
      footer={
        <>
          {error && <p className="settings-error">{error}</p>}
          <button className="ghost" onClick={onClose} type="button">Cancel</button>
          <BusyButton
            busy={busy}
            busyLabel="Sending"
            disabled={!toUserId || count === 0}
            icon={<Send size={15} />}
            onClick={() => void send()}
          >Share</BusyButton>
        </>
      }
    >
      {/* `group` rather than a plain Field: a <label> wrapping a radiogroup
          fires implicit activation on the first button, so clicking the label
          text would silently select Profiles. */}
      <Field label="What kind" group>
        <div className="choice-chips" role="radiogroup" aria-label="What kind">
          {KINDS.map((option) => (
            <button
              aria-checked={kind === option.value}
              className={kind === option.value ? 'choice-chip active' : 'choice-chip'}
              key={option.value}
              onClick={() => chooseKind(option.value)}
              role="radio"
              type="button"
            >{option.chip}</button>
          ))}
        </div>
      </Field>

      <Field label={`Which ${meta.plural}`} group>
        {options.length > 8 && (
          <div className="share-search">
            <Search size={14} />
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${meta.plural}`}
              type="text"
              value={search}
            />
          </div>
        )}
        <div className="share-picker">
          {visible.length === 0 ? (
            <p className="share-picker-empty">
              {options.length === 0 ?
                `You have no ${meta.plural} to share.` :
                `No ${meta.plural} match "${search.trim()}".`}
            </p>
          ) : visible.map((option) => (
            <label className="share-pick" key={option.id}>
              <Checkbox
                checked={picked.has(option.id)}
                onChange={() => toggle(option.id)}
              />
              <span className="share-pick-name">{option.name}</span>
              {option.detail && <span className="share-pick-detail">{option.detail}</span>}
            </label>
          ))}
        </div>
      </Field>

      {/* A list of real people rather than a text field. There is no address to
          type: a hand-off only means anything to somebody already in this
          workspace, so anything you could type would either be a teammate
          already on this list or an error. */}
      <Field label="Share with" group>
        <div className="share-people" role="radiogroup" aria-label="Share with">
          {teammates.map((member) => {
            const name = member.display_name || member.email.split('@')[0] || member.email;
            const active = toUserId === member.user_id;
            return (
              <button
                aria-checked={active}
                className={active ? 'share-person active' : 'share-person'}
                key={member.user_id}
                onClick={() => setToUserId(member.user_id)}
                role="radio"
                type="button"
              >
                {member.avatar_url ?
                  <img alt="" className="team-avatar" referrerPolicy="no-referrer"
                    src={member.avatar_url} /> :
                  <span className="team-avatar is-initials">{initials(name)}</span>}
                <span className="share-person-text">
                  <strong>{name}</strong>
                  <small>{member.email}</small>
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Note" hint="Shown to them when they're asked to accept.">
        <input
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && toUserId && count > 0 && !busy) {
              void send();
            }
          }}
          placeholder="Optional"
          type="text"
          value={note}
        />
      </Field>

      {/* The expectation this corrects. Somebody sharing a profile reasonably
          assumes they are giving access to it -- they are not, and if they
          think they are they will also assume the reverse: that NOT sharing
          keeps something private. It does not. */}
      <p className="field-hint">
        Everyone here can already open all of these. Sharing just moves who's looking after
        it — {meta.plural} you share show up under "Assigned to me" for them once they accept.
      </p>
    </Modal>
  );
}
