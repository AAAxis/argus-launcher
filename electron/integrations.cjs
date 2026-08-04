// Registering the Argus MCP server in each agent tool's own config file.
//
// Split out of main.cjs, which was 3,855 lines and where this block was already
// self-contained. It handles four things that used to be tangled together:
// where each tool keeps its config, what shape that config wants, whether our
// entry is in there right now, and whether the tool is on this machine at all.
//
// This module never imports `electron` -- every path it needs is passed in --
// so it can be required from a script or exercised without an app instance,
// the same rule profile-icons.cjs keeps.
//
// ── Why file editing rather than each tool's own CLI ─────────────────────────
// Every CLI form of this we tried (`claude mcp add`, `claude mcp add-json`)
// proved unreliable on Windows. Editing the file has no shell argument-passing
// to go wrong.
//
// ── What we write, and why it needs nothing installed ────────────────────────
// The server is `electron/mcp/server.cjs`, shipped inside this app, started by
// the agent tool through the launcher's own binary with ELECTRON_RUN_AS_NODE=1.
// That was previously a Python package (`argus_hive_bridge`) at a checkout path
// the user had to supply -- which did not exist, could not be obtained, and so
// left every "connected" tool pointed at a missing interpreter.

const fs = require('node:fs');
const path = require('node:path');

// The name our server is registered under in every tool. Also the thing this
// module is allowed to touch: a config file may hold a dozen other servers and
// this app must leave every one of them exactly as it found it.
const SERVER_KEY = 'argus';

// ── Config locations ─────────────────────────────────────────────────────────
// Each tool keeps a single global registry. Split by platform only where the
// tool actually differs -- VS Code follows the OS convention for application
// support directories, the CLI tools all use a dotfile in $HOME on every OS.

function vscodeUserDir(home, platform) {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User');
  }
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User');
  }
  return path.join(home, '.config', 'Code', 'User');
}

function zedConfigDir(home, platform) {
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Zed');
  }
  return path.join(home, '.config', 'zed');
}

// One row per tool. `container` is the property path our entry sits under, and
// it is the only part that genuinely differs between JSON tools:
//
//   mcpServers.argus       Claude Code, Cursor, Gemini CLI, Windsurf
//   mcp.servers.argus      OpenClaw
//   servers.argus          VS Code
//   context_servers.argus  Zed
//
// `entryShape` covers the second difference: VS Code and Claude Code want an
// explicit "type": "stdio"; the rest infer stdio from the presence of `command`.
//
// `detect` lists paths that mean "this tool has run on this machine". Config
// directory presence is the only signal that works the same on macOS and
// Windows -- a binary on PATH is a bonus, never the sole test, because plenty
// of these ship as GUI apps that never put one there.
const TOOLS = {
  'claude-code': {
    format: 'json',
    configPath: (home) => path.join(home, '.claude.json'),
    container: ['mcpServers'],
    entryShape: 'typed',
    detect: (home) => [path.join(home, '.claude.json'), path.join(home, '.claude')],
  },
  codex: {
    format: 'toml',
    configPath: (home) => path.join(home, '.codex', 'config.toml'),
    detect: (home) => [path.join(home, '.codex')],
  },
  cursor: {
    format: 'json',
    configPath: (home) => path.join(home, '.cursor', 'mcp.json'),
    container: ['mcpServers'],
    entryShape: 'plain',
    detect: (home, platform) => [
      path.join(home, '.cursor'),
      platform === 'darwin' ?
        '/Applications/Cursor.app' :
        path.join(home, 'AppData', 'Local', 'Programs', 'cursor'),
    ],
  },
  openclaw: {
    format: 'json',
    configPath: (home) => path.join(home, '.openclaw', 'openclaw.json'),
    container: ['mcp', 'servers'],
    entryShape: 'plain',
    detect: (home) => [path.join(home, '.openclaw')],
  },
  'gemini-cli': {
    format: 'json',
    configPath: (home) => path.join(home, '.gemini', 'settings.json'),
    container: ['mcpServers'],
    entryShape: 'plain',
    detect: (home) => [path.join(home, '.gemini')],
  },
  windsurf: {
    format: 'json',
    configPath: (home) => path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
    container: ['mcpServers'],
    entryShape: 'plain',
    detect: (home) => [path.join(home, '.codeium', 'windsurf'), path.join(home, '.codeium')],
  },
  vscode: {
    format: 'json',
    configPath: (home, platform) => path.join(vscodeUserDir(home, platform), 'mcp.json'),
    container: ['servers'],
    entryShape: 'typed',
    detect: (home, platform) => [vscodeUserDir(home, platform), path.join(home, '.vscode')],
  },
  zed: {
    format: 'json',
    configPath: (home, platform) => path.join(zedConfigDir(home, platform), 'settings.json'),
    container: ['context_servers'],
    entryShape: 'plain',
    detect: (home, platform) => [
      zedConfigDir(home, platform),
      platform === 'darwin' ? '/Applications/Zed.app' : path.join(home, '.zed'),
    ],
  },
};

