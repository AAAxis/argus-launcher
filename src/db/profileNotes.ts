// Profile notes: what a profile is for, in the words of whoever set it up.
//
// The split here is the one runs.ts documents. A profile's THREAD is unbounded
// and only wanted when somebody opens it, so `list` is called on demand with an
// explicit limit. The SUMMARIES -- newest note and count, one row per profile --
// are small and bounded by the profile count, so they load with CloudState and
// the table's Notes column reads them without a query per row.
//
// Editing is the one place in this layer where authorship is a permission
// rather than a label: the RLS policies only allow update and delete when
// created_by = auth.uid() and author_kind = 'user'. That is enforced in the
// database, not here -- these functions do not pre-check it, they surface what
// the database decides. See the migration for why.
import type {ProfileNote, ProfileNoteSummary} from '../types';
import {optionalClient, raise, requireClient} from './client';
import {rowToProfileNote, rowToProfileNoteSummary} from './mappers';
import type {ProfileNoteRow, ProfileNoteSummaryRow} from './rows';

const COLUMNS =
  'id,org_id,profile_id,body,author_kind,created_by,author_label,created_at,updated_at';

const SUMMARY_COLUMNS =
  'profile_id,org_id,note_count,last_id,last_body,last_author_kind,last_created_by,' +
  'last_author_label,last_created_at';

// Deep enough that a profile someone has worked on for months still shows its
// history, shallow enough that opening a note is one small read.
const DEFAULT_LIMIT = 50;

// Who a note is being written as. The UI passes nothing and gets 'user'; the
// API and MCP bridge pass the bearer key's own name, because a write arriving
// over those paths runs through the signed-in human's session and would
// otherwise be indistinguishable from something they typed.
//
// There is no agent counterpart to `edit` and `remove`, and that is deliberate
// twice over. An agent note cannot be edited by anyone -- the update policy
// requires author_kind = 'user' -- and an agent must not be able to edit a
// PERSON's note either, which it otherwise could: it writes through that
// person's session, so RLS would see created_by = auth.uid() and allow it.
// Agents append to the backlog. They do not rewrite it.
export type NoteAuthor = {label: string};

export async function list(
    orgId: string,
    profileId: string,
    options: {limit?: number} = {},
): Promise<ProfileNote[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('profile_notes')
      .select(COLUMNS)
      .eq('org_id', orgId)
      .eq('profile_id', profileId)
      .order('created_at', {ascending: false})
      .limit(options.limit ?? DEFAULT_LIMIT);
  raise(error, 'profileNotes.list');
  return ((data || []) as unknown as ProfileNoteRow[]).map(rowToProfileNote);
}

// Every profile's newest note and count, in one read. Empty for a workspace
// that has never written one, which is the common case and costs nothing.
export async function summaries(orgId: string): Promise<ProfileNoteSummary[]> {
  const client = optionalClient();
  if (!client) {
    return [];
  }
  const {data, error} = await client
      .from('profile_note_summaries')
      .select(SUMMARY_COLUMNS)
      .eq('org_id', orgId);
  raise(error, 'profileNotes.summaries');
  return ((data || []) as unknown as ProfileNoteSummaryRow[]).map(rowToProfileNoteSummary);
}

// The inserted row is selected back rather than assumed. created_by and the
// timestamps are database defaults, and the caller needs the real values to
// render the entry it just added -- guessing at them locally is how a note
// shows "just now" from one session and a minute-old timestamp after a refresh.
export async function add(
    orgId: string,
    profileId: string,
    body: string,
    author?: NoteAuthor,
): Promise<ProfileNote> {
  const client = requireClient();
  const {data, error} = await client
      .from('profile_notes')
      .insert({
        org_id: orgId,
        profile_id: profileId,
        body,
        // created_by is deliberately NOT sent: the column's DEFAULT auth.uid()
        // fills it, which is the only version of it that cannot be forged.
        // profileToRow omits profiles.created_by for exactly this reason.
        author_kind: author ? 'agent' : 'user',
        author_label: author?.label ?? null,
      })
      .select(COLUMNS)
      .single();
  raise(error, 'profileNotes.add');
  return rowToProfileNote(data as unknown as ProfileNoteRow);
}

// Returns null when the note was not the caller's to change.
//
// RLS filters the UPDATE rather than erroring, so somebody else's note comes
// back as zero rows and not as a failure. `.select()` without `.single()` is
// what makes that visible -- with `.single()` it would throw PGRST116 and read
// as a broken query instead of a refused one.
export async function edit(
    orgId: string,
    noteId: string,
    body: string,
): Promise<ProfileNote | null> {
  const client = requireClient();
  const {data, error} = await client
      .from('profile_notes')
      .update({body, updated_at: new Date().toISOString()})
      .eq('org_id', orgId)
      .eq('id', noteId)
      .select(COLUMNS);
  raise(error, 'profileNotes.edit');
  const rows = (data || []) as unknown as ProfileNoteRow[];
  return rows.length > 0 ? rowToProfileNote(rows[0]) : null;
}

// False when the note was not the caller's to remove -- same RLS-filters-rather-
// than-errors story as edit above.
export async function remove(orgId: string, noteId: string): Promise<boolean> {
  const client = requireClient();
  const {data, error} = await client
      .from('profile_notes')
      .delete()
      .eq('org_id', orgId)
      .eq('id', noteId)
      .select('id');
  raise(error, 'profileNotes.remove');
  return ((data || []) as unknown[]).length > 0;
}
