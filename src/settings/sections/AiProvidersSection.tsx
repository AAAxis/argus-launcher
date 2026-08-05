// AI providers: which model the automation steps talk to, and with what key.
//
// Workspace-wide, which is the whole point -- a shared automation has to run
// for whoever opens it, not only for the machine that wrote it. That is also
// why the key is readable by every member and writable only by the owner: the
// spend is the workspace's, and repointing it silently redirects every AI step
// every member runs.
//
// The masking below is a courtesy, NOT a boundary. A member can read the column
// through the API; hiding the characters only stops a key being read over
// somebody's shoulder in an app they did not expect to be showing one. Do not
// let it grow into something the code relies on.
import {useState} from 'react';
import {
  Check, ExternalLink, KeyRound, Plus, Sparkles, TriangleAlert, X,
} from 'lucide-react';
import {Badge} from '../../components/ui/Badge';
import {BusyButton} from '../../components/ui/BusyButton';
import {Field} from '../../components/ui/Field';
import {AI_PROVIDER_PRESETS, presetFor, runtimeProvider} from '../../data/aiProviders';
import {native} from '../../native';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import {SettingsGroup, SettingsRow} from '../rows';
import type {ArgusAiProvider} from '../../types';

// Last four characters, like the API tab's tokenPreview. Fewer than four says
// nothing; more starts to be worth reading.
function maskKey(key: string | null | undefined): string {
  const value = String(key || '');
  if (!value) {
    return 'No key';
  }
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}

// What the Test button reports. Kept as one value rather than two booleans so
// "never tested", "testing", "worked" and "said this" cannot be in conflict.
type TestResult = {ok: boolean; message: string};

