import {useState} from 'react';
import {Check, Copy, Download, ExternalLink, Key, Plus, Shield} from 'lucide-react';
import {IntegrationMark} from '../ui/icons';
import {
  AGENT_TOOLS, API_BASE_URL, API_GROUPS, agentPrompt, apiExampleScript, authHeader, curlFor,
} from '../../data/apiDocs';
import {findIntegration} from '../../data/integrations';
import {native} from '../../native';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {AgentTool, ApiEndpoint} from '../../data/apiDocs';
import type {ApiKeys} from '../../hooks/useApiKeys';
import type {ApiKey} from '../../native';

export type ApiTabProps = {
  apiKeys: ApiKeys;
  signedInEmail: string;
  onOpenDocs: () => void;
  onKeyCreated: (key: {name: string; token: string}) => void;
};

export function ApiTab({apiKeys, signedInEmail, onOpenDocs, onKeyCreated}: ApiTabProps) {
  const {data, toast} = useWorkspace();
  const [newKeyName, setNewKeyName] = useState('');
  // Folder id, or '' for full access. Held as the raw select value rather than
  // as string[]|null so the <select> stays a controlled component.
  const [newKeyScope, setNewKeyScope] = useState('');
  // Which agent brief and which curl line were copied most recently, so the
  // matching button can confirm briefly. Two states, not one: only the endpoint
  // copy also raises the corner toast.
  const [copiedPrompt, setCopiedPrompt] = useState('');
  const [copiedEndpoint, setCopiedEndpoint] = useState('');

  async function copyText(text: string, remember: (id: string) => void, id: string) {
    await navigator.clipboard.writeText(text);
    remember(id);
    window.setTimeout(() => remember(''), 1800);
  }

  async function createKey() {
    const created = await apiKeys.create(newKeyName, newKeyScope);
    if (!created) {
      return;
    }
    onKeyCreated({name: created.name, token: created.token});
    setNewKeyName('');
    setNewKeyScope('');
  }

  async function downloadExample() {
    const content = apiExampleScript();
    const defaultName = `argys-api-example-${Date.now()}.js`;
    if (native?.saveTextFile) {
      const savedPath = await native.saveTextFile(defaultName, content);
      if (savedPath) {
        toast.setMessage(`Saved API example to ${savedPath.split('/').pop()}`);
      }
      return;
    }
    const blob = new Blob([content], {type: 'text/javascript'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = defaultName;
    link.click();
    URL.revokeObjectURL(url);
    toast.setMessage('Downloaded API example');
  }

  return (
    <section className="api-panel">
      <section className="api-summary">
        <div className="summary-item">
          <span>Base URL</span>
          <code>{API_BASE_URL}</code>
        </div>
        <div className="summary-item">
          <span>Account</span>
          <code>{signedInEmail}</code>
        </div>
        <div className="summary-item wide">
          <span>Header</span>
          <code>{authHeader()}</code>
        </div>
        <div className="summary-actions">
          <button className="ghost" onClick={onOpenDocs}>
            <ExternalLink size={15} /> API docs
          </button>
          <button onClick={() => void downloadExample()}>
            <Download size={15} /> Download example
          </button>
        </div>
      </section>

      <section className="api-note">
        <Shield size={18} />
        <span>Connected apps (Hive, etc.) show up on the Integrations tab via the connect flow. Create a key by hand here only for your own scripts.</span>
      </section>

      <section className="api-group">
        <h2>Hand this to an agent</h2>
        <div className="agent-prompts">
          <p>
            Copies a brief covering the base URL, auth, every endpoint below and
            the rules that go with them -- paste it into a fresh session and the
            agent can start calling the API straight away.
          </p>
          <div className="agent-prompt-buttons">
            {AGENT_TOOLS.map((tool: AgentTool) => {
              const integration = findIntegration(tool.id);
              return (
                <button
                  className="ghost"
                  key={tool.id}
                  onClick={() => void copyText(agentPrompt(tool), setCopiedPrompt, tool.id)}
                >
                  {integration ? <IntegrationMark integration={integration} size={15} /> : null}
                  {tool.name}
                  {copiedPrompt === tool.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="api-group">
        <h2>Create a key</h2>
        <div className="key-form">
          <label className="field">
            <span>Key name</span>
            <input
              type="text"
              placeholder="e.g. nightly warmup script"
              value={newKeyName}
              spellCheck={false}
              onChange={(event) => setNewKeyName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Access</span>
            <select value={newKeyScope} onChange={(event) => setNewKeyScope(event.target.value)}>
              <option value="">All folders</option>
              {data.state.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
          </label>
          <p className="field-note">
            The key is shown once, at creation, and only its hash is stored. Use
            one key per script so you can revoke them independently.
          </p>
          <div className="key-form-actions">
            <button onClick={() => void createKey()}>
              <Plus size={15} /> Create key
            </button>
          </div>
        </div>
      </section>

      <section className="api-group">
        <h2>Your keys</h2>
        {apiKeys.keys.length === 0 && <p className="endpoint empty-row">No keys yet.</p>}
        {apiKeys.keys.map((key: ApiKey) => {
          const integration = findIntegration(key.integrationId);
          return (
            <div className="endpoint" key={key.id}>
              <div className="endpoint-head key-row-head">
                <span className="key-mark">
                  {integration ?
                    <IntegrationMark integration={integration} size={16} /> :
                    <Key size={15} />}
                </span>
                <strong className="key-name" title={key.name}>
                  {key.name}
                  {key.legacy && (
                    <em className="key-legacy" title="Created before keys recorded an owner">legacy</em>
                  )}
                </strong>
                <code className="path">...{key.tokenPreview}</code>
                <span className="endpoint-label">{apiKeys.describeScope(key, data.state.folders)}</span>
                <span className="endpoint-label">
                  {key.lastUsedAt ?
                    `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` :
                    'Never used'}
                </span>
                <button className="copy-button danger" onClick={() => void apiKeys.revoke(key.id)}>
                  Revoke
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <div className="api-groups">
        {API_GROUPS.map((group) => (
          <section className="api-group" key={group.title}>
            <h2>{group.title}</h2>
            {group.endpoints.map((endpoint: ApiEndpoint) => {
              const id = `${endpoint.method} ${endpoint.path}`;
              const isCopied = copiedEndpoint === id;
              return (
                <article className="endpoint" key={`${endpoint.method}-${endpoint.path}`}>
                  <div className="endpoint-head">
                    <span className={`method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                    <code className="path">{endpoint.path}</code>
                    <span className="endpoint-label">{endpoint.label}</span>
                    <button
                      className={isCopied ? 'icon-button endpoint-copy copied' : 'icon-button endpoint-copy'}
                      aria-label={`Copy curl for ${id}`}
                      title={isCopied ? 'Copied' : 'Copy curl'}
                      onClick={() => void copyText(curlFor(endpoint), setCopiedEndpoint, id)}
                    >
                      {isCopied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                  {endpoint.body && <pre>{endpoint.body}</pre>}
                </article>
              );
            })}
          </section>
        ))}
      </div>

      {copiedEndpoint && <div className="toast">Copied {copiedEndpoint}</div>}
    </section>
  );
}
