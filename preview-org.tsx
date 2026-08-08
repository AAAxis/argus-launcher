// SCRATCH — not part of the app. Aliased over src/org.tsx by
// vite.preview.config.ts so preview-sidebar.tsx can mount the real Sidebar and
// WorkspaceSwitcher without a Supabase session. Delete with the other
// preview-* files.
import type {ReactNode} from 'react';

// A transparent PNG with black artwork -- the exact case that showed a black
// plate in the popover. 24x24, a filled ring.
const LOGO = 'data:image/svg+xml;base64,' + btoa(
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
       <circle cx="24" cy="24" r="18" fill="none" stroke="#111" stroke-width="7"/>
       <circle cx="24" cy="24" r="5" fill="#111"/>
     </svg>`);

const ACME = {id: 'a', name: 'Acme Traffic', plan: 'team', logo_url: LOGO};
const SIMNETIQ = {id: 'b', name: 'Simnetiq LTD', plan: 'base', logo_url: null};

export function useOrg() {
  return {
    ready: true,
    userId: 'u',
    email: 'dpodretskiy@gmail.com',
    avatarUrl: '',
    hasCustomAvatar: false,
    displayName: 'Roman',
    providers: ['email'],
    createdAt: null,
    tableColumns: {},
    orgs: [{org: ACME, role: 'owner'}, {org: SIMNETIQ, role: 'member'}],
    orgId: 'a',
    org: ACME,
    role: 'owner',
    ownsAny: true,
    personalPromptAt: null,
    promptSupported: true,
    isOwner: true,
    error: '',
    setOrgId: () => {},
    reload: async () => {},
    refreshUser: async () => {},
  };
}

export function OrgProvider({children}: {children: ReactNode}) {
  return <>{children}</>;
}
