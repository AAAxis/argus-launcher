// Everything the API tab documents: the endpoint catalogue, and the three
// things it can hand you -- a curl line, a runnable example script, and a
// ready-to-paste brief for a coding agent.

export const API_BASE_URL = 'http://127.0.0.1:39219';

export type ApiEndpoint = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  label: string;
  body?: string;
};

export type ApiGroup = {
  title: string;
  endpoints: ApiEndpoint[];
};

// The agents a user is likely to hand this API to. `wiring` is the one thing
// that genuinely differs between them: where the MCP server is registered, and
// therefore whether the agent should reach for MCP tools or plain HTTP.
export type AgentTool = {
  id: 'claude-code' | 'codex' | 'cursor';
  name: string;
  wiring: string;
};

export const AGENT_TOOLS: AgentTool[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    wiring: 'If an "argus" MCP server is registered in ~/.claude.json, prefer its tools over raw HTTP; otherwise call the HTTP API below directly.',
  },
  {
    id: 'codex',
    name: 'Codex',
    wiring: 'If an [mcp_servers.argus] table exists in ~/.codex/config.toml, prefer its tools over raw HTTP; otherwise call the HTTP API below directly.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    wiring: 'If an "argus" MCP server is registered in ~/.cursor/mcp.json, prefer its tools over raw HTTP; otherwise call the HTTP API below directly.',
  },
];

export const API_GROUPS: ApiGroup[] = [
  {
    title: 'Profiles',
    endpoints: [
      {method: 'GET', path: '/v1/profiles', label: 'List profiles'},
      {
        method: 'POST',
        path: '/v1/profiles',
        label: 'Create profile',
        body: '{ "name": "Profile 1", "proxyId": "proxy_id" }',
      },
      {
        method: 'PATCH',
        path: '/v1/profiles/{id}',
        label: 'Update status, tags, folder, or proxy',
        body: '{ "status": "Ready", "tags": ["warmup"] }',
      },
      {method: 'DELETE', path: '/v1/profiles/{id}', label: 'Delete profile'},
      {method: 'POST', path: '/v1/profiles/{id}/launch', label: 'Launch anonymous browser session'},
      {method: 'POST', path: '/v1/profiles/{id}/close', label: 'Close browser session'},
    ],
  },
  {
    title: 'Proxies',
    endpoints: [
      {method: 'GET', path: '/v1/proxies', label: 'List proxies'},
      {
        method: 'POST',
        path: '/v1/proxies',
        label: 'Add proxy',
        body: '{ "name": "US proxy", "type": "socks5", "host": "1.2.3.4", "port": 1080 }',
      },
      {method: 'POST', path: '/v1/proxies/{id}/check', label: 'Check egress IP'},
      {method: 'DELETE', path: '/v1/proxies/{id}', label: 'Remove proxy'},
    ],
  },
  {
    title: 'Shared data',
    endpoints: [
      {method: 'GET', path: '/v1/shared/bookmarks', label: 'List shared bookmarks'},
      {
        method: 'POST',
        path: '/v1/shared/bookmarks',
        label: 'Create or update bookmark',
        body: '{ "title": "Argys", "url": "https://www.browserargus.com/" }',
      },
      {method: 'DELETE', path: '/v1/shared/bookmarks', label: 'Remove bookmark by URL'},
      {method: 'GET', path: '/v1/shared/extensions', label: 'List shared extensions'},
      {
        method: 'POST',
        path: '/v1/shared/extensions',
        label: 'Register unpacked extension path',
        body: '{ "path": "/Users/name/extension" }',
      },
      {
        method: 'DELETE',
        path: '/v1/shared/extensions',
        label: 'Remove extension by path',
        body: '{ "path": "/Users/name/extension" }',
      },
    ],
  },
];

export function authHeader() {
  return 'Authorization: Bearer <YOUR_API_KEY>';
}

export function curlFor(endpoint: ApiEndpoint) {
  const lines = [
    `curl -X ${endpoint.method} "${API_BASE_URL}${endpoint.path}"`,
    `  -H "${authHeader()}"`,
    '  -H "Content-Type: application/json"',
  ];
  if (endpoint.body) {
    lines.push(`  -d '${endpoint.body}'`);
  }
  return lines.join(' \\\n');
}

