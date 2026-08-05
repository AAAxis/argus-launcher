import {useMemo, useState} from 'react';
import {
  Bot, Check, ChevronRight, Copy, Download, ExternalLink, Key, Plug, Plus, Search, Shield, Terminal,
} from 'lucide-react';
import {Badge} from '../ui/Badge';
import {EmptyState} from '../ui/EmptyState';
import {IntegrationMark} from '../ui/icons';
import {
  AGENT_TOOLS, API_BASE_URL, agentPrompt, apiExampleScript, authHeader, curlFor,
} from '../../data/apiDocs';
import {API_ROUTES, entryMatches, mcpToolNames, referenceGroups} from '../../api/routes';
import {findIntegration} from '../../data/integrations';
import {native} from '../../native';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {AgentTool} from '../../data/apiDocs';
import type {ApiEntry} from '../../api/routes';
import type {ApiKeys} from '../../hooks/useApiKeys';
import type {ApiKey} from '../../native';

const TOTAL_TOOLS = mcpToolNames().length;

export type ApiTabProps = {
  apiKeys: ApiKeys;
  signedInEmail: string;
  onOpenDocs: () => void;
  onOpenIntegrations: () => void;
  onKeyCreated: (key: {name: string; token: string}) => void;
};

// The two ways into this launcher, named and told apart.
//
// This tab described one surface in two vocabularies -- endpoints in the
// reference, `argus_*` tool names in the agent briefs -- and never said that
// they are the same capabilities reached by different callers. So the question
// "which of these is the MCP part" had no answer on the screen, and an MCP
// user looking for the server row to paste found a base URL that is not how
// MCP is wired at all.
function WaysIn({onOpenIntegrations}: {onOpenIntegrations: () => void}) {
  const tools = mcpToolNames();
  return (
    <section className="api-ways">
      <article className="api-way">
        <header>
          <Bot size={16} />
          <h2>MCP — for AI agents</h2>
        </header>
        <p>
          Claude Code, Cursor, Codex and the rest do not call a URL. Each one
          starts the MCP server built into this app and calls its tools by name:
        </p>
        <p className="api-way-tools">
          <code>argus_list_profiles</code>, <code>argus_launch_profile</code>,{' '}
          <code>argus_navigate</code>, <code>argus_screenshot</code>{' '}
          <span>and {tools.length - 4} more</span>
        </p>
        <p>
          You never paste anything: connecting a tool writes the server into its
          own config file and creates the key it authenticates with.
        </p>
        <div className="api-way-actions">
          <button onClick={onOpenIntegrations}>
            <Plug size={15} /> Connect a tool
          </button>
        </div>
      </article>

      <article className="api-way">
        <header>
          <Terminal size={16} />
          <h2>HTTP — for your own code</h2>
        </header>
        <p>
          A script, a cron job, or anything that does not speak MCP. Same
          profiles, same actions, called as ordinary requests:
        </p>
        <div className="api-way-facts">
          <div>
            <span>Base URL</span>
            <code>{API_BASE_URL}</code>
          </div>
          <div>
            <span>Every /v1/ request</span>
            <code>{authHeader()}</code>
          </div>
        </div>
        <p>
          Make the key yourself below, then copy a ready-made curl line from any
          endpoint in the reference.
        </p>
      </article>
    </section>
  );
}

