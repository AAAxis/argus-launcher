// SCRATCH — not part of the app. Aliased over src/workspace/WorkspaceProvider
// by vite.preview.config.ts so preview-automations.tsx can mount the real
// AutomationsTab without a Supabase session. Delete with the other preview-*
// files.
import {createContext, useContext, useState} from 'react';
import type {ReactNode} from 'react';
import {defaultCloudState} from './src/data/statuses';
import type {ArgusAutomation, ArgusProfile, CloudState, OrgMember} from './src/types';

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const MEMBERS: OrgMember[] = [
  {user_id: 'u', email: 'dpodretskiy@gmail.com', display_name: 'Roman',
    role: 'owner', avatar_url: null, created_at: iso(600000)} as OrgMember,
  {user_id: 'v', email: 'vlad@simnetiq.com', display_name: 'Vlad',
    role: 'member', avatar_url: null, created_at: iso(500000)} as OrgMember,
];

const PROFILES = [
  {id: 'p1', name: 'FB — Warm US 01', deleted_at: null, automation_id: 'a2'},
  {id: 'p2', name: 'FB — Warm US 02', deleted_at: null, automation_id: null},
] as unknown as ArgusProfile[];

const AUTOMATIONS: ArgusAutomation[] = [
  {
    id: 'a1', name: 'FB group lead capture',
    description: 'Reads new posts in the target groups, extracts author and intent.',
    steps: [{id: 's1', type: 'goto', url: 'https://facebook.com'}] as ArgusAutomation['steps'],
    tags: ['facebook'], pinned: true,
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

type Ctx = {
  data: {state: CloudState};
  automations: {
    runs: Record<string, never>;
    setStarred: (id: string, starred: boolean) => void;
    setTelegramPref: () => void;
    linkTelegram: () => Promise<void>;
    unlinkTelegram: () => Promise<void>;
    testTelegram: () => Promise<string | null>;
  };
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
  const state: CloudState = {
    ...defaultCloudState,
    automations: AUTOMATIONS,
    profiles: PROFILES,
    members: MEMBERS,
    automation_stars: stars,
    telegram_link: {chat_id: '42', telegram_username: 'roman_p', linked_at: iso(60 * 24 * 2)},
  };
  const value: Ctx = {
    data: {state},
    automations: {
      runs: {},
      setStarred: (id, starred) => setStars((current) =>
        starred ? [...current, id] : current.filter((item) => item !== id)),
      setTelegramPref: () => {},
      linkTelegram: async () => {},
      unlinkTelegram: async () => {},
      testTelegram: async () => null,
    },
    toast: {setMessage: () => {}, notify: () => {}},
    tagOptions: [],
  };
  return (
    <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
  );
}
