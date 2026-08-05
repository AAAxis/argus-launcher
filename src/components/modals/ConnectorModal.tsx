// Add or edit a connector. The form is GENERATED from the preset catalogue --
// src/data/connectors.ts declares each kind's fields, this renders whatever it
// finds there. Adding a connector kind is a catalogue entry and a send adapter
// in the main process; this file does not change.
//
// Creating starts on a kind picker (two headed groups, AI and messaging) and
// only then shows the form. The kind is locked once saved: changing it under
// an existing config would leave the old kind's keys orphaned inside `config`,
// and "delete it and add the right one" is honest about what that is.
import {useState} from 'react';
import {ArrowLeft, Check, ExternalLink, Eye, EyeOff, X} from 'lucide-react';
import {BusyButton} from '../ui/BusyButton';
import {Field} from '../ui/Field';
import {Modal} from '../ui/Modal';
import {connectorGlyph} from '../automations/ConnectorsView';
import {native} from '../../native';
import {
  CONNECTOR_PRESETS, presetFor, runtimeConnector, validateConnectorConfig,
} from '../../data/connectors';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ConnectorField} from '../../data/connectors';
import type {ArgusConnector} from '../../types';

// One value, not two booleans: `ok` picks the tone and `message` is the
// service's own sentence, which is the only diagnostic worth showing.
type TestResult = {ok: boolean; message: string};

