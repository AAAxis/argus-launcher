// Org context: which tenant the signed-in user is currently looking at.
//
// Everything under src/db/ takes an orgId explicitly, and this is where that id
// comes from. It lives outside App so it can own the auth subscription -- the
// app previously sampled the session only at boot and on an explicit sign-in,
// which meant a token refresh or a sign-out in another window went unnoticed.
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import type {User} from '@supabase/supabase-js';
import {
  accountAvatarUrl,
  accountDisplayName,
  accountHasCustomAvatar,
  accountProviders,
} from './db/account';
import * as orgsDb from './db/orgs';
import {describeDbError} from './db/errors';
import {supabase} from './supabase';
import type {ArgusOrg, OrgMembership, OrgRole} from './types';

export type OrgContextValue = {
  // False while the user's memberships are still being resolved. App waits on
  // this before loading anything, so it never issues a query with a null org.
  ready: boolean;
  userId: string | null;
  email: string;
  // Profile picture: the one uploaded in Settings if there is one, otherwise
  // whatever the identity provider supplied. Google sign-in populates the
  // latter; email/OTP sign-ins have neither, and the account row falls back to
  // the initials circle. See db/account.ts for the precedence and why.
  avatarUrl: string;
  // True when that picture was uploaded here rather than taken from Google --
  // the only case where Settings can offer to remove it.
  hasCustomAvatar: boolean;
  // Chosen in Settings, falling back to the provider's name. Empty for an
  // email-code account that has never set one -- callers show the address.
  displayName: string;
  // Auth provider ids ('email', 'google'), for "Signed in with".
  providers: string[];
  // ISO timestamp of when the account was created, for "Member since".
  createdAt: string | null;
  orgs: OrgMembership[];
  orgId: string | null;
  org: ArgusOrg | null;
  role: OrgRole | null;
  // Org-wide settings (the name, the built-in extension toggles) are writable
  // only by owners and admins -- the RLS UPDATE policy on organizations checks
  // is_org_admin, so a member's write would fail silently at the UI layer.
  isAdmin: boolean;
  error: string;
  setOrgId: (id: string) => void;
  reload: () => Promise<void>;
  // Re-reads the user record. Settings calls this after an avatar or name edit
  // so the sidebar and the dialog update without waiting for the next auth
  // event -- updateUser() does not emit one.
  refreshUser: (next?: User | null) => Promise<void>;
};

const EMPTY: OrgContextValue = {
  ready: false,
  userId: null,
  email: '',
  avatarUrl: '',
  hasCustomAvatar: false,
  displayName: '',
  providers: [],
  createdAt: null,
  orgs: [],
  orgId: null,
  org: null,
  role: null,
  isAdmin: false,
  error: '',
  setOrgId: () => {},
  reload: async () => {},
  refreshUser: async () => {},
};

const OrgContext = createContext<OrgContextValue>(EMPTY);

export function useOrg(): OrgContextValue {
  return useContext(OrgContext);
}

export function OrgProvider({children}: {children: ReactNode}) {
  const [ready, setReady] = useState(false);
  // The whole user record rather than the two fields the header needs: Settings
  // reads the creation date, the linked identities and the metadata off it, and
  // keeping one object means an avatar edit updates every consumer at once.
  const [user, setUser] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Guards against a second resolve landing out of order after a fast
  // sign-out/sign-in, which would show the previous user's orgs.
  const generation = useRef(0);

  const resolve = useCallback(async (uid: string | null) => {
    const run = ++generation.current;
    if (!uid) {
      setOrgs([]);
      setOrgIdState(null);
      setError('');
      setReady(true);
      return;
    }
    setReady(false);
    try {
      let memberships = await orgsDb.listMyOrgs();
      if (memberships.length === 0) {
        // No org yet: bootstrap_org is SECURITY DEFINER and idempotent, and is
        // the only path a client has -- organizations has no INSERT policy.
        await orgsDb.createOrg();
        memberships = await orgsDb.listMyOrgs();
      }
      if (run !== generation.current) {
        return;
      }
      const stored = orgsDb.currentOrgId();
      const active = memberships.find((item) => item.org.id === stored)?.org.id ||
        memberships[0]?.org.id || null;
      setOrgs(memberships);
      setOrgIdState(active);
      orgsDb.setCurrentOrgId(active);
      setError('');
    } catch (caught) {
      if (run !== generation.current) {
        return;
      }
      setOrgs([]);
      setOrgIdState(null);
      setError(describeDbError(caught, 'Could not load your organization.'));
    } finally {
      if (run === generation.current) {
        setReady(true);
      }
    }
  }, []);

  // The user we last resolved for. Held in a ref rather than compared against
  // the `user` state because getUser() and the INITIAL_SESSION event both
  // arrive at boot, and a state read would still be stale for the second one.
  const resolvedFor = useRef<string | null | undefined>(undefined);

  const applyUser = useCallback((next: User | null) => {
    setUser(next);
    const nextId = next?.id || null;
    // TOKEN_REFRESHED fires repeatedly with the same user; re-resolving on each
    // one would refetch the membership list for no reason.
    if (resolvedFor.current === nextId) {
      return;
    }
    resolvedFor.current = nextId;
    void resolve(nextId);
  }, [resolve]);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const apply = (next: User | null) => {
      if (!cancelled) {
        applyUser(next);
      }
    };
    void supabase.auth.getUser().then(({data}) => apply(data.user || null));
    const {data: subscription} = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user || null);
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [applyUser]);

  const setOrgId = useCallback((id: string) => {
    setOrgIdState(id);
    orgsDb.setCurrentOrgId(id);
  }, []);

  const reload = useCallback(async () => {
    const uid = user?.id || null;
    resolvedFor.current = uid;
    await resolve(uid);
  }, [resolve, user]);

  // updateUser() returns the new record and emits no auth event, so Settings
  // hands it straight back here rather than paying for a second round trip.
  // Called with nothing, this re-reads the user from the server.
  const refreshUser = useCallback(async (next?: User | null) => {
    if (next !== undefined) {
      applyUser(next);
      return;
    }
    if (!supabase) {
      return;
    }
    const {data} = await supabase.auth.getUser();
    applyUser(data.user || null);
  }, [applyUser]);

  const value = useMemo<OrgContextValue>(() => {
    const membership = orgs.find((item) => item.org.id === orgId) || null;
    return {
      ready,
      userId: user?.id || null,
      email: user?.email || '',
      avatarUrl: accountAvatarUrl(user),
      hasCustomAvatar: accountHasCustomAvatar(user),
      displayName: accountDisplayName(user),
      providers: accountProviders(user),
      createdAt: user?.created_at || null,
      orgs,
      orgId,
      org: membership?.org || null,
      role: membership?.role || null,
      isAdmin: membership?.role === 'owner' || membership?.role === 'admin',
      error,
      setOrgId,
      reload,
      refreshUser,
    };
  }, [ready, user, orgs, orgId, error, setOrgId, reload, refreshUser]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
