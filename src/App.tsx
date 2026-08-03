// The app shell: which tab is showing, which dialog is open, and the startup
// gate in front of both. Everything with real logic behind it lives in
// workspace/ (data and mutations), hooks/ (effects) or components/.
import {useEffect, useState} from 'react';
import {Plus, Upload, UserPlus} from 'lucide-react';
import {SignIn} from './components/SignIn';
import {Sidebar, Topbar, UpdateToast} from './components/Shell';
import {ApiTab} from './components/tabs/ApiTab';
import {ProfilesTab} from './components/tabs/ProfilesTab';
import {ProxiesTab} from './components/tabs/ProxiesTab';
import {
  BookmarksTab, CookiesTab, ExtensionsTab, IntegrationsTab,
} from './components/tabs/SimpleTabs';
import {ProfileDeleteModal, ProxyDeleteModal, ErrorModal} from './components/modals/ConfirmModals';
import {BookmarkModal, FolderModal, ProxyModal, StatusModal} from './components/modals/EditorModals';
import {IntegrationModal} from './components/modals/IntegrationModal';
import {
  CookiePickerModal, ExtensionAddModal, ImportModal,
} from './components/modals/LibraryModals';
import {ProfileIntroModal} from './components/modals/ProfileIntroModal';
import {ProfileModal} from './components/modals/ProfileModal';
import {
  ChangelogModal, OAuthApprovalModal, RevealedKeyModal, UpdateControl,
} from './components/modals/SettingsModal';
import {SettingsDialog} from './settings/SettingsDialog';
import {BusyButton} from './components/ui/BusyButton';
import {LoadingState} from './components/ui/LoadingState';
import {DEFAULT_FOLDER_ICON} from './data/folderIcons';
import {findIntegration} from './data/integrations';
import {SITE_URL} from './lib/auth';
import {hasSeenProfileIntro, markProfileIntroSeen} from './lib/introSeen';
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
  // Which folder the Profiles tab is filtered to. Held here rather than in the
  // tab because creating a folder from the dialog switches the view to it.
  const [profileFolderId, setProfileFolderId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
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
        <ProfileIntroModal
          onClose={() => setIntroOpen(false)}
          onCreateProfile={() => {
            setIntroOpen(false);
            editors.newProfile();
          }}
        />
      )}
      {editors.extensionAddOpen && (
        <ExtensionAddModal onClose={() => editors.setExtensionAddOpen(false)} />
      )}
      {editors.importOpen && <ImportModal onClose={() => editors.setImportOpen(false)} />}
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
          onCreated={setProfileFolderId}
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
            onAddProxy={editors.newProxy}
            onEditProxy={(proxy) => editors.editProxy(proxy)}
            onRequestDelete={editors.requestDeleteProxies}
          />
        );
      case 'cookies':
        return <CookiesTab />;
      case 'bookmarks':
        return <BookmarksTab onEditBookmark={editors.editBookmark} />;
      case 'extensions':
        return <ExtensionsTab onAddExtension={() => editors.setExtensionAddOpen(true)} />;
      case 'integrations':
        return <IntegrationsTab apiKeys={apiKeys} onOpen={integrations.open} />;
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
            onNewFolder={() => editors.setFolderDraft({name: '', icon: DEFAULT_FOLDER_ICON})}
            onEditFolder={(folder) => editors.setFolderDraft({
              id: folder.id,
              name: folder.name,
              icon: folder.icon || DEFAULT_FOLDER_ICON,
            })}
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
      case 'proxies':
        return <button onClick={editors.newProxy}><Plus size={18} /> Add proxy</button>;
      case 'cookies':
        return (
          <BusyButton
            busy={isPending('add-cookie-set')}
            busyLabel="Uploading…"
            onClick={() => void run('add-cookie-set', addCookieSetFromPicker)}
          >
            <Plus size={18} /> Cookie-set
          </BusyButton>
        );
      case 'bookmarks':
        return <button onClick={editors.newBookmark}><Plus size={18} /> Bookmark</button>;
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
      const entry = await workspace.library.addCookieSet(selection);
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
