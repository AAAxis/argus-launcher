// A profile's note thread: what it is for, why it is set up this way, what has
// been tried on it.
//
// One component for both surfaces -- the table's Notes cell and the Edit
// profile dialog -- because a thread rendered twice is a thread that ends up
// disagreeing with itself about what "yours" means, and "yours" is the whole
// basis of what can be edited here.
//
// The thread is fetched, not passed in. CloudState holds only the summary the
// table column needs; the entries themselves are unbounded and nobody wants
// them until a panel opens, so the panel is what asks. That also means every
// open is a fresh read, which is the correct trade for a shared workspace --
// the alternative is showing a colleague's note as it was when the tab loaded.
import {useCallback, useEffect, useState} from 'react';
import {Bot, Check, Pencil, Trash2, X} from 'lucide-react';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import {useOrg} from '../../org';
import {assigneeName} from '../../lib/assignees';
import {sinceLabel} from './ProxyCheckCell';
import type {ProfileNote} from '../../types';

// Matches profile_notes_body_len. Enforced here so an over-long note is a
// disabled button rather than a 23514 the user has to decode.
const MAX_BODY = 2000;

export function NotesPanel({profileId, autoFocus = false}: {
  profileId: string;
  // The table cell opens straight onto the composer -- somebody who clicked
  // "Add note" has already said what they want to do. The dialog does not: the
  // Notes section is one of six and stealing focus on open would fight whatever
  // field the user was actually heading for.
  autoFocus?: boolean;
}) {
  const {profileNotes, data} = useWorkspace();
  const {userId} = useOrg();
  const [notes, setNotes] = useState<ProfileNote[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{id: string; body: string} | null>(null);
  const [busy, setBusy] = useState(false);

  const {list} = profileNotes;
  const reload = useCallback(async () => {
    setNotes(await list(profileId));
  }, [list, profileId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit() {
    const body = draft.trim();
    if (!body || busy) {
      return;
    }
    setBusy(true);
    const note = await profileNotes.add(profileId, body);
    setBusy(false);
    if (note) {
      setDraft('');
      // Prepended rather than re-fetched: the insert returned the real row,
      // timestamps and all, so a second round trip would only confirm it.
      setNotes((current) => [note, ...(current || [])]);
    }
  }

  async function saveEdit() {
    if (!editing || busy) {
      return;
    }
    setBusy(true);
    const note = await profileNotes.edit(editing.id, editing.body);
    setBusy(false);
    if (note) {
      setEditing(null);
      setNotes((current) => (current || []).map((item) => item.id === note.id ? note : item));
    }
  }

  async function remove(note: ProfileNote) {
    if (busy) {
      return;
    }
    setBusy(true);
    const done = await profileNotes.remove(profileId, note.id);
    setBusy(false);
    if (done) {
      setNotes((current) => (current || []).filter((item) => item.id !== note.id));
    }
  }

  // Who wrote it. A person resolves against the roster the same way an
  // assignment does, so one member is called the same thing on every screen; an
  // agent carries the API key's own name, because "claude" and "nightly-sweep"
  // are the distinction worth drawing between two automations.
  function authorOf(note: ProfileNote): string {
    if (note.author_kind === 'agent') {
      return note.author_label || 'Agent';
    }
    return assigneeName(note.created_by, data.state.members) || 'Unknown';
  }

  // Only your own, and only the ones you typed. An agent note carries the uid of
  // whoever had the launcher open when the key was used, so `created_by` alone
  // would offer an edit button on something that person never wrote -- and the
  // database would refuse it anyway. See the update policy in the migration.
  function isMine(note: ProfileNote): boolean {
    return note.author_kind === 'user' && Boolean(userId) && note.created_by === userId;
  }

  const over = draft.trim().length > MAX_BODY;

  return (
    <div className="notes-panel">
      {notes === null ? (
        <p className="notes-empty">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="notes-empty">
          No notes yet. Say what this profile is for — the next person to open it
          will be reading this.
        </p>
      ) : (
        <ol className="notes-list">
          {notes.map((note) => (
            <li className="note-entry" key={note.id}>
              <div className="note-entry-head">
                <span className="note-author">
                  {note.author_kind === 'agent' && <Bot size={12} />}
                  {authorOf(note)}
                </span>
                <span className="note-time" title={note.created_at}>
                  {sinceLabel(note.created_at)}
                  {note.updated_at !== note.created_at && ' · edited'}
                </span>
                {isMine(note) && editing?.id !== note.id && (
                  <span className="note-entry-actions">
                    <button
                      aria-label="Edit note"
                      className="icon-button"
                      onClick={() => setEditing({id: note.id, body: note.body})}
                      title="Edit note"
                      type="button"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      aria-label="Delete note"
                      className="icon-button danger-icon"
                      onClick={() => void remove(note)}
                      title="Delete note"
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                )}
              </div>
              {editing?.id === note.id ? (
                <div className="note-edit">
                  <textarea
                    autoFocus
                    onChange={(event) => setEditing({id: note.id, body: event.target.value})}
                    rows={3}
                    value={editing.body}
                  />
                  <div className="note-edit-actions">
                    <button
                      className="ghost note-btn"
                      onClick={() => setEditing(null)}
                      type="button"
                    >
                      <X size={13} /> Cancel
                    </button>
                    <button
                      className="note-btn"
                      disabled={busy || !editing.body.trim()}
                      onClick={() => void saveEdit()}
                      type="button"
                    >
                      <Check size={13} /> Save
                    </button>
                  </div>
                </div>
              ) : (
                <p className="note-body">{note.body}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="notes-composer">
        <textarea
          autoFocus={autoFocus}
          maxLength={MAX_BODY}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="What is this profile for?"
          rows={2}
          value={draft}
        />
        <div className="notes-composer-actions">
          {/* Only once it is worth knowing. A counter under an empty box is a
              limit presented as a target. */}
          {draft.length > MAX_BODY - 200 && (
            <span className={over ? 'notes-count over' : 'notes-count'}>
              {draft.trim().length} / {MAX_BODY}
            </span>
          )}
          <button
            className="note-btn"
            disabled={busy || !draft.trim() || over}
            onClick={() => void submit()}
            type="button"
          >
            Add note
          </button>
        </div>
      </div>
    </div>
  );
}
