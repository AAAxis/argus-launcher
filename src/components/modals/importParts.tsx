// The pieces all three importers share: the sticky header, the stat tiles, the
// credential banner, the destination cards and the finished screen.
//
// They started as the profile importer's, because it was the only import dialog
// with more than one screen. Then the proxy importer grew a review step and a
// folder step of its own and the cookie importer was built from nothing, and a
// second and third copy of "one login for every credential-less proxy in this
// file" is how three dialogs come to disagree about what a warning looks like.
//
// Nothing here knows what is being imported. A part that needed to would belong
// in the dialog that owns it.
import {CheckCircle2, TriangleAlert} from 'lucide-react';
import {useState} from 'react';
import {BusyButton} from '../ui/BusyButton';
import {EditorHead} from '../ui/EditorHead';
import type {ReactNode} from 'react';

// ── The header ──────────────────────────────────────────────────────────────

// Every importer's bar: a mark, the dialog's name, a line of context carrying
// the step rail and the live counts, and every action at the trailing edge.
//
// It IS EditorHead -- the same component the profile and automation editors
// wear -- with the name left unwritable. The importers used to carry their
// actions in a footer and their step count in the subtitle, which is a fine
// arrangement and a different one from the rest of the app; the reason to move
// is that a dialog whose confirm sits in a different place from every other
// dialog's is one the eye has to re-find.
export function ImportHead({mark, title, steps, step, meta, actions}: {
  mark: ReactNode;
  title: string;
  // Total number of steps, for the rail. Omit for a one-screen importer.
  steps?: number;
  step?: number;
  // The counts under the title -- "profiles.csv · 42 ready · 3 skipped".
  meta?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <EditorHead
      mark={mark}
      markLabel={title}
      noun="import"
      name={title}
      meta={
        <>
          {steps ? <StepDots steps={steps} step={step || 0} /> : null}
          {meta}
        </>
      }
      actions={<div className="editor-head-actions-end">{actions}</div>}
    />
  );
}

// Ornamental, so it is hidden from assistive tech -- the meta line beside it
// already says which step this is in words.
function StepDots({steps, step}: {steps: number; step: number}) {
  return (
    <span className="import-dots" aria-hidden="true">
      {Array.from({length: steps}, (_, index) => (
        <i key={index} className={index === step ? 'on' : ''} />
      ))}
    </span>
  );
}

// ── The stat tiles ──────────────────────────────────────────────────────────

export type ImportStat = {label: string; value: number; icon: ReactNode};

// What this import will do, or has done, as one number per tile.
//
// There used to be two treatments: a `.summary-item` strip on the review steps
// and these tiles on the finished screen, so the same five numbers changed
// shape when the import ran. One treatment, both places -- and the tile is the
// one that survived because it is the one with room for a glyph and a label
// that is not an abbreviation.
export function ImportStats({stats}: {stats: ImportStat[]}) {
  return (
    <div className="import-stats">
      {stats.map((stat) => (
        // Dimmed at zero: tiles of equal weight made "0 updated" as loud as
        // "10 created", and the whole point of the panel is what changed.
        <div className={stat.value ? 'import-stat' : 'import-stat zero'} key={stat.label}>
          <span className="import-stat-mark">{stat.icon}</span>
          <span className="import-stat-label">{stat.label}</span>
          <strong className="import-stat-value">{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}

// ── The credential banner ───────────────────────────────────────────────────

// One username and password for every credential-less proxy in the file.
//
// Above the table rather than inside a row, because it is one answer to N rows:
// a file exported from another tool names hosts and ports and no logins, and all
// of them are the same provider account. Autocomplete is off -- these are a
// proxy provider's credentials, not the user's own, and offering their browser
// password here would be wrong.
export function CredentialBanner({count, busy, onApply}: {
  count: number;
  busy: boolean;
  onApply: (username: string, password: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const ready = Boolean(username || password);

  return (
    <form
      className="import-credential-banner"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) {
          onApply(username, password);
        }
      }}
    >
      <div className="import-credential-copy">
        <strong>
          {count} {count === 1 ? 'proxy has' : 'proxies have'} no username or password
        </strong>
        <span>
          They will fail their check and block launch. Most exports leave credentials
          out — enter your provider&apos;s login once to apply it to all of them.
        </span>
      </div>
      <input
        aria-label="Proxy username"
        autoComplete="off"
        onChange={(event) => setUsername(event.target.value)}
        placeholder="Username"
        value={username}
      />
      <input
        aria-label="Proxy password"
        autoComplete="off"
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Password"
        type="password"
        value={password}
      />
      <BusyButton busy={busy} busyLabel="Applying…" disabled={!ready} type="submit">
        Apply to {count}
      </BusyButton>
    </form>
  );
}

// ── The destination cards ───────────────────────────────────────────────────

export type DestinationOption<Kind extends string> = {
  kind: Kind;
  title: string;
  body: string;
  disabled?: boolean;
};

// Cards rather than radios because the choice is between different shapes of
// outcome, and each needs a line of explanation a radio label cannot carry.
export function DestinationCards<Kind extends string>({options, value, onSelect, label}: {
  options: Array<DestinationOption<Kind>>;
  value: Kind;
  onSelect: (kind: Kind) => void;
  label: string;
}) {
  return (
    <div className="destination-cards" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.kind}
          role="radio"
          aria-checked={value === option.kind}
          disabled={option.disabled}
          className={value === option.kind ? 'destination-card on' : 'destination-card'}
          onClick={() => onSelect(option.kind)}
        >
          <strong>{option.title}</strong>
          <span>{option.body}</span>
        </button>
      ))}
    </div>
  );
}