// One capability, both of its faces.
//
// The head is a button rather than a <summary> for two reasons. A controlled
// <details> and an active search fight each other -- forcing `open` on a match
// leaves React's state and the browser's disagreeing the moment the user clicks
// one -- and the copy button would have had to live inside the summary, which
// makes it a nested interactive element that toggles the row on its way to
// copying. Two siblings have neither problem.
function EntryRow({entry, open, onToggle, copied, onCopy}: {
  entry: ApiEntry;
  open: boolean;
  onToggle: () => void;
  copied: boolean;
  onCopy: () => void;
}) {
  const {route} = entry;
  return (
    <div className={open ? 'api-entry is-open' : 'api-entry'}>
      <div className="api-entry-head">
        <button className="api-entry-toggle" aria-expanded={open} onClick={onToggle}>
          <ChevronRight className="api-entry-caret" size={14} />
          {/* A tool with no route gets the same slot, marked. Leaving it blank
              would have read as a route whose method failed to load. */}
          {route ?
            <span className={`method ${route.method.toLowerCase()}`}>{route.method}</span> :
            <span className="method tool" title="Driven over CDP — no HTTP endpoint">MCP</span>}
          <code className="path">{route ? route.path : entry.mcp}</code>
          {/* The answer to "can an agent do this", on every row. A route with no
              tool is reachable by curl and by nothing else, and that fact had
              no surface anywhere in the app before. */}
          {entry.mcp && route ?
            <code className="api-entry-tool">{entry.mcp}</code> :
            null}
          {!entry.mcp && <span className="api-entry-httponly">HTTP only</span>}
          <span className="api-entry-label">{entry.label}</span>
        </button>
        {route && (
          <button
            className={copied ? 'icon-button endpoint-copy copied' : 'icon-button endpoint-copy'}
            aria-label={`Copy curl for ${entry.id}`}
            title={copied ? 'Copied' : 'Copy curl'}
            onClick={onCopy}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        )}
      </div>

      {open && (
        <div className="api-entry-body">
          {route?.scope === 'unscoped' && (
            <p className="api-entry-note">
              Needs a key with access to all folders. Automations are shared
              across every folder, so a folder-scoped key may run them but not
              change them.
            </p>
          )}
          {!route && (
            <p className="api-entry-note">
              Drives an open page over the browser's debugging port, so there is
              no endpoint to call. Launch the profile first — an agent reaches
              this through <code>{entry.mcp}</code>.
            </p>
          )}
          {route?.fields?.length ? (
            <dl className="api-entry-fields">
              {route.fields.map((field) => (
                <div key={field.key}>
                  <dt>
                    <code>{field.key}</code>
                    <span className="api-field-type">{field.type}</span>
                    {field.required && <span className="api-field-required">required</span>}
                  </dt>
                  {field.description && <dd>{field.description}</dd>}
                </div>
              ))}
            </dl>
          ) : null}
          {route?.body && <pre>{route.body}</pre>}
          {route && <pre className="api-entry-curl">{curlFor(route)}</pre>}
        </div>
      )}
    </div>
  );
}