// Tools with no config file of their own. Hive is wired by a token in its .env,
// and "other" is any MCP client this app cannot write to -- both connect by
// showing the user a snippet instead of editing anything.
const MANUAL_IDS = ['hive', 'other'];

function isManual(integrationId) {
  return MANUAL_IDS.includes(integrationId);
}

function configPathFor(integrationId, home, platform) {
  const tool = TOOLS[integrationId];
  return tool ? tool.configPath(home, platform) : null;
}

// ── Reading and writing ──────────────────────────────────────────────────────

function readJsonConfig(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Missing or unreadable -- treat as empty, which is what the writers want:
    // a first connect should create the file rather than refuse.
  }
  return {};
}

// Atomic, because ~/.claude.json is not a config file we own -- it is Claude
// Code's live state (74 top-level keys, ~128 KB on a working install). A
// truncating write there loses the user's projects, history and onboarding
// state, not just our entry. Same directory so the rename stays on one
// filesystem and therefore stays atomic.
//
// This does NOT protect against a running Claude Code writing between our read
// and our rename -- nothing on this side can. It is why the UI tells the user
// to restart the tool after connecting.
function writeFileAtomic(configPath, contents) {
  fs.mkdirSync(path.dirname(configPath), {recursive: true});
  const temp = `${configPath}.argus-tmp`;
  try {
    fs.writeFileSync(temp, contents);
    fs.renameSync(temp, configPath);
  } catch (error) {
    try {
      fs.rmSync(temp, {force: true});
    } catch {
      // Best effort -- the original write error is the one worth reporting.
    }
    throw error;
  }
}

// Walks (creating as it goes) the container path, replacing any non-object it
// finds. A tool whose config has `mcpServers: null` or `mcpServers: []` should
// end up connected, not throw.
function containerFor(config, containerPath) {
  let node = config;
  for (const key of containerPath) {
    if (!node[key] || typeof node[key] !== 'object' || Array.isArray(node[key])) {
      node[key] = {};
    }
    node = node[key];
  }
  return node;
}

// `spawn` is {command, args, env} -- the one description of how to start our
// server, built once by the caller so every tool is guaranteed to be handed the
// same thing.
function jsonEntry(tool, spawn) {
  const entry = tool.entryShape === 'typed' ? {type: 'stdio'} : {};
  entry.command = spawn.command;
  entry.args = [...spawn.args];
  entry.env = {...spawn.env};
  return entry;
}

// ── Codex: TOML, spliced by hand ─────────────────────────────────────────────
// There is no TOML library here and adding one to write four lines is not worth
// it. This app only ever touches its own table, so "find this exact header, cut
// to the next top-level [section] or EOF, splice" is safe.

const CODEX_HEADER = `[mcp_servers.${SERVER_KEY}]`;