// A secret renders as a password input with its own reveal toggle. type="text"
// under the toggle rather than always-password: the value is pasted once and
// read back only to compare against the credential in hand, and a permanently
// hidden field makes the one check that matters impossible.
function SecretInput({value, placeholder, onChange}: {
  value: string;
  placeholder?: string;
  onChange: (next: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="connector-secret-input">
      <input
        type={shown ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        aria-label={shown ? 'Hide value' : 'Show value'}
        className="ghost icon-button"
        onClick={() => setShown((current) => !current)}
        title={shown ? 'Hide value' : 'Show value'}
        type="button"
      >
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export function ConnectorModal({connector, exists, onClose}: {
  connector: ArgusConnector;
  exists: boolean;
  onClose: () => void;
}) {
  const {data, connectors, toast} = useWorkspace();
  const [draft, setDraft] = useState<ArgusConnector>(connector);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  const preset = presetFor(draft.kind);
  // Creating and no kind picked yet -> the picker is the whole dialog.
  const picking = !exists && !draft.kind;

  function pick(kind: string) {
    const picked = presetFor(kind);
    if (!picked) {
      return;
    }
    setDraft({
      ...draft,
      kind,
      category: picked.category,
      // Seeded, not forced: a name the user already typed survives switching
      // their mind about the kind.
      name: draft.name.trim() || picked.label,
      config: picked.suggestedModel ? {model: picked.suggestedModel} : {},
      // The first connector in its category becomes the default -- a lone
      // connector that is not the default makes every step authored without
      // naming one fail for no reason the user can see.
      is_default: !data.state.connectors.some((item) => item.category === picked.category),
    });
    setTest(null);
    setError('');
  }

  function setConfig(key: string, value: string) {
    setDraft((current) => ({...current, config: {...current.config, [key]: value}}));
  }

  const problems: string[] = [];
  if (!draft.name.trim()) {
    problems.push('Name is required');
  }
  problems.push(...validateConnectorConfig(draft.kind, draft.config));

  // Tests the DRAFT, unsaved edits included -- the thing you are about to
  // save is the thing worth proving, not whatever the last save wrote.
  async function runTest() {
    setTesting(true);
    setTest(null);
    const answer = await native?.testConnector?.(runtimeConnector(draft));
    setTesting(false);
    setTest(answer ?
      {
        ok: answer.ok,
        message: answer.ok ?
          (draft.category === 'message' ? 'Message sent — check the channel.' : 'Replied ok.') :
          answer.error || 'The test did not run.',
      } :
      {ok: false, message: 'Testing needs the desktop app.'});
  }

  // Back to the picker, dropping whatever this kind's form held: its keys
  // belong to the kind, and carrying them into another one would orphan them
  // inside config.
  function back() {
    setDraft({...draft, kind: '', config: {}});
    setTest(null);
    setError('');
  }

  async function save() {
    setSaving(true);
    const failure = await connectors.save(
        {...draft, name: draft.name.trim()}, exists);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    toast.setMessage(`Saved "${draft.name.trim()}"`);
    onClose();
  }

  function control(field: ConnectorField) {
    const value = draft.config[field.key] || '';
    if (field.secret) {
      return (
        <SecretInput
          value={value}
          placeholder={field.placeholder}
          onChange={(next) => setConfig(field.key, next)}
        />
      );
    }
    if (field.kind === 'select') {
      return (
        <select value={value} onChange={(event) => setConfig(field.key, event.target.value)}>
          {(field.options || []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={field.kind === 'number' ? 'number' : 'text'}
        value={value}
        placeholder={field.placeholder}
        autoComplete="off"
        onChange={(event) => setConfig(field.key, event.target.value)}
      />
    );
  }

  if (picking) {
    return (
      <Modal
        className="small-modal connector-modal"
        onClose={onClose}
        title="New connector"
        subtitle="What should your automations be able to reach?"
      >
        {(['ai', 'message'] as const).map((category) => (
          <section className="connector-pick-group" key={category}>
            <h3>{category === 'ai' ? 'AI models' : 'Messaging'}</h3>
            <div className="connector-pick-grid">
              {CONNECTOR_PRESETS.filter((entry) => entry.category === category).map((entry) => {
                const Glyph = connectorGlyph(entry);
                return (
                  <button
                    className="connector-pick-tile"
                    key={entry.kind}
                    onClick={() => pick(entry.kind)}
                    type="button"
                  >
                    <Glyph size={18} strokeWidth={1.75} />
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </Modal>
    );
  }

  const keyField = (preset?.fields || []).find((field) => field.secret);

  return (
    <Modal
      className="small-modal connector-modal"
      onClose={onClose}
      title={exists ? `Edit ${connector.name || 'connector'}` : `New ${preset?.label || draft.kind} connector`}
      subtitle={preset ?
        (preset.category === 'message' ?
          'Automations send messages through this.' :
          'AI steps ask this model.') :
        `This version of Argus doesn't recognise "${draft.kind}", so its fields can't be edited here.`}
      footer={
        <>
          {!exists && (
            <button className="ghost connector-modal-back" onClick={back} type="button">
              <ArrowLeft size={14} /> Different service
            </button>
          )}
          <BusyButton
            busy={testing}
            busyLabel="Testing"
            className="ghost"
            disabled={problems.length > 0}
            onClick={() => void runTest()}
            title={problems.length > 0 ?
              problems.join('. ') :
              (draft.category === 'message' ?
                'Sends a real test message' :
                'Asks the model for a one-word reply')}
          >Test</BusyButton>
          <button className="ghost" onClick={onClose} type="button">Cancel</button>
          <BusyButton
            busy={saving}
            busyLabel="Saving…"
            disabled={problems.length > 0}
            onClick={() => void save()}
            title={problems.length > 0 ? problems.join('. ') : 'Save this connector'}
          >Save</BusyButton>
        </>
      }
    >
      <div className="connector-form">
        <Field label="Name" hint="What steps and dropdowns call it.">
          <input
            type="text"
            value={draft.name}
            placeholder={preset?.label || 'Connector name'}
            onChange={(event) => setDraft({...draft, name: event.target.value})}
          />
        </Field>

        {(preset?.fields || []).map((field) => (
          <Field
            key={field.key}
            label={field.required ? `${field.label} *` : field.label}
            hint={field.hint}
          >
            {control(field)}
            {/* "Get one" sits beside the field it fills, in the user's own
                browser -- never a profile window; those stay anonymous. */}
            {field.secret && field.key === keyField?.key && preset?.keyUrl && (
              <button
                className="link-button"
                onClick={() => void native?.openExternal?.(preset.keyUrl as string)}
                type="button"
              >
                Get one <ExternalLink size={12} />
              </button>
            )}
          </Field>
        ))}

        {test && (
          <p className={`connector-card-test ${test.ok ? 'is-ok' : 'is-bad'}`}>
            {test.ok ? <Check size={13} /> : <X size={13} />}
            <span>{test.message}</span>
          </p>
        )}
        {error && <p className="connector-card-test is-bad"><X size={13} /><span>{error}</span></p>}
      </div>
    </Modal>
  );
}