export function ApiTab({
  apiKeys, signedInEmail, onOpenDocs, onOpenIntegrations, onKeyCreated,
}: ApiTabProps) {
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
  // The reference opens closed. Both sets are lists rather than Sets so that a
  // re-render compares by value -- the groups and entries are a few dozen
  // strings, and a Set here buys nothing but an identity to get wrong.
  const [query, setQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [openEntries, setOpenEntries] = useState<string[]>([]);

  const needle = query.trim().toLowerCase();
  const matched = useMemo(() => referenceGroups()
      .map((group) => {
        const entries = group.entries.filter((entry) => entryMatches(entry, needle));
        return {...group, entries, toolCount: entries.filter((entry) => entry.mcp).length};
      })
      .filter((group) => group.entries.length > 0), [needle]);

  // A search that matched three endpoints in a collapsed group has told the
  // user nothing, so matching groups open.
  //
  // Clearing the box closes them all again. Leaving them open sounds kinder and
  // is not: a one-character query matches nearly every row, so the first
  // keystroke opens all six groups and clearing it would hand back the same
  // thirty-row wall this tab was rebuilt to stop being. Entry state is kept
  // separately, so a row you opened is still open when you find it again.
  function searchFor(next: string) {
    setQuery(next);
    setOpenGroups(next.trim() ?
      referenceGroups()
          .filter((group) => group.entries.some((entry) => entryMatches(entry, next)))
          .map((group) => group.title) :
      []);
  }

  function toggleGroup(title: string) {
    setOpenGroups((current) => current.includes(title) ?
      current.filter((item) => item !== title) :
      [...current, title]);
  }

  function toggleEntry(id: string) {
    setOpenEntries((current) => current.includes(id) ?
      current.filter((item) => item !== id) :
      [...current, id]);
  }

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
        {/* Orientation only. What a key is and what it can do belongs with the
            form that mints one, and used to be crammed in here as a second
            sentence that neither element then said properly. */}
        <span>Everything on this tab drives Argus on this machine — the same profiles, proxies and automations you see in the app, reached over its local API.</span>
      </section>

      <WaysIn onOpenIntegrations={onOpenIntegrations} />

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
        {/* The heading named the action and nothing else, so the one question a
            first-time visitor actually has -- what is a key, and what can
            whoever holds it do to my profiles -- was answered nowhere on the
            screen. It is answered before the form now, because it decides
            whether you should be filling the form in at all. */}
        <p className="api-group-lead">
          A key is a password for this launcher's local API. Whatever holds it
          can list your profiles, launch them, drive the open page and reassign
          their proxies — from a script, a scheduled job, or an AI agent — with
          no sign-in and no further prompting.
        </p>
        <p className="api-group-lead">
          You only need one for code you write yourself. Connecting a tool on
          the <strong>Integrations</strong> tab creates its own key and fills it
          in for you, so there is nothing to copy or paste.
        </p>
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
            {/* A <p>, not a <span>: `.field > span` is the label rule, and it
                out-specifies .field-hint, so a span here renders as a second
                uppercase label. Field.tsx sets the convention. */}
            <p className="field-hint">
              Only you ever see this. Name it after whatever will use the key —
              a key you no longer recognise is a key you cannot safely revoke.
            </p>
          </label>
          <label className="field">
            <span>Access</span>
            <select value={newKeyScope} onChange={(event) => setNewKeyScope(event.target.value)}>
              <option value="">All folders</option>
              {data.state.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.name}</option>
              ))}
            </select>
            <p className="field-hint">
              {newKeyScope ?
                'Reaches only the profiles in that folder. Everything else is invisible to it.' :
                'Reaches every profile in the workspace. Pick a folder to narrow it.'}
            </p>
          </label>
          <p className="field-note">
            The key is shown once, at creation, and only its hash is stored — so
            if you lose it, revoke it and make another. It works on this machine
            only: the API answers on loopback and is not reachable from
            anywhere else. Use one key per script so you can revoke them
            independently.
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

      <section className="api-reference">
        <div className="api-reference-bar">
          <div className="api-reference-title">
            <h2>Reference</h2>
            {/* Both halves, because they are different questions. Not every
                endpoint has a tool, so an agent's reach is the smaller number
                and the tab should say so before anything is opened. */}
            <span>{API_ROUTES.length} endpoints &middot; {TOTAL_TOOLS} agent tools</span>
          </div>
          {/* Names the two columns below. Every row carries both faces of one
              capability and, unlabelled, the second column read as a stray
              identifier rather than as the MCP half of the same thing. */}
          <div className="api-reference-legend">
            <span><em>HTTP</em> endpoint</span>
            <span><em>MCP</em> tool name</span>
          </div>
          <label className="integration-search">
            <Search size={15} />
            <input
              aria-label="Search endpoints and tools"
              placeholder="Search endpoints and tools"
              value={query}
              spellCheck={false}
              onChange={(event) => searchFor(event.target.value)}
            />
          </label>
        </div>

        {matched.map((group) => {
          const isOpen = openGroups.includes(group.title);
          return (
            <section className="api-refgroup" key={group.title}>
              <button
                className="api-refgroup-head"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.title)}
              >
                <ChevronRight className="api-entry-caret" size={15} />
                <strong>{group.title}</strong>
                <span className="api-refgroup-count">
                  {group.entries.length} {group.entries.length === 1 ? 'endpoint' : 'endpoints'}
                </span>
                {group.toolCount > 0 ? (
                  <Badge tone="info">{group.toolCount} tools</Badge>
                ) : (
                  <Badge title="No agent tool fronts these — they are reachable by curl only">
                    HTTP only
                  </Badge>
                )}
              </button>
              {isOpen && (
                <div className="api-refgroup-body">
                  {group.entries.map((entry) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      open={openEntries.includes(entry.id)}
                      onToggle={() => toggleEntry(entry.id)}
                      copied={copiedEndpoint === entry.id}
                      onCopy={() => {
                        if (entry.route) {
                          void copyText(curlFor(entry.route), setCopiedEndpoint, entry.id);
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {/* The search can only ever empty the list, never the table itself, so
            the way out is the way back -- same as the Integrations tab. */}
        {!matched.length && (
          <EmptyState
            icon={<Search size={20} />}
            title={`Nothing matches “${query}”`}
            body={`All ${API_ROUTES.length} endpoints are still here — this is only the filter.`}
          >
            <button className="ghost" onClick={() => setQuery('')}>Clear search</button>
          </EmptyState>
        )}
      </section>

      {copiedEndpoint && <div className="toast">Copied {copiedEndpoint}</div>}
    </section>
  );
}
