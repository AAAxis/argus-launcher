// The app shell: which tab is showing, which dialog is open, and the startup
// gate in front of both. Everything with real logic behind it lives in
// workspace/ (data and mutations), hooks/ (effects) or components/.
import {useEffect, useState} from 'react';
import type {ArgusAutomation} from './types';
import {BookOpen, Plus, Upload, UserPlus} from 'lucide-react';
import {SignIn} from './components/SignIn';
import {Sidebar, Topbar, UpdateToast} from './components/Shell';
import {ApiTab} from './components/tabs/ApiTab';
import {ProfilesTab} from './components/tabs/ProfilesTab';
import {ProxiesTab} from './components/tabs/ProxiesTab';
import {CookiesTab} from './components/tabs/CookiesTab';
import {StartPageTab} from './components/tabs/StartPageTab';
import {AutomationsTab} from './components/tabs/AutomationsTab';
import {ExtensionsTab} from './components/tabs/ExtensionsTab';
import {IntegrationsTab} from './components/tabs/IntegrationsTab';
import {AssignCookieSetModal} from './components/modals/AssignCookieSetModal';
import {AutomationModal} from './components/modals/AutomationModal';
import {RunLogModal} from './components/modals/RunLogModal';
import {CookieSetModal} from './components/modals/CookieSetModal';
import {ProfileDeleteModal, ProxyDeleteModal, ErrorModal} from './components/modals/ConfirmModals';
import {BookmarkModal, FolderModal, ProxyModal, StatusModal} from './components/modals/EditorModals';
import {IntegrationModal} from './components/modals/IntegrationModal';
import {
  BookmarkImportModal, CookiePickerModal, ExtensionAddModal, ImportModal, ProxyImportModal,
} from './components/modals/LibraryModals';
import {IntroModal} from './components/modals/IntroModal';
import {ProfileModal} from './components/modals/ProfileModal';
import {
  ChangelogModal, OAuthApprovalModal, RevealedKeyModal, UpdateControl,
} from './components/modals/SettingsModal';
import {SettingsDialog} from './settings/SettingsDialog';
import {BusyButton} from './components/ui/BusyButton';
import {LoadingState} from './components/ui/LoadingState';
import {COOKIE_INTRO_STEPS} from './data/cookieIntro';
import {PROFILE_INTRO_STEPS} from './data/profileIntro';
import {DEFAULT_FOLDER_ICON} from './data/folderIcons';
import {DEFAULT_PROFILE_COLOR, normalizeProfileColor} from './lib/profileColors';
import {findIntegration} from './data/integrations';
import {SITE_URL} from './lib/auth';
import {hasSeenProfileIntro, markProfileIntroSeen} from './lib/introSeen';
import {TRASH_FOLDER_ID} from './lib/trash';
import {useApiKeys, useIntegrations} from './hooks/useApiKeys';
import {useAutomationBridge} from './hooks/useAutomationBridge';
import {
  useBackgroundProxyChecks, useFaviconWarmer, useOAuthApproval,
} from './hooks/useBackgroundWork';
import {useEditors} from './hooks/useEditors';
import {useResourceStatus, useUpdater} from './hooks/useNativeState';
import {useSignIn} from './hooks/useSignIn';
import {native} from './native';
import {useOrg} from './org';
import {supabase} from './supabase';
import {useAsyncAction} from './useAsyncAction';
import {useWorkspace} from './workspace/WorkspaceProvider';
import type {TabId} from './data/tabs';