export function apiExampleScript() {
  return `#!/usr/bin/env node
// Argus Launcher Browser API example.
// Keep Argus Launcher open and signed in while running this script.

const BASE_URL = ${JSON.stringify(API_BASE_URL)};
// Create a key in Settings -> API and paste it here. Keys are only shown
// once, at creation -- Anty never stores or displays the raw value again.
const TOKEN = '<YOUR_API_KEY>';

async function argys(method, path, body) {
  const response = await fetch(\`\${BASE_URL}\${path}\`, {
    method,
    headers: {
      Authorization: \`Bearer \${TOKEN}\`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(\`\${method} \${path} failed: \${response.status} \${text}\`);
  }
  return data;
}

async function main() {
  console.log('Health:', await argys('GET', '/health'));

  const profiles = await argys('GET', '/v1/profiles');
  console.log('Profiles:', profiles);

  const proxy = await argys('POST', '/v1/proxies', {
    name: 'Example US proxy',
    type: 'socks5',
    host: '1.2.3.4',
    port: 1080,
    username: 'user',
    password: 'pass',
  });
  console.log('Created proxy:', proxy);

  const profile = await argys('POST', '/v1/profiles', {
    name: 'API example profile',
    proxyId: proxy.id,
    startUrl: 'https://browserargus.com/',
  });
  console.log('Created profile:', profile);

  console.log('Launch:', await argys('POST', \`/v1/profiles/\${profile.id}/launch\`));

  // Optional cookie import helper. Replace folderPath with the folder that
  // contains exported cookie txt/json files named after profile names.
  // console.log('Cookie match:', await argys('POST', '/v1/cookies/bulk-match', {
  //   folderPath: '/Users/name/Downloads/cookies',
  //   profileIds: [profile.id],
  // }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
`;
}

// A ready-to-paste brief for a coding agent. Everything an agent needs to
// start calling this API without being told twice: base URL, auth scheme, the
// full endpoint list with request bodies, and the house rules it would
// otherwise have to guess (keys are per-script, the browser stays anonymous).
//
// Tailored per tool only in the first paragraph -- the agents differ in how
// they are wired up, not in what the API does.
export function agentPrompt(tool: AgentTool) {
  const endpoints = API_GROUPS
      .map((group) => {
        const rows = group.endpoints
            .map((endpoint) => {
              const line = `- ${endpoint.method} ${endpoint.path} — ${endpoint.label}`;
              return endpoint.body ? `${line}\n  body: ${endpoint.body}` : line;
            })
            .join('\n');
        return `### ${group.title}\n${rows}`;
      })
      .join('\n\n');
  return [
    `You are working in ${tool.name}. ${tool.wiring}`,
    '',
    '## Argus local automation API',
    '',
    `Base URL: ${API_BASE_URL} (loopback only — it is not reachable off this machine)`,
    'Auth: every /v1/* request needs `Authorization: Bearer <ARGYS_API_TOKEN>`.',
    'Content-Type: application/json for requests with a body.',
    '',
    'Argus manages anti-detect browser profiles. Each profile is an isolated',
    'browser identity with its own proxy, fingerprint and cookie jar. The API',
    'lets you list, create, update and launch them.',
    '',
    '## Endpoints',
    '',
    endpoints,
    '',
    '## Rules',
    '',
    '- A key may be scoped to specific folders. A 403 means the key cannot see',
    '  that profile, not that the profile is missing — do not retry.',
    '- Never hardcode the token in committed files. Read it from the',
    '  ARGYS_API_TOKEN environment variable.',
    '- Launching a profile starts a separate anonymous browser process. Never',
    '  pass it credentials, tokens, or anything identifying.',
    '- Profile ids are also on-disk directory names. Treat them as immutable.',
    '',
    'Confirm you can reach the API before writing code against it:',
    '',
    '```bash',
    `curl -s -H "Authorization: Bearer $ARGYS_API_TOKEN" ${API_BASE_URL}/v1/profiles`,
    '```',
  ].join('\n');
}