// Shared by the writer and the remover so the two can never disagree about
// where our table ends. The negative lookahead keeps our own [.env] subtable
// inside the section rather than treating it as the next one.
function codexSection(existing) {
  const start = existing.indexOf(CODEX_HEADER);
  if (start === -1) {
    return null;
  }
  const afterHeader = existing.slice(start + CODEX_HEADER.length);
  const next = afterHeader.match(new RegExp(`\\n\\[(?!mcp_servers\\.${SERVER_KEY}\\.)`));
  const end = next ?
    start + CODEX_HEADER.length + next.index + 1 :
    existing.length;
  return {start, end};
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function codexBlock(spawn) {
  const lines = [
    CODEX_HEADER,
    `command = ${tomlString(spawn.command)}`,
    `args = [${spawn.args.map(tomlString).join(', ')}]`,
    '',
    `[mcp_servers.${SERVER_KEY}.env]`,
  ];
  for (const [key, value] of Object.entries(spawn.env)) {
    lines.push(`${key} = ${tomlString(value)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function applyCodex(configPath, spawn) {
  let existing = '';
  try {
    existing = fs.readFileSync(configPath, 'utf8');
  } catch {
    // No config yet -- creating it is the correct outcome.
  }
  const block = codexBlock(spawn);
  const section = codexSection(existing);
  if (!section) {
    const separator = existing.trim().length > 0 ? '\n\n' : '';
    writeFileAtomic(configPath, existing.replace(/\s*$/, '') + separator + block);
  } else {
    writeFileAtomic(configPath, existing.slice(0, section.start) + block + existing.slice(section.end));
  }
  return configPath;
}

// ── Public surface ───────────────────────────────────────────────────────────

// Writes (or replaces) our server registration. Returns the path touched.
function applyIntegrationConfig({integrationId, home, platform, spawn}) {
  const tool = TOOLS[integrationId];
  if (!tool) {
    throw new Error(`No config writer for ${integrationId}`);
  }
  const configPath = tool.configPath(home, platform);
  if (tool.format === 'toml') {
    return applyCodex(configPath, spawn);
  }
  const config = readJsonConfig(configPath);
  containerFor(config, tool.container)[SERVER_KEY] = jsonEntry(tool, spawn);
  writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

// Deletes only our entry. The other half of connecting: revoking a key without
// this leaves the tool retrying a dead token forever, with nothing on screen
// explaining why.
function removeIntegrationConfig({integrationId, home, platform}) {
  const tool = TOOLS[integrationId];
  if (!tool) {
    return null;
  }
  const configPath = tool.configPath(home, platform);
  if (!fs.existsSync(configPath)) {
    return configPath;
  }
  if (tool.format === 'toml') {
    const existing = fs.readFileSync(configPath, 'utf8');
    const section = codexSection(existing);
    if (section) {
      const next = existing.slice(0, section.start) + existing.slice(section.end);
      writeFileAtomic(configPath, next.replace(/\n{3,}/g, '\n\n'));
    }
    return configPath;
  }
  const config = readJsonConfig(configPath);
  let node = config;
  for (const key of tool.container) {
    if (!node[key] || typeof node[key] !== 'object') {
      return configPath;
    }
    node = node[key];
  }
  if (node[SERVER_KEY]) {
    delete node[SERVER_KEY];
    writeFileAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  return configPath;
}

// What the config actually says right now, which is not the same question as
// "did this app create a key". The wiring lives in a file the user or another
// tool can edit at any time, and until this existed nothing noticed.
//
// Returns the command/args too, so the caller can tell a current entry from one
// left behind by the Python bridge.
function readIntegrationEntry({integrationId, home, platform}) {
  const tool = TOOLS[integrationId];
  if (!tool) {
    return {configPath: null, hasEntry: false, command: null, args: []};
  }
  const configPath = tool.configPath(home, platform);
  const miss = {configPath, hasEntry: false, command: null, args: []};
  try {
    if (tool.format === 'toml') {
      const existing = fs.readFileSync(configPath, 'utf8');
      const section = codexSection(existing);
      if (!section) {
        return miss;
      }
      const body = existing.slice(section.start, section.end);
      const command = /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(body);
      return {
        configPath,
        hasEntry: true,
        command: command ? command[1].replace(/\\(.)/g, '$1') : null,
        args: [],
      };
    }
    let node = readJsonConfig(configPath);
    for (const key of tool.container) {
      if (!node[key] || typeof node[key] !== 'object') {
        return miss;
      }
      node = node[key];
    }
    const entry = node[SERVER_KEY];
    if (!entry || typeof entry !== 'object') {
      return miss;
    }
    return {
      configPath,
      hasEntry: true,
      command: typeof entry.command === 'string' ? entry.command : null,
      args: Array.isArray(entry.args) ? entry.args : [],
    };
  } catch {
    // No config file yet -- not connected, which `miss` already says.
    return miss;
  }
}

// An entry is stale if it names the Python bridge that no longer ships, or if
// whatever it names is simply not on disk. Both produce the same user-visible
// symptom -- the tool silently fails to start the server on every launch -- so
// both get the same repair offer.
function isStaleEntry(entry) {
  if (!entry.hasEntry || !entry.command) {
    return false;
  }
  if (/[/\\]\.venv[/\\](bin|Scripts)[/\\]python/i.test(entry.command)) {
    return true;
  }
  return !fs.existsSync(entry.command);
}

// Advisory only. A false negative here must never block connecting -- plenty of
// these tools can be installed somewhere this cannot see, and refusing to wire
// up a working install would be a worse failure than an over-eager card.
function detectTool(integrationId, home, platform) {
  const tool = TOOLS[integrationId];
  if (!tool) {
    return false;
  }
  return tool.detect(home, platform).some((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
}

module.exports = {
  SERVER_KEY,
  TOOLS,
  applyIntegrationConfig,
  configPathFor,
  detectTool,
  isManual,
  isStaleEntry,
  readIntegrationEntry,
  readJsonConfig,
  removeIntegrationConfig,
  writeFileAtomic,
};