export function App() {
  const org = useOrg();
  const workspace = useWorkspace();
  const {data, toast} = workspace;

  const signIn = useSignIn();
  const {resourceState, apiState, retryBrowserDownload} = useResourceStatus(toast);
  const updater = useUpdater(toast);
  const apiKeys = useApiKeys(org.userId, org.orgId);
  const integrations = useIntegrations(apiKeys, apiState);
  const editors = useEditors();
  const oauth = useOAuthApproval(apiKeys.refresh);
  const {run, isPending} = useAsyncAction();

  const [activeTab, setActiveTab] = useState<TabId>('profiles');
  // Which folder each tab is filtered to. Held here rather than in the tabs
  // because creating a folder from the dialog switches the view to it.
  const [profileFolderId, setProfileFolderId] = useState('');
  const [proxyFolderId, setProxyFolderId] = useState('');
  const [cookieFolderId, setCookieFolderId] = useState('');
  // What a just-created folder was suggested from -- a tag for a profile
  // folder, an ISO country code for a proxy one. Held for exactly one hand-off:
  // the tab opens its move dialog on it, then clears it.
  const [folderFillTag, setFolderFillTag] = useState('');
  const [folderFillCountry, setFolderFillCountry] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  // Unlike the profiles one this is never shown unprompted -- there is no
  // "seen" flag for it, only the About button on the Cookies tab.
  const [cookieIntroOpen, setCookieIntroOpen] = useState(false);
  // The automation being edited, and whether it already exists -- create and
  // replace are separate writes on purpose (see src/db/automations.ts), so the
  // dialog has to carry which one this is rather than infer it.
  const [automationDraft, setAutomationDraft] =
    useState<{automation: ArgusAutomation; exists: boolean} | null>(null);
  const [historyFor, setHistoryFor] = useState<ArgusAutomation | null>(null);
  const [revealedKey, setRevealedKey] = useState<{name: string; token: string} | null>(null);

  useAutomationBridge(workspace);
  useFaviconWarmer(workspace);
  useBackgroundProxyChecks(workspace, Boolean(org.email));

  // Billing lives on the web dashboard. Anything opened here goes to the real
  // browser via the main process, which allowlists the host.
  const openAccountPage = (pathname: string) => void native?.openExternal?.(`${SITE_URL}${pathname}`);

  async function signOut() {
    await supabase?.auth.signOut();
    setSettingsOpen(false);
    editors.closeAll();
    // Keys and integration status belong to the outgoing user. The workspace
    // clears its own data when orgId drops.
    apiKeys.setKeys([]);
    integrations.reset();
    signIn.reset();
  }

  const startup = describeStartup(org.ready, resourceState, apiState);

  // The walkthrough opens itself once, for someone who has nothing to look at
  // yet. Three things all have to be true, and each of them has bitten:
  //   - signed in, and past the startup gate, or it would open behind a screen
  //     that is returned before it renders -- and mark itself seen from there,
  //     so it would never be shown at all;
  //   - the cloud load finished, because `profiles` is an empty array while the
  //     first fetch is in flight, which is not an empty workspace;
  //   - not seen on this machine before.
  // It sits below describeStartup because it reads it, and above the early
  // returns because a hook cannot be called conditionally.
  const introReady = Boolean(org.email) && !startup.blocked && !data.loading &&
    data.state.profiles.length === 0;
  useEffect(() => {
    if (introReady && !hasSeenProfileIntro()) {
      markProfileIntroSeen();
      setIntroOpen(true);
    }
  }, [introReady]);

  if (startup.blocked) {
    return (
      <main className="login-shell">
        <LoadingState
          label={startup.failed ? 'Argus Launcher is not ready' : 'Preparing Argus Launcher'}
          detail={startup.detail}
          failed={startup.failed}
          onRetry={startup.canRetryBrowser ? retryBrowserDownload : undefined}
        />
      </main>
    );
  }

  if (!org.email) {
    return <SignIn state={signIn} />;
  }

  const openIntegration = findIntegration(integrations.openId);

  return (
    <main className="app-shell">
      <Sidebar activeTab={activeTab} onTab={setActiveTab} onSettings={() => setSettingsOpen(true)} />

      <section className="content">
        <Topbar activeTab={activeTab} actions={renderTopActions()} />
        {data.loading ? (
          <LoadingState
            label="Loading cloud data"
            detail="Profiles, proxies, bookmarks, and extensions are syncing."
          />
        ) : renderTab()}
      </section>

      <div className="toast-stack">
        {toast.message && <div className="status-toast" role="status">{toast.message}</div>}
        <UpdateToast
          state={updater.updateState}
          dismissedVersion={updater.dismissedVersion}
          onDismiss={updater.setDismissedVersion}
        />
      </div>

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onDownloadBrowser={retryBrowserDownload}
          onOpenChangelog={() => setChangelogOpen(true)}
          onOpenIntro={() => {
            setSettingsOpen(false);
            setIntroOpen(true);
          }}
          onOpenSite={openAccountPage}
          onSignOut={() => void signOut()}
          resourceState={resourceState}
          updateControl={<UpdateControl updater={updater} />}
        />
      )}
      {changelogOpen && <ChangelogModal updater={updater} onClose={() => setChangelogOpen(false)} />}
      {introOpen && (
        <IntroModal
          steps={PROFILE_INTRO_STEPS}
          onClose={() => setIntroOpen(false)}
          finishLabel="Create a profile"
          onFinish={() => {
            setIntroOpen(false);
            editors.newProfile();
          }}
        />
      )}
      {cookieIntroOpen && (
        <IntroModal
          steps={COOKIE_INTRO_STEPS}
          onClose={() => setCookieIntroOpen(false)}
          finishLabel="Add a cookie-set"
          onFinish={() => {
            setCookieIntroOpen(false);
            void run('add-cookie-set', addCookieSetFromPicker);
          }}
        />
      )}
      {editors.extensionAddOpen && (
        <ExtensionAddModal onClose={() => editors.setExtensionAddOpen(false)} />
      )}
      {editors.importOpen && <ImportModal onClose={() => editors.setImportOpen(false)} />}
      {editors.proxyImportOpen && (
        <ProxyImportModal onClose={() => editors.setProxyImportOpen(false)} />
      )}
      {editors.bookmarkImportOpen && (
        <BookmarkImportModal onClose={() => editors.setBookmarkImportOpen(false)} />
      )}
      {oauth.request && (
        <OAuthApprovalModal
          request={oauth.request}
          folder={oauth.folder}
          onFolder={oauth.setFolder}
          onRespond={(approved) => void oauth.respond(approved)}
        />
      )}
      {revealedKey && (
        <RevealedKeyModal
          name={revealedKey.name}
          token={revealedKey.token}
          onClose={() => setRevealedKey(null)}
        />
      )}
      {openIntegration && (
        <IntegrationModal
          integration={openIntegration}
          integrations={integrations}
          apiKeys={apiKeys}
          apiState={apiState}
        />
      )}

      {editors.profileDraft && (
        <ProfileModal
          draft={editors.profileDraft}
          onChange={editors.setProfileDraft}
          onClose={() => editors.setProfileDraft(null)}
          onNewStatus={() => editors.setStatusDraft({name: ''})}
          onPickCookies={() => editors.setCookiePickerOpen(true)}
          onCreateProxy={(seed) => editors.openProxyDraft(seed, 'profile')}
          onRequestDelete={editors.requestDeleteProfiles}
        />
      )}
      {editors.cookiePickerOpen && editors.profileDraft && (
        <CookiePickerModal
          search={editors.profileDraft.cookie_search}
          onSearch={(value) => editors.patchProfileDraft({cookie_search: value})}
          selectedId={editors.profileDraft.cookie_id}
          onSelect={(cookie) => editors.patchProfileDraft({
            cookie_mode: 'saved',
            cookie_id: cookie.id,
            cookie_search: '',
          })}
          onClose={() => editors.setCookiePickerOpen(false)}
        />
      )}
      {editors.proxyDraft && (
        <ProxyModal
          draft={editors.proxyDraft}
          source={editors.proxyDraftSource}
          onChange={editors.setProxyDraft}
          onClose={editors.closeProxyDraft}
          onSaved={(proxyId, fromProfile) => {
            if (fromProfile) {
              editors.patchProfileDraft({proxy_id: proxyId, proxy_link: '', proxy_search: ''});
            }
            editors.closeProxyDraft();
          }}
          onRequestDelete={editors.requestDeleteProxies}
        />
      )}
      {editors.bookmarkDraft && (
        <BookmarkModal
          draft={editors.bookmarkDraft}
          onChange={editors.setBookmarkDraft}
          onClose={() => editors.setBookmarkDraft(null)}
        />
      )}
      {editors.folderDraft && (
        <FolderModal
          draft={editors.folderDraft}
          onChange={editors.setFolderDraft}
          onClose={() => editors.setFolderDraft(null)}
          onCreated={(folderId, seed) => {
            // `seed` is a tag or a country code depending on which library the
            // draft belongs to, so the kind decides where both values land.
            if (editors.folderDraft?.kind === 'proxy') {
              setProxyFolderId(folderId);
              setFolderFillCountry(seed || '');
              return;
            }
            // Cookie folders are never suggested from anything, so there is no
            // seed to hand on -- just select the new folder.
            if (editors.folderDraft?.kind === 'cookie') {
              setCookieFolderId(folderId);
              return;
            }
            setProfileFolderId(folderId);
            setFolderFillTag(seed || '');
          }}
        />
      )}
      {automationDraft && (
        <AutomationModal
          automation={automationDraft.automation}
          exists={automationDraft.exists}
          onClose={() => setAutomationDraft(null)}
          onSave={(next) => workspace.automations.save(next, automationDraft.exists)}
        />
      )}
      {historyFor && (
        <RunLogModal automation={historyFor} onClose={() => setHistoryFor(null)} />
      )}
      {editors.cookieSetOpen && (
        <CookieSetModal
          cookie={editors.cookieSetOpen}
          onClose={() => editors.setCookieSetOpen(null)}
          onAssign={editors.setAssignCookieSet}
        />
      )}
      {editors.assignCookieSet && (
        <AssignCookieSetModal
          cookie={editors.assignCookieSet}
          onClose={() => editors.setAssignCookieSet(null)}
        />
      )}
      {editors.statusDraft && (
        <StatusModal
          draft={editors.statusDraft}
          onChange={editors.setStatusDraft}
          onClose={() => editors.setStatusDraft(null)}
        />
      )}
      {editors.profileDeleteRequest && (
        <ProfileDeleteModal
          request={editors.profileDeleteRequest}
          onClose={() => editors.setProfileDeleteRequest(null)}
          onDeleted={() => {
            editors.profileDeleteRequest?.onDeleted?.();
            editors.setProfileDeleteRequest(null);
            editors.setProfileDraft(null);
          }}
        />
      )}
      {editors.proxyDeleteRequest && (
        <ProxyDeleteModal
          request={editors.proxyDeleteRequest}
          onClose={() => editors.setProxyDeleteRequest(null)}
          onDeleted={() => {
            editors.proxyDeleteRequest?.onDeleted?.();
            editors.setProxyDeleteRequest(null);
            editors.closeProxyDraft();
          }}
        />
      )}
      {toast.errorDialog && (
        <ErrorModal dialog={toast.errorDialog} onClose={() => toast.setErrorDialog(null)} />
      )}
    </main>
  );

  function renderTab() {
    switch (activeTab) {
      case 'proxies':
        return (
          <ProxiesTab
            folderId={proxyFolderId}
            onFolderId={setProxyFolderId}
            onAddProxy={editors.newProxy}
            onImportProxies={() => editors.setProxyImportOpen(true)}
            onEditProxy={(proxy) => editors.editProxy(proxy)}
            onNewFolder={() => editors.setFolderDraft({
              kind: 'proxy',
              name: '',
              icon: DEFAULT_FOLDER_ICON,
              color: DEFAULT_PROFILE_COLOR,
            })}
            onEditFolder={(folder) => editors.setFolderDraft({
              id: folder.id,
              kind: 'proxy',
              name: folder.name,
              icon: folder.icon || DEFAULT_FOLDER_ICON,
              color: normalizeProfileColor(folder.color),
            })}
            fillCountry={folderFillCountry}
            onFillCountryDone={() => setFolderFillCountry('')}
            onRequestDelete={editors.requestDeleteProxies}
          />
        );
      case 'cookies':
        return (
          <CookiesTab
            folderId={cookieFolderId}
            onFolderId={setCookieFolderId}
            onOpenCookieSet={editors.setCookieSetOpen}
            onAssignCookieSet={editors.setAssignCookieSet}
            onNewCookieSet={() => void run('add-cookie-set', addCookieSetFromPicker)}
            onShowAbout={() => setCookieIntroOpen(true)}
            onNewFolder={() => editors.setFolderDraft({
              kind: 'cookie',
              name: '',
              icon: DEFAULT_FOLDER_ICON,
              color: DEFAULT_PROFILE_COLOR,
            })}
            onEditFolder={(folder) => editors.setFolderDraft({
              id: folder.id,
              kind: 'cookie',
              name: folder.name,
              icon: folder.icon || DEFAULT_FOLDER_ICON,
              color: normalizeProfileColor(folder.color),
            })}
          />
        );
      case 'startPage':
        return (
          <StartPageTab
            onAddBookmark={editors.newBookmark}
            onEditBookmark={editors.editBookmark}
          />
        );
      case 'automations':
        return (
          <AutomationsTab
            onNew={() => setAutomationDraft({automation: workspace.automations.newAutomation(), exists: false})}
            onEdit={(automation) => setAutomationDraft({automation, exists: true})}
            onHistory={setHistoryFor}
          />
        );
      case 'extensions':
        return <ExtensionsTab onAddExtension={() => editors.setExtensionAddOpen(true)} />;
      case 'integrations':
        return (
          <IntegrationsTab
            apiKeys={apiKeys}
            integrations={integrations}
            onOpen={integrations.open}
          />
        );
      case 'api':
        return (
          <ApiTab
            apiKeys={apiKeys}
            signedInEmail={org.email}
            onOpenDocs={() => openAccountPage('/docs/api')}
            onKeyCreated={setRevealedKey}
          />
        );
      case 'profiles':
      default:
        return (
          <ProfilesTab
            folderId={profileFolderId}
            onFolderId={setProfileFolderId}
            onEditProfile={editors.editProfile}
            onNewProfile={editors.newProfile}
            onNewFolder={() => editors.setFolderDraft({
              kind: 'profile',
              name: '',
              icon: DEFAULT_FOLDER_ICON,
              color: DEFAULT_PROFILE_COLOR,
            })}
            onEditFolder={(folder) => editors.setFolderDraft({
              id: folder.id,
              kind: 'profile',
              name: folder.name,
              icon: folder.icon || DEFAULT_FOLDER_ICON,
              color: normalizeProfileColor(folder.color),
            })}
            fillTag={folderFillTag}
            onFillTagDone={() => setFolderFillTag('')}
            onRequestDelete={editors.requestDeleteProfiles}
            onShowIntro={() => setIntroOpen(true)}
          />
        );
    }
  }

  function renderTopActions() {
    switch (activeTab) {
      case 'profiles':
        return (
          <>
            <button className="ghost" onClick={() => editors.setImportOpen(true)}>
              <Upload size={18} /> Import
            </button>
            <button onClick={editors.newProfile}><UserPlus size={18} /> Add profile</button>
          </>
        );
      case 'automations': {
        // UX only. trg_automation_limit is the real gate; describeDbError turns
        // its exception into the same sentence if this ever disagrees.
        const limit = org.org?.automation_limit ?? 0;
        const atCap = limit !== null && data.state.automations.length >= limit;
        return (
          <button
            disabled={atCap}
            title={atCap ?
              'Your plan doesn\'t include any more automations.' :
              'Create an automation'}
            onClick={() =>
              setAutomationDraft({automation: workspace.automations.newAutomation(), exists: false})}
          >
            <Plus size={18} /> New automation
          </button>
        );
      }
      case 'proxies':
        return (
          <>
            <button className="ghost" onClick={() => editors.setProxyImportOpen(true)}>
              <Upload size={18} /> Import
            </button>
            <button onClick={editors.newProxy}><Plus size={18} /> Add proxy</button>
          </>
        );
      case 'cookies':
        return (
          <>
            <button className="ghost" onClick={() => setCookieIntroOpen(true)}>
              <BookOpen size={18} /> About
            </button>
            <BusyButton
              busy={isPending('add-cookie-set')}
              busyLabel="Uploading…"
              onClick={() => void run('add-cookie-set', addCookieSetFromPicker)}
            >
              <Plus size={18} /> Cookie-set
            </BusyButton>
          </>
        );
      case 'startPage':
        // Adding one bookmark is the "+" tile on the page itself, so the top
        // action is the thing the page has no room for: bringing a whole
        // browser's worth of bookmarks across.
        return (
          <button onClick={() => editors.setBookmarkImportOpen(true)}>
            <Upload size={18} /> Import bookmarks
          </button>
        );
      default:
        return null;
    }
  }

  async function addCookieSetFromPicker() {
    if (!native?.selectCookieFile) {
      toast.setMessage('Native cookie file picker is not available. Restart Argus Launcher and try again.');
      return;
    }
    try {
      const selection = await native.selectCookieFile();
      if (!selection) {
        return;
      }
      // Filed into whichever folder the tab is standing in, so adding a set
      // from inside a folder does not drop it into All and make the user move
      // it. Trash is a view, not a folder, so it never becomes a destination.
      const folderId = cookieFolderId === TRASH_FOLDER_ID ? null : cookieFolderId || null;
      const entry = await workspace.cookies.addCookieSet(selection, {folderId});
      if (entry) {
        toast.setMessage(`Added "${entry.name}" to the cookie library`);
      }
    } catch (error) {
      toast.setMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

// Both the browser resource and the local API have to be up before any tab is
// worth showing: a launch with either missing fails in a way the user cannot
// act on from inside the app.
function describeStartup(
    orgReady: boolean,
    resourceState: ReturnType<typeof useResourceStatus>['resourceState'],
    apiState: ReturnType<typeof useResourceStatus>['apiState']) {
  const browserFailed = resourceState?.browserStatus === 'error';
  const apiFailed = apiState?.status === 'error';
  const browserReady = resourceState?.browserStatus === 'ready';
  const apiReady = apiState?.status === 'ready';
  const detail = !orgReady ? 'Checking cloud session and loading workspace.' :
    browserFailed ? resourceState?.error || 'Argus Browser resource failed to install.' :
      apiFailed ? apiState?.error || 'Local API failed to start.' :
        !browserReady ? (
          resourceState?.browserStatus === 'downloading' ?
            `Downloading Argus Browser ${resourceState.progress?.percent || 0}%` :
            resourceState?.browserStatus === 'installing' ?
              'Installing Argus Browser.' :
              'Checking Argus Browser resource.'
        ) :
          !apiReady ? 'Starting local API.' : 'Ready.';
  return {
    blocked: !orgReady || !browserReady || !apiReady,
    failed: browserFailed || apiFailed,
    canRetryBrowser: browserFailed,
    detail,
  };
}
