// Which dialog is open and what it is editing. Every editor's *state* lives
// here because more than one thing can open the same dialog -- the proxy editor
// is reachable from the Proxies tab and from inside the profile editor, and the
// delete confirmations are reachable from a table row, a bulk selection and an
// editor's Delete button. The dialogs themselves own their behaviour.
import {useState} from 'react';
import {
  draftFromBookmark, draftFromProfile, draftFromProxy, newBookmarkDraft, newProfileDraft,
  newProxyDraft,
} from '../drafts';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import type {
  BookmarkDraft, FolderDraft, ProfileDraft, ProxyDraft, StatusDraft,
} from '../drafts';
import type {ProfileDeleteRequest, ProxyDeleteRequest} from '../components/modals/ConfirmModals';
import type {ArgusCookie, ArgusProfile, ArgusProxy, SharedBookmark} from '../types';

export function useEditors() {
  const {data, profiles, setSelectedProfileId} = useWorkspace();

  const [profileDraft, setProfileDraft] = useState<ProfileDraft | null>(null);
  const [proxyDraft, setProxyDraft] = useState<ProxyDraft | null>(null);
  const [proxyDraftSource, setProxyDraftSource] = useState<'profile' | null>(null);
  const [bookmarkDraft, setBookmarkDraft] = useState<BookmarkDraft | null>(null);
  const [folderDraft, setFolderDraft] = useState<FolderDraft | null>(null);
  const [statusDraft, setStatusDraft] = useState<StatusDraft | null>(null);
  const [profileDeleteRequest, setProfileDeleteRequest] =
    useState<(ProfileDeleteRequest & {onDeleted?: () => void}) | null>(null);
  const [proxyDeleteRequest, setProxyDeleteRequest] =
    useState<(ProxyDeleteRequest & {onDeleted?: () => void}) | null>(null);
  const [cookiePickerOpen, setCookiePickerOpen] = useState(false);
  // The set whose cookies are being inspected, and the set being assigned to
  // profiles. Two separate pieces of state rather than one mode flag: the
  // inspector's own "Assign to profiles" button opens the second over the
  // first, and closing it has to leave the inspector standing.
  const [cookieSetOpen, setCookieSetOpen] = useState<ArgusCookie | null>(null);
  const [assignCookieSet, setAssignCookieSet] = useState<ArgusCookie | null>(null);
  const [extensionAddOpen, setExtensionAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [proxyImportOpen, setProxyImportOpen] = useState(false);
  const [bookmarkImportOpen, setBookmarkImportOpen] = useState(false);

  return {
    profileDraft,
    setProfileDraft,
    // Applies one field of the open profile draft, for the dialogs nested
    // inside it (cookie picker, proxy editor) that only touch a field or two.
    patchProfileDraft: (patch: Partial<ProfileDraft>) =>
      setProfileDraft((current) => current ? {...current, ...patch} : current),
    newProfile: () => setProfileDraft(newProfileDraft()),
    editProfile: (profile: ArgusProfile) => {
      setSelectedProfileId(profile.id);
      setProfileDraft(draftFromProfile(profile));
    },

    proxyDraft,
    proxyDraftSource,
    setProxyDraft,
    newProxy: () => {
      setProxyDraftSource(null);
      setProxyDraft(newProxyDraft());
    },
    editProxy: (proxy: ArgusProxy) => {
      setProxyDraftSource(null);
      setProxyDraft(draftFromProxy(proxy));
    },
    openProxyDraft: (draft: ProxyDraft, source: 'profile' | null) => {
      setProxyDraftSource(source);
      setProxyDraft(draft);
    },
    closeProxyDraft: () => {
      setProxyDraft(null);
      setProxyDraftSource(null);
    },

    bookmarkDraft,
    setBookmarkDraft,
    newBookmark: () => setBookmarkDraft(newBookmarkDraft()),
    editBookmark: (bookmark: SharedBookmark) => setBookmarkDraft(draftFromBookmark(bookmark)),

    folderDraft,
    setFolderDraft,
    statusDraft,
    setStatusDraft,

    profileDeleteRequest,
    setProfileDeleteRequest,
    // onDeleted fires only on a real delete, so cancelling leaves the caller
    // (a row selection, an open editor) exactly as it was.
    requestDeleteProfiles: (profileIds: string[], label: string, onDeleted?: () => void) =>
      setProfileDeleteRequest({
        profileIds,
        label,
        exclusiveProxyIds: profiles.exclusiveProxyIdsFor(profileIds),
        onDeleted,
      }),

    proxyDeleteRequest,
    setProxyDeleteRequest,
    requestDeleteProxies: (proxyIds: string[], label: string, onDeleted?: () => void) =>
      setProxyDeleteRequest({
        proxyIds,
        label,
        affectedProfiles: data.state.profiles.filter((profile) =>
          profile.proxy_id && proxyIds.includes(profile.proxy_id)).length,
        onDeleted,
      }),

    cookiePickerOpen,
    setCookiePickerOpen,
    cookieSetOpen,
    setCookieSetOpen,
    assignCookieSet,
    setAssignCookieSet,
    extensionAddOpen,
    setExtensionAddOpen,
    importOpen,
    setImportOpen,
    proxyImportOpen,
    setProxyImportOpen,
    bookmarkImportOpen,
    setBookmarkImportOpen,

    closeAll: () => {
      setProfileDraft(null);
      setProxyDraft(null);
      setProxyDraftSource(null);
      setBookmarkDraft(null);
      setFolderDraft(null);
      setStatusDraft(null);
      setProfileDeleteRequest(null);
      setProxyDeleteRequest(null);
      setCookiePickerOpen(false);
      setCookieSetOpen(null);
      setAssignCookieSet(null);
      setExtensionAddOpen(false);
      setImportOpen(false);
      setProxyImportOpen(false);
      setBookmarkImportOpen(false);
    },
  };
}
