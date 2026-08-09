// SCRATCH — not part of the app. Aliased over src/workspace/WorkspaceProvider
// by vite.preview.config.ts so preview-automations.tsx can mount the real
// AutomationsTab without a Supabase session. Delete with the other preview-*
// files.
import {createContext, useContext, useState} from 'react';
import type {ReactNode} from 'react';
import {defaultCloudState} from './src/data/statuses';
import type {
  ArgusAutomation, ArgusNotification, ArgusProfile, CloudState, OrgMember,
} from './src/types';

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const MEMBERS: OrgMember[] = [
  {user_id: 'u', email: 'dpodretskiy@gmail.com', display_name: 'Roman',
    role: 'owner', avatar_url: null, created_at: iso(600000)} as OrgMember,
  {user_id: 'v', email: 'vlad@simnetiq.com', display_name: 'Vlad',
    role: 'member', avatar_url: null, created_at: iso(500000)} as OrgMember,
];

const PROFILES = [
  {id: 'p1', name: 'Renter DE-1', deleted_at: null, automation_id: 'a2',
    proxy_mode: 'direct',
    automation_vars: {a1: {city_name: 'Dortmund', number_of_rooms: '2'}}},
  {id: 'p2', name: 'Renter DE-2', deleted_at: null, automation_id: null,
    proxy_mode: 'direct',
    automation_vars: {a1: {city_name: 'Essen', number_of_rooms: '3'}}},
  // No values at all: the row that cannot run until its required city is
  // answered, which is what the Run dialog's block has to look like.
  {id: 'p3', name: 'Renter DE-3', deleted_at: null, automation_id: null,
    proxy_mode: 'direct'},
] as unknown as ArgusProfile[];

const AUTOMATIONS: ArgusAutomation[] = [
  {
    id: 'a1', name: 'FB group lead capture',
    description: 'Reads new posts in the target groups, extracts author and intent.',
    steps: [{id: 's1', type: 'goto', url: 'https://facebook.com'}] as ArgusAutomation['steps'],
    tags: ['facebook'], pinned: true,
    parameters: [
      {name: 'city_name', label: 'City', kind: 'text', required: true,
        hint: 'Which city to search.', placeholder: 'Dortmund'},
      {name: 'number_of_rooms', label: 'Rooms', kind: 'number', default: '2'},
      {name: 'listing_type', label: 'Listing', kind: 'select',
        options: ['Rent', 'Buy'], default: 'Rent'},
      {name: 'portal_token', label: 'Portal token', kind: 'secret'},
      {name: 'districts', label: 'Districts', kind: 'list',
        hint: 'One per line. A Loop step runs over them.'},
    ] as ArgusAutomation['parameters'],
    icon: 'brand:facebook', color: 'blue',
    last_run_at: iso(42), last_run_status: 'ok',
    created_by: 'u', created_via: 'user', created_at: iso(60 * 24 * 6),
    schedule: {enabled: true, kind: 'interval', everyMinutes: 30, profileIds: ['p1', 'p2']},
  },
  {
    id: 'a2', name: 'WhatsApp warm-up',
    description: 'Opens chats and scrolls, twice a day.',
    steps: [
      {id: 's1', type: 'goto', url: 'https://web.whatsapp.com'},
      {id: 's2', type: 'callAutomation', automationId: 'a1'},
    ] as ArgusAutomation['steps'],
    tags: ['whatsapp'],
    icon: 'brand:whatsapp', color: 'green',
    last_run_at: iso(60 * 26), last_run_status: 'failed',
    created_by: 'v', created_via: 'user', created_at: iso(60 * 24 * 3),
    schedule: {enabled: true, kind: 'daily', at: '09:00', profileIds: ['p1']},
  },
  {
    id: 'a3', name: 'Engage with commenters',
    description: 'Built by the agent during the lead-gen session.',
    steps: [{id: 's1', type: 'goto', url: 'https://facebook.com'}] as ArgusAutomation['steps'],
    icon: 'brand:instagram', color: 'violet',
    last_run_at: iso(60 * 5), last_run_status: 'partial',
    created_by: 'u', created_via: 'mcp', created_by_label: 'Claude',
    created_at: iso(0.05),
  },
  {
    id: 'a4', name: 'Proxy sanity sweep',
    description: '',
    steps: [{id: 's1', type: 'goto', url: 'https://example.com'}] as ArgusAutomation['steps'],
    created_by: 'v', created_via: 'user', created_at: iso(60 * 24 * 40),
  },
];