function ProviderForm({provider, exists, onCancel, onSaved}: {
  provider: ArgusAiProvider;
  exists: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const {aiProviders} = useWorkspace();
  const [draft, setDraft] = useState<ArgusAiProvider>(provider);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [error, setError] = useState('');

  const preset = presetFor(draft.kind);
  const needsBaseUrl = draft.kind === 'custom';
  const endpoint = draft.base_url?.trim() || preset?.baseUrl || '';
  const problems: string[] = [];
  if (!draft.name.trim()) {
    problems.push('Name it.');
  }
  if (!draft.model.trim()) {
    problems.push('Pick a model.');
  }
  if (!endpoint) {
    problems.push('Give it an endpoint.');
  }
  if (preset?.needsKey && !draft.api_key?.trim()) {
    problems.push('This provider needs a key.');
  }

  // Tests the draft, not the saved row: the whole reason to test is to find out
  // whether what you just typed works, before it is written.
  async function runTest() {
    setTesting(true);
    setTest(null);
    const answer = await native?.testAiProvider?.(runtimeProvider(draft));
    setTesting(false);
    if (!answer) {
      setTest({ok: false, message: 'Testing needs the desktop app.'});
      return;
    }
    setTest(answer.ok ?
      {ok: true, message: `${draft.model} answered.`} :
      {ok: false, message: answer.error || 'The provider did not answer.'});
  }

  async function save() {
    setSaving(true);
    setError('');
    const failure = await aiProviders.save({
      ...draft,
      name: draft.name.trim(),
      model: draft.model.trim(),
      base_url: draft.base_url?.trim() || null,
      api_key: draft.api_key?.trim() || null,
    }, exists);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    onSaved();
  }

  return (
    <div className="ai-provider-form">
      <Field label="Provider">
        <select
          value={draft.kind}
          onChange={(event) => {
            const next = presetFor(event.target.value);
            setTest(null);
            setDraft({
              ...draft,
              kind: event.target.value,
              // The model comes with the provider, so switching from OpenAI to
              // Anthropic must not leave gpt-4.1-mini in the box. Only replaced
              // when it still holds the outgoing preset's suggestion or
              // nothing -- a model the user typed is theirs.
              model: !draft.model.trim() || draft.model === preset?.suggestedModel ?
                next?.suggestedModel || '' :
                draft.model,
              // Same rule for the endpoint, which for every preset but 'custom'
              // is meant to be empty.
              base_url: draft.base_url === preset?.baseUrl ? null : draft.base_url,
            });
          }}
        >
          {AI_PROVIDER_PRESETS.map((option) => (
            <option key={option.kind} value={option.kind}>{option.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Name" hint="What the automation editor lists it as.">
        <input
          value={draft.name}
          placeholder="Prod OpenAI"
          onChange={(event) => setDraft({...draft, name: event.target.value})}
        />
      </Field>

      <Field
        label="Model"
        hint="Free text. These services rename and retire models faster than this app ships."
      >
        <input
          value={draft.model}
          placeholder={preset?.suggestedModel || 'model-name'}
          onChange={(event) => setDraft({...draft, model: event.target.value})}
        />
      </Field>

      <Field
        label={needsBaseUrl ? 'Endpoint' : 'Endpoint (optional)'}
        hint={needsBaseUrl ?
          'An OpenAI-compatible base URL, ending in /v1.' :
          `Leave empty for ${preset?.baseUrl || 'the default'}. Set it to reach a ` +
            'self-hosted gateway or a regional endpoint.'}
      >
        <input
          value={draft.base_url || ''}
          placeholder={preset?.baseUrl || 'https://…/v1'}
          onChange={(event) => setDraft({...draft, base_url: event.target.value})}
        />
      </Field>

      {preset?.needsKey !== false && (
        <Field
          label="API key"
          hint={
            <>
              Stored in the workspace, so every member's runs use it.{' '}
              {preset?.keyUrl && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void native?.openExternal?.(preset.keyUrl as string)}
                >Get one <ExternalLink size={12} /></button>
              )}
            </>
          }
        >
          {/* type="text", not "password". The field is only ever filled by the
              person who owns the key, a masked box makes a mistyped key
              impossible to spot, and the browser's password manager offering to
              save an API key is worse than either. */}
          <input
            value={draft.api_key || ''}
            placeholder={preset?.needsKey ? 'sk-…' : 'Not needed for a local runtime'}
            spellCheck={false}
            onChange={(event) => setDraft({...draft, api_key: event.target.value})}
          />
        </Field>
      )}

      {test && (
        <p className={test.ok ? 'ai-provider-test is-ok' : 'ai-provider-test is-bad'}>
          {test.ok ? <Check size={14} /> : <TriangleAlert size={14} />} {test.message}
        </p>
      )}
      {error && <p className="settings-error">{error}</p>}

      <div className="ai-provider-form-actions">
        <BusyButton
          busy={testing}
          busyLabel="Testing"
          className="ghost"
          disabled={problems.length > 0}
          onClick={() => void runTest()}
          title={problems.length > 0 ? problems.join(' ') : 'Send one short prompt'}
        >Test</BusyButton>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <BusyButton
          busy={saving}
          busyLabel="Saving"
          disabled={problems.length > 0}
          onClick={() => void save()}
          title={problems.length > 0 ? problems.join(' ') : undefined}
        >Save</BusyButton>
      </div>
    </div>
  );
}

export function AiProvidersSection() {
  const org = useOrg();
  const {data, aiProviders, toast} = useWorkspace();
  const providers = data.state.ai_providers;
  // The row being edited, or a blank one. Null means the list.
  const [draft, setDraft] = useState<{provider: ArgusAiProvider; exists: boolean} | null>(null);
  const canEdit = org.isOwner;

  if (draft) {
    return (
      <SettingsGroup title={draft.exists ? 'Edit provider' : 'Add a provider'}>
        <ProviderForm
          provider={draft.provider}
          exists={draft.exists}
          onCancel={() => setDraft(null)}
          onSaved={() => setDraft(null)}
        />
      </SettingsGroup>
    );
  }

  return (
    <>
      <SettingsGroup title="AI providers">
        {providers.length === 0 && (
          <SettingsRow
            label="Nothing configured yet"
            icon={<Sparkles size={15} />}
            description={canEdit ?
              'Add a provider and the Ask AI and AI check steps can read a page, ' +
                'answer a question about it, or branch on what they find.' :
              'Only the workspace owner can add one. Ask them to, and the AI steps ' +
                'will work for your runs too.'}
          />
        )}

        {providers.map((provider) => {
          const preset = presetFor(provider.kind);
          return (
            <SettingsRow
              key={provider.id}
              icon={<Sparkles size={15} />}
              label={provider.name}
              description={
                <>
                  {/* An unrecognised kind is reported rather than guessed at:
                      a row written by a newer build names a real service this
                      one has not heard of, and calling it "Other" would be a
                      claim about an endpoint we did not choose. */}
                  {preset ? preset.label : `${provider.kind} (not recognised by this version)`}
                  {' · '}{provider.model}
                  {' · '}<span className="ai-provider-key">
                    <KeyRound size={11} /> {maskKey(provider.api_key)}
                  </span>
                </>
              }
            >
              <div className="ai-provider-actions">
                {provider.is_default ? (
                  <Badge tone="active">Default</Badge>
                ) : canEdit && (
                  <button
                    className="ghost small"
                    onClick={() => void aiProviders.setDefault(provider.id)}
                    title="Used by any AI step that names no provider"
                  >Make default</button>
                )}
                {canEdit && (
                  <>
                    <button
                      className="ghost small"
                      onClick={() => setDraft({provider, exists: true})}
                    >Edit</button>
                    <button
                      className="ghost small danger"
                      aria-label={`Remove ${provider.name}`}
                      onClick={() => {
                        // Steps naming this provider are deliberately left
                        // alone rather than repointed -- see db/aiProviders.ts.
                        // They fail with a sentence saying so, which beats
                        // silently running against somebody else's account.
                        void aiProviders.remove(provider.id).then((ok) => {
                          if (ok) {
                            toast.setMessage(`${provider.name} removed`);
                          }
                        });
                      }}
                    ><X size={14} /></button>
                  </>
                )}
              </div>
            </SettingsRow>
          );
        })}
      </SettingsGroup>

      {canEdit && (
        <SettingsGroup>
          <SettingsRow
            label="Add a provider"
            description="OpenAI, Anthropic, DeepSeek, OpenRouter, a local LM Studio or Ollama, or any
              OpenAI-compatible endpoint."
          >
            <button
              className="ghost"
              onClick={() => setDraft({provider: aiProviders.blank(), exists: false})}
            ><Plus size={16} /> Add</button>
          </SettingsRow>
        </SettingsGroup>
      )}
    </>
  );
}
