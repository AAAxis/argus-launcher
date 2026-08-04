// The tool surface an agent actually sees.
//
// Two rules shaped this list:
//
// 1. Every tool takes `profileId` and nothing session-shaped. No cdpUrl, no
//    handle, no cursor. The server resolves the debugging port on each call
//    through /v1/profiles/cdp, so a restarted launcher, a restarted agent and a
//    restarted MCP process are all non-events.
// 2. Only what an agent has a real reason to do. Every tool listed here costs
//    context in *every* session for these users, so the destructive and
//    bulk-import routes (profiles/delete, update-fingerprint, proxies/create,
//    cookies/*, monitoring/report) are deliberately not exposed. They can be
//    added behind an explicit opt-in if anyone asks.

const cdp = require('./cdp.cjs');

const DEFAULT_READ_CHARS = 20000;

// Resolving the port is its own step so every CDP tool fails the same way when
// the profile simply is not open -- which is by far the most common mistake.
async function requireCdpUrl(api, profileId) {
  const session = await api.post('/v1/profiles/cdp', {profileId});
  if (!session.running || !session.cdpUrl) {
    throw new Error(
        `Profile ${profileId} is not open. Call argus_launch_profile first.`);
  }
  return session.cdpUrl;
}

function text(value) {
  return {
    content: [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

const TOOLS = [
  {
    name: 'argus_list_profiles',
    description:
      'List the Argus browser profiles this key can see. Each profile is an ' +
      'isolated browser identity with its own proxy, fingerprint and cookies.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {type: 'string', description: 'Only profiles in this folder id.'},
      },
    },
    run: async ({api, args}) => text(await api.get(
        args.folder ? `/v1/profiles?folder=${encodeURIComponent(args.folder)}` : '/v1/profiles')),
  },
  {
    name: 'argus_get_profile',
    description: 'Read one profile: its proxy, status, tags, folder and fingerprint.',
    inputSchema: {
      type: 'object',
      properties: {profileId: {type: 'string'}},
      required: ['profileId'],
    },
    run: async ({api, args}) => text(await api.post('/v1/profiles/get', {profileId: args.profileId})),
  },
  {
    name: 'argus_profile_session',
    description:
      'Check whether a profile is currently open for automation, and where its ' +
      'debugging endpoint is. Call this before launching to avoid disturbing a ' +
      'session that is already running.',
    inputSchema: {
      type: 'object',
      properties: {profileId: {type: 'string'}},
      required: ['profileId'],
    },
    run: async ({api, args}) => text(await api.post('/v1/profiles/cdp', {profileId: args.profileId})),
  },
  {
    name: 'argus_launch_profile',
    // Two earlier sentences here were simply untrue, and a false statement in a
    // tool description is worse than no statement: the model plans around it.
    // "The browser session is anonymous" is wrong whenever the profile has a
    // cookie set assigned, which is a normal setup. And a claim that a proxy is
    // always required is wrong too -- proxy_mode is 'assigned' | 'direct' |
    // 'free_proxy', and only the first requires one.
    description:
      'Open a profile in the Argus browser, ready for automation. If it is ' +
      'already open this returns the existing session rather than restarting ' +
      'it; pass relaunch=true to force a fresh window (which closes the current ' +
      'one). A profile set to use an assigned proxy needs that proxy to be ' +
      'working before it will launch. The session carries whatever identity the ' +
      'profile already holds, including its cookies — do not send it anything ' +
      'the profile is not meant to have.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: {type: 'string'},
        relaunch: {
          type: 'boolean',
          description: 'Close any existing session and start a new one.',
        },
      },
      required: ['profileId'],
    },
    run: async ({api, args}) => text(await api.post('/v1/profiles/launch-automation', {
      profileId: args.profileId,
      relaunch: Boolean(args.relaunch),
    })),
  },
  {
    name: 'argus_close_profile',
    description: 'Close a profile session this key opened.',
    inputSchema: {
      type: 'object',
      properties: {profileId: {type: 'string'}},
      required: ['profileId'],
    },
    run: async ({api, args}) => text(await api.post('/v1/profiles/close-automation', {
      profileId: args.profileId,
    })),
  },
  {
    name: 'argus_update_profile',
    // `notes` used to be advertised here and silently did nothing -- the route's
    // field whitelist has no such column, so an agent could report success on a
    // write that never happened.
    description: 'Change a profile\'s name, status, tags, colour or folder.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: {type: 'string'},
        name: {type: 'string'},
        status: {type: 'string'},
        tags: {type: 'array', items: {type: 'string'},
          description: 'At most 5; extras are dropped.'},
        color: {type: 'string'},
        folderId: {type: 'string'},
      },
      required: ['profileId'],
    },
    // Forwards only the declared fields. This used to pass `args` straight
    // through, and the route also accepts `email` and `password` -- so an agent
    // that guessed those names could rewrite a profile's stored credentials
    // through a tool whose schema never mentions them. Anything undeclared is
    // dropped here rather than relied on being rejected downstream.
    run: async ({api, args}) => {
      const patch = {profileId: args.profileId};
      for (const field of ['name', 'status', 'tags', 'color', 'folderId']) {
        if (args[field] !== undefined) {
          patch[field] = args[field];
        }
      }
      return text(await api.post('/v1/profiles/update', patch));
    },
  },
  {
    name: 'argus_list_proxies',
    description: 'List the proxies in this account\'s library.',
    inputSchema: {type: 'object', properties: {}},
    run: async ({api}) => text(await api.get('/v1/proxies')),
  },
  {
    name: 'argus_assign_proxy',
    description:
      'Put a profile on a proxy from the library. A profile whose proxy mode is ' +
      '"assigned" needs a working proxy before it will launch.',
    inputSchema: {
      type: 'object',
      properties: {profileId: {type: 'string'}, proxyId: {type: 'string'}},
      required: ['profileId', 'proxyId'],
    },
    run: async ({api, args}) => text(await api.post('/v1/profiles/assign-proxy', {
      profileId: args.profileId,
      proxyId: args.proxyId,
    })),
  },
  {
    name: 'argus_check_proxy',
    description: 'Check a proxy\'s reachability and egress IP.',
    inputSchema: {
      type: 'object',
      properties: {
        host: {type: 'string'},
        port: {type: 'number'},
        username: {type: 'string'},
        password: {type: 'string'},
        type: {type: 'string', description: 'http or socks5. Defaults to http.'},
      },
      required: ['host', 'port'],
    },
    // Declared fields only, for the same reason as argus_update_profile.
    run: async ({api, args}) => text(await api.post('/v1/proxies/check', {
      host: args.host,
      port: args.port,
      type: args.type,
      username: args.username,
      password: args.password,
    })),
  },
  {
    name: 'argus_list_tabs',
    description: 'List the open pages in a running profile.',
    inputSchema: {
      type: 'object',
      properties: {profileId: {type: 'string'}},
      required: ['profileId'],
    },
    run: async ({api, args}) => text(await cdp.tabs(await requireCdpUrl(api, args.profileId))),
  },
  {
    name: 'argus_navigate',
    description: 'Point a running profile\'s active page at a URL and wait for it to settle.',
    inputSchema: {
      type: 'object',
      properties: {profileId: {type: 'string'}, url: {type: 'string'}},
      required: ['profileId', 'url'],
    },
    run: async ({api, args}) => text(
        await cdp.navigate(await requireCdpUrl(api, args.profileId), args.url)),
  },
  {
    name: 'argus_read_page',
    description:
      'Read the visible text of a running profile\'s active page, with its title ' +
      'and URL. Use a CSS selector to read one region instead of the whole page.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: {type: 'string'},
        selector: {type: 'string', description: 'CSS selector; defaults to the whole body.'},
        maxChars: {type: 'number', description: `Defaults to ${DEFAULT_READ_CHARS}.`},
      },
      required: ['profileId'],
    },
    run: async ({api, args}) => text(await cdp.readPage(
        await requireCdpUrl(api, args.profileId),
        args.selector || null,
        Number(args.maxChars) > 0 ? Math.floor(args.maxChars) : DEFAULT_READ_CHARS)),
  },
  {
    name: 'argus_screenshot',
    description:
      'Screenshot a running profile\'s active page. Returns JPEG by default; ' +
      'pass png=true for a lossless capture.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: {type: 'string'},
        fullPage: {type: 'boolean'},
        png: {type: 'boolean'},
      },
      required: ['profileId'],
    },
    run: async ({api, args}) => {
      const shot = await cdp.screenshot(await requireCdpUrl(api, args.profileId), {
        fullPage: Boolean(args.fullPage),
        png: Boolean(args.png),
      });
      // The caption is not decoration: some clients drop image content
      // entirely, and a bare image with no text is useless in a transcript.
      return {
        content: [
          {type: 'text', text: `${shot.url || 'about:blank'} — ${shot.title || 'untitled'}`},
          {type: 'image', data: shot.data, mimeType: shot.mimeType},
        ],
      };
    },
  },
  {
    name: 'argus_eval',
    description:
      'Evaluate a JavaScript expression in a running profile\'s active page and ' +
      'return its value. Awaits promises.',
    inputSchema: {
      type: 'object',
      properties: {profileId: {type: 'string'}, expression: {type: 'string'}},
      required: ['profileId', 'expression'],
    },
    run: async ({api, args}) => text(
        await cdp.evaluate(await requireCdpUrl(api, args.profileId), args.expression)),
  },
];

const BY_NAME = new Map(TOOLS.map((tool) => [tool.name, tool]));

// What the client sees in tools/list -- `run` is ours and must not leak into
// the wire format.
function listed() {
  return TOOLS.map(({name, description, inputSchema}) => ({name, description, inputSchema}));
}

module.exports = {BY_NAME, TOOLS, listed};