// ── The finished screen ─────────────────────────────────────────────────────

export type ImportOutcome = {
  // The one line worth reading if you read nothing else, already composed by
  // the caller: only it knows which of its numbers are worth saying out loud.
  headline: string;
  stats: ImportStat[];
  // True when the write stopped partway. Not a success, and must not be dressed
  // as one -- the mark goes amber and a note says the counts are what the import
  // planned rather than what reached the server.
  partial?: boolean;
  skipped?: Array<{name: string; reason: string}>;
};

export function ImportDone({outcome, note}: {outcome: ImportOutcome; note?: ReactNode}) {
  const {headline, stats, partial, skipped = []} = outcome;
  return (
    <div className="import-done">
      <div className={partial ? 'import-done-hero partial' : 'import-done-hero'}>
        <span className="import-done-mark">
          {partial ? <TriangleAlert size={20} /> : <CheckCircle2 size={20} />}
        </span>
        <div className="import-done-copy">
          <strong>{partial ? 'Import stopped partway' : 'Import finished'}</strong>
          {headline && <i>{headline}</i>}
        </div>
      </div>

      {partial && (
        <p className="import-done-note">
          The counts below are what this import planned, not what reached the server.
          Reload to see what actually landed.
        </p>
      )}
      {note}

      <ImportStats stats={stats} />

      {skipped.length > 0 && (
        <div className="import-skipped">
          <span className="import-skipped-head">
            <TriangleAlert size={14} />
            Skipped ({skipped.length})
          </span>
          <div className="summary-lines">
            {skipped.map((item, index) => (
              <i key={index}>{item.name}: {item.reason}</i>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Saving an example file ──────────────────────────────────────────────────

// The file the "Download example" buttons write is not a starting point the user
// then has to correct: each one round-trips through its own importer unchanged,
// which is the only way to make "here is the format" verifiable rather than a
// claim. There are tests pinning exactly that.
//
// The native picker when the app is packaged, an anchor when this is running in
// a browser tab during development.
export async function saveExampleFile(
    fileName: string,
    content: string,
    say: (message: string) => void,
    saveTextFile?: (defaultName: string, body: string) => Promise<string | null>,
) {
  const kind = fileName.endsWith('.csv') ? 'CSV' : 'list';
  if (saveTextFile) {
    const savedPath = await saveTextFile(fileName, content);
    if (savedPath) {
      say(`Saved example ${kind} to ${savedPath.split('/').pop()}`);
    }
    return;
  }
  const mime = fileName.endsWith('.csv') ? 'text/csv' : 'text/plain';
  const url = URL.createObjectURL(new Blob([content], {type: mime}));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  say(`Downloaded example ${kind}`);
}
