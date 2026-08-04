// The org's data and everything that mutates it, in one place. Tabs and
// dialogs read from here instead of being handed two dozen props each, which
// is what let them be split out of the old single-component App at all.
import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {baseProfileStatuses} from '../data/statuses';
import {tagsInUse} from '../lib/tags';
import {statusList} from '../lib/text';
import {useToast} from '../hooks/useToast';
import {useOrg} from '../org';
import {useCloudData} from './useCloudData';
import {useCookieActions} from './useCookieActions';
import {useLibraryActions} from './useLibraryActions';
import {useProfileActions} from './useProfileActions';
import {useProxyActions} from './useProxyActions';
import type {Toast} from '../hooks/useToast';
import type {WorkspaceCore} from './core';
import type {TagUsage} from '../lib/tags';
import type {CloudData} from './useCloudData';
import type {CookieActions} from './useCookieActions';
import type {LibraryActions} from './useLibraryActions';
import type {ProfileActions} from './useProfileActions';
import type {ProxyActions} from './useProxyActions';

export type WorkspaceValue = {
  data: CloudData;
  toast: Toast;
  profiles: ProfileActions;
  proxies: ProxyActions;
  library: LibraryActions;
  cookies: CookieActions;
  // Which profile row is highlighted. Lives here rather than in the Profiles
  // tab because deletes and saves have to keep it pointing at something real.
  selectedProfileId: string | null;
  setSelectedProfileId: (id: string | null) => void;
  checkingProxyId: string;
  setCheckingProxyId: (id: string) => void;
  // Built-in statuses, the org's custom ones, and anything a profile is
  // already using -- so a status that only exists on an imported row still
  // shows up in the dropdowns instead of silently resetting to Ready.
  statusOptions: string[];
  // Every tag the org's profiles actually carry, most used first and the user's
  // own words ahead of the catalogued brands. The picker offers the user half,
  // the table's filter offers all of it -- neither needs to walk the profiles
  // again to find out what exists.
  tagOptions: TagUsage[];
  // The same thing for the cookie-set library, kept as a separate list rather
  // than merged into tagOptions: that one feeds the Profiles filter dropdown
  // and the folder suggestions, so a cookie-only tag in it would offer a filter
  // that empties the profiles table. The half worth sharing is shared anyway --
  // both go through tagKey() and the same brand catalog, so "Instagram" on a
  // set and "instagram" on a profile render identically.
  cookieTagOptions: TagUsage[];
  reload: () => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  }
  return value;
}

export function WorkspaceProvider({children}: {children: ReactNode}) {
  const org = useOrg();
  const orgId = org.orgId;
  const toast = useToast();
  const data = useCloudData(orgId, toast);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [checkingProxyId, setCheckingProxyId] = useState('');

  const core: WorkspaceCore = {
    data,
    toast,
    selectedProfileId,
    setSelectedProfileId,
    checkingProxyId,
    setCheckingProxyId,
  };
  const proxies = useProxyActions(core);
  const profiles = useProfileActions(core, proxies);
  const library = useLibraryActions(core);
  const cookies = useCookieActions(core);

  const {load, reset} = data;
  const {setMessage} = toast;

  useEffect(() => {
    if (org.error) {
      setMessage(org.error);
    }
  }, [org.error, setMessage]);

  // Reload whenever the active organization changes. Everything keyed by an id
  // has to be dropped first: a profile id from org A is also a real directory
  // under E:\ArgysProfiles, so a leaked selection would launch the wrong
  // firm's data.
  useEffect(() => {
    reset();
    setSelectedProfileId(null);
    if (!orgId) {
      return;
    }
    void load(orgId).then((loaded) => {
      if (loaded) {
        setSelectedProfileId(loaded.profiles.find((profile) => !profile.deleted_at)?.id || null);
      }
    });
  }, [orgId, load, reset]);

  // A second worker's changes only reach this machine when we ask for them.
  // Window focus is the cheapest honest trigger: it is exactly the moment the
  // user comes back to the launcher, and eight small selects are far less
  // traffic than a poll. Throttled so alt-tabbing does not hammer the API.
  const lastRefreshRef = useRef(0);
  useEffect(() => {
    if (!orgId) {
      return;
    }
    const refresh = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      const now = Date.now();
      if (now - lastRefreshRef.current < 10000) {
        return;
      }
      lastRefreshRef.current = now;
      void load(orgId, {quiet: true});
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [orgId, load]);

  const {custom_statuses: customStatuses, profiles: profileRows, cookies: cookieRows} = data.state;
  const statusOptions = useMemo(
      () => statusList(
          baseProfileStatuses,
          customStatuses,
          profileRows.map((profile) => profile.status)),
      [customStatuses, profileRows],
  );
  const tagOptions = useMemo(() => tagsInUse(profileRows), [profileRows]);
  const cookieTagOptions = useMemo(() => tagsInUse(cookieRows), [cookieRows]);

  // Deliberately not memoized: several of the action closures read the current
  // cloudState, so a stable identity would hand consumers stale data. The old
  // single-component App re-rendered everything on any state change anyway, so
  // this costs nothing it did not already cost.
  const value: WorkspaceValue = {
    data,
    toast,
    profiles,
    proxies,
    library,
    cookies,
    selectedProfileId,
    setSelectedProfileId,
    checkingProxyId,
    setCheckingProxyId,
    statusOptions,
    tagOptions,
    cookieTagOptions,
    reload: () => {
      if (orgId) {
        void load(orgId, {quiet: true});
      }
    },
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
