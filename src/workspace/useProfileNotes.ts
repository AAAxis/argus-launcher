// Adding, editing and removing profile notes, and keeping the table's summary
// row in step with what just happened.
//
// Two caches, one write. The THREAD is not cached at all -- whoever opens a note
// panel calls `list` and holds the result locally, because a thread is unbounded
// and stale only matters while it is on screen. The SUMMARY is in CloudState,
// because the Notes column reads it for every visible row, and it is what has to
// be patched after a write or the column keeps showing the previous note until
// the next full load.
//
// The summary is recomputed locally rather than re-read. A round trip to the
// view after every note would be a second query for a preview line, and the
// three cases are all decidable from what we already have: adding makes the new
// note the newest, editing rewrites the preview only if the edited note IS the
// newest, and deleting the newest is the one case that genuinely needs the row
// behind it -- which is why that path re-reads.
import * as db from '../db';
import type {WorkspaceCore} from './core';
import type {ProfileNote, ProfileNoteSummary} from '../types';

export type ProfileNoteActions = ReturnType<typeof useProfileNotes>;

// A note's own fields as a summary row. Used after an add and after an edit of
// the newest note -- both leave that note at the top of the thread.
function summaryFrom(note: ProfileNote, noteCount: number): ProfileNoteSummary {
  return {
    profile_id: note.profile_id,
    note_count: noteCount,
    last_id: note.id,
    last_body: note.body,
    last_author_kind: note.author_kind,
    last_created_by: note.created_by,
    last_author_label: note.author_label,
    last_created_at: note.created_at,
  };
}

export function useProfileNotes({data, toast}: WorkspaceCore) {
  const {state, withDbError, patch} = data;

  // withDb reports success as a boolean, which is all every other action needs.
  // These three need the row back -- the inserted note carries created_by and
  // both timestamps, all database defaults, and rendering the entry from a
  // locally guessed copy is how "just now" turns into a different time after the
  // next load. So: withDbError for the failure text, and the value carried out
  // through the closure.
  async function run<T>(action: (orgId: string) => Promise<T>): Promise<T | null> {
    let value: T | null = null;
    const error = await withDbError(async (activeOrgId) => {
      value = await action(activeOrgId);
    });
    if (error) {
      toast.setMessage(error);
      return null;
    }
    return value;
  }

  function summaryFor(profileId: string): ProfileNoteSummary | undefined {
    return state.note_summaries.find((summary) => summary.profile_id === profileId);
  }

  // The whole thread for one profile, newest first. Not cached: see the header.
  // Returns [] rather than throwing when the read fails, and toasts, because the
  // caller is a panel that has already opened -- an empty thread with a message
  // in the corner beats a panel that renders nothing and says nothing.
  async function list(profileId: string): Promise<ProfileNote[]> {
    return await run((orgId) => db.profileNotes.list(orgId, profileId)) ?? [];
  }

  // `author` is passed only by the API/MCP bridge, and turns the entry into an
  // agent note. Nothing in the UI passes it -- see db/profileNotes.ts.
  async function add(
      profileId: string,
      body: string,
      author?: {label: string},
  ): Promise<ProfileNote | null> {
    const text = body.trim();
    if (!text) {
      return null;
    }
    const note = await run((orgId) => db.profileNotes.add(orgId, profileId, text, author));
    if (!note) {
      return null;
    }
    const previous = summaryFor(profileId);
    const next = summaryFrom(note, (previous?.note_count ?? 0) + 1);
    patch.noteSummaries((list) => previous ?
      list.map((item) => item.profile_id === profileId ? next : item) :
      [...list, next]);
    return note;
  }

  // Null when the note was not this user's to change -- the update policy
  // filters rather than errors, so db.profileNotes.edit returns no row. Toasted
  // here rather than swallowed: from the UI this should be unreachable (the
  // controls are not rendered on someone else's note), so reaching it means two
  // sessions disagreed about who wrote something and the user deserves to know
  // their edit did not land.
  async function edit(noteId: string, body: string): Promise<ProfileNote | null> {
    const text = body.trim();
    if (!text) {
      return null;
    }
    const note = await run((orgId) => db.profileNotes.edit(orgId, noteId, text));
    if (!note) {
      toast.setMessage('That note could not be edited -- notes can only be changed by whoever wrote them.');
      return null;
    }
    // Only if it is still the newest. Editing an older entry changes nothing the
    // column shows.
    patch.noteSummaries((list) => list.map((item) =>
      item.profile_id === note.profile_id && item.last_id === note.id ?
        summaryFrom(note, item.note_count) :
        item));
    return note;
  }

  // The one path that re-reads. Removing the newest note promotes the one behind
  // it, and that note's body, author and timestamp are not derivable from
  // anything held here -- the thread was never cached.
  async function remove(profileId: string, noteId: string): Promise<boolean> {
    const removed = await run((orgId) => db.profileNotes.remove(orgId, noteId));
    if (!removed) {
      toast.setMessage('That note could not be deleted -- notes can only be removed by whoever wrote them.');
      return false;
    }
    const previous = summaryFor(profileId);
    const wasNewest = previous?.last_id === noteId;
    const remaining = (previous?.note_count ?? 1) - 1;

    if (remaining <= 0) {
      patch.noteSummaries((list) => list.filter((item) => item.profile_id !== profileId));
      return true;
    }
    if (!wasNewest) {
      patch.noteSummaries((list) => list.map((item) =>
        item.profile_id === profileId ? {...item, note_count: remaining} : item));
      return true;
    }
    const thread = await list(profileId);
    const newest = thread[0];
    patch.noteSummaries((list) => newest ?
      list.map((item) =>
        item.profile_id === profileId ? summaryFrom(newest, remaining) : item) :
      list.filter((item) => item.profile_id !== profileId));
    return true;
  }

  return {summaryFor, list, add, edit, remove};
}
