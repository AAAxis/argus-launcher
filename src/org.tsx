// Org context: which tenant the signed-in user is currently looking at.
//
// Everything under src/db/ takes an orgId explicitly, and this is where that id
// comes from. It lives outside App so it can own the auth subscription -- the
// app previously sampled the session only at boot and on an explicit sign-in,
// which meant a token refresh or a sign-out in another window went unnoticed.
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
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
};

const EMPTY: OrgContextValue = {
  ready: false,
  userId: null,
  email: '',
  orgs: [],
  orgId: null,
  org: null,
  role: null,
  isAdmin: false,
  error: '',
  setOrgId: () => {},
  reload: async () => {},
};

const OrgContext = createContext<OrgContextValue>(EMPTY);

export function useOrg(): OrgContextValue {
  return useContext(OrgContext);
}

export function OrgProvider({children}: {children: ReactNode}) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
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
  // the `userId` state because getUser() and the INITIAL_SESSION event both
  // arrive at boot, and a state read would still be stale for the second one.
  const resolvedFor = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) {
      setReady(true);
      return;
    }
    let cancelled = false;
    const apply = (nextId: string | null, nextEmail: string) => {
      if (cancelled) {
        return;
      }
      setUserId(nextId);
      setEmail(nextEmail);
      // TOKEN_REFRESHED fires repeatedly with the same user; re-resolving on
      // each one would refetch the membership list for no reason.
      if (resolvedFor.current === nextId) {
        return;
      }
      resolvedFor.current = nextId;
      void resolve(nextId);
    };
    void supabase.auth.getUser().then(({data}) => {
      apply(data.user?.id || null, data.user?.email || '');
    });
    const {data: subscription} = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session?.user?.id || null, session?.user?.email || '');
    });
    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [resolve]);

  const setOrgId = useCallback((id: string) => {
    setOrgIdState(id);
    orgsDb.setCurrentOrgId(id);
  }, []);

  const reload = useCallback(async () => {
    resolvedFor.current = userId;
    await resolve(userId);
  }, [resolve, userId]);

  const value = useMemo<OrgContextValue>(() => {
    const membership = orgs.find((item) => item.org.id === orgId) || null;
    return {
      ready,
      userId,
      email,
      orgs,
      orgId,
      org: membership?.org || null,
      role: membership?.role || null,
      isAdmin: membership?.role === 'owner' || membership?.role === 'admin',
      error,
      setOrgId,
      reload,
    };
  }, [ready, userId, email, orgs, orgId, error, setOrgId, reload]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