// The bell's two kinds. One handoff, and four notifications covering every
// state the card has: unread, read, each status tone, a title long enough to
// wrap and squeeze the clear button, and one with no automation_id -- the row
// that must NOT become a clickable card because it has nowhere to go.
const NOTIFICATIONS: (ArgusNotification & {read: boolean})[] = [
  {
    id: 'n1', kind: 'automation_run', title: 'FB group lead capture finished',
    body: '12 of 12 profiles done, 41 leads captured.', status: 'ok',
    automation_id: 'a1', run_id: 'r1', created_by: 'u', created_at: iso(4), read: false,
  },
  {
    id: 'n2', kind: 'automation_run',
    title: 'Engage with commenters on the Dortmund listings finished with warnings',
    body: '3 of 8 profiles could not reach the group.', status: 'partial',
    automation_id: 'a3', run_id: 'r2', created_by: 'v', created_at: iso(52), read: false,
  },
  {
    id: 'n3', kind: 'automation_run', title: 'WhatsApp warm-up failed',
    body: 'Step 2 timed out waiting for the chat list.', status: 'failed',
    automation_id: 'a2', run_id: 'r3', created_by: 'u', created_at: iso(60 * 27), read: true,
  },
  {
    id: 'n4', kind: 'automation_run', title: 'Proxy sanity sweep cancelled',
    body: 'Stopped by Vlad after 2 of 30 profiles.', status: 'cancelled',
    automation_id: null, run_id: 'r4', created_by: 'v', created_at: iso(60 * 30), read: true,
  },
];

const PENDING = [{
  id: 'h1', kind: 'profile' as const, item_name: 'Renter DE-1', to_user: 'u', from_user: 'v',
  note: 'Taking two weeks off -- this one is warmed up and needs its daily run.',
}];

type Ctx = {
  data: {
    state: CloudState;
    patch: {notifications: (fn: (list: CloudState['notifications']) =>
      CloudState['notifications']) => void};
  };
  shared: {
    pending: typeof PENDING;
    accept: (...args: unknown[]) => Promise<boolean>;
    decline: (...args: unknown[]) => Promise<void>;
  };
  reload: () => Promise<void>;
  // RefreshButton sits beside the bell in the inbox harness and reads this.
  refresh: () => Promise<void>;
  automations: {
    runs: Record<string, never>;
    setStarred: (id: string, starred: boolean) => void;
    setTelegramPref: () => void;
    linkTelegram: () => Promise<void>;
    unlinkTelegram: () => Promise<void>;
    testTelegram: () => Promise<string | null>;
    runMany: (...args: unknown[]) => Promise<void>;
  };
  // Enough of the two action bundles for RunAutomationModal, which reads
  // profiles.update (the "save these values" checkbox) and proxies.checkMany
  // (its opening sweep). Both are no-ops here -- this harness renders, it does
  // not run anything.
  profiles: {update: (...args: unknown[]) => Promise<boolean>};
  proxies: {checkMany: (...args: unknown[]) => Promise<void>};
  selectedProfileId: string | null;
  checkingProxyIds: Set<string>;
  toast: {setMessage: (text: string) => void; notify: (text: string) => void};
  tagOptions: never[];
};

const WorkspaceContext = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('preview workspace missing');
  }
  return value;
}

export function WorkspaceProvider({children}: {children: ReactNode}) {
  const [stars, setStars] = useState<string[]>(['a1']);
  // Stateful, unlike the rest of this fixture: the bell marks everything read
  // on open and clears a row on the X, and both are optimistic patches. Frozen
  // fixtures would make the panel look correct and behave like nothing.
  const [notifications, setNotifications] = useState(NOTIFICATIONS);
  const [pending, setPending] = useState(PENDING);
  const state: CloudState = {
    ...defaultCloudState,
    automations: AUTOMATIONS,
    profiles: PROFILES,
    members: MEMBERS,
    notifications,
    automation_stars: stars,
    telegram_link: {chat_id: '42', telegram_username: 'roman_p', linked_at: iso(60 * 24 * 2)},
  };
  const value: Ctx = {
    data: {state, patch: {notifications: (fn) => setNotifications(fn)}},
    shared: {
      pending,
      accept: async (id) => {
        setPending((list) => list.filter((item) => item.id !== id));
        return true;
      },
      decline: async (id) => setPending((list) => list.filter((item) => item.id !== id)),
    },
    reload: async () => {},
    refresh: async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    },
    automations: {
      runs: {},
      setStarred: (id, starred) => setStars((current) =>
        starred ? [...current, id] : current.filter((item) => item !== id)),
      setTelegramPref: () => {},
      linkTelegram: async () => {},
      unlinkTelegram: async () => {},
      testTelegram: async () => null,
      runMany: async () => {},
    },
    profiles: {update: async () => true},
    proxies: {checkMany: async () => {}},
    selectedProfileId: 'p1',
    checkingProxyIds: new Set<string>(),
    toast: {setMessage: () => {}, notify: () => {}},
    tagOptions: [],
  };
  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}
