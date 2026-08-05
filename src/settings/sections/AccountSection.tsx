// Account: who is signed in, what they look like, and how to leave.
//
// Everything writable here belongs to the *user* (avatar, display name) except
// the workspace name, which belongs to the org and is writable by any member --
// RLS on organizations checks is_org_member. db.orgs.rename is called through
// the caller's withDb wrapper, which reports a failure properly.
import {useRef, useState} from 'react';
import {Camera, LogOut, Trash2} from 'lucide-react';
import * as account from '../../db/account';
import {formatDate, initials} from '../../lib/text';
import {useOrg} from '../../org';
import {SettingsGroup, SettingsRow, SettingsValue} from '../rows';

type Props = {
  onSignOut: () => void | Promise<void>;
  onOpenSite: (pathname: string) => void;
  onMessage: (text: string) => void;
  onRenameOrg: (name: string) => Promise<boolean>;
};

export function AccountSection({onSignOut, onOpenSite, onMessage, onRenameOrg}: Props) {
  const org = useOrg();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [orgDraft, setOrgDraft] = useState<string | null>(null);
  const [orgBusy, setOrgBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const shownName = org.displayName || org.email.split('@')[0] || 'Your account';

  async function pickAvatar(file: File | undefined) {
    if (!file) {
      return;
    }
    setAvatarBusy(true);
    try {
      const user = await account.uploadAvatar(file);
      // `?? undefined` matters: passing null would be read as "signed out" and
      // would tear the workspace down. A null here means the write succeeded but
      // returned no record, so re-read instead.
      await org.refreshUser(user ?? undefined);
      onMessage('Profile picture updated');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAvatarBusy(false);
      // Same file twice in a row still fires onChange only if the value is
      // cleared -- otherwise a failed upload cannot be retried with that file.
      if (fileRef.current) {
        fileRef.current.value = '';
      }
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true);
    try {
      const user = await account.clearAvatar();
      // `?? undefined` matters: passing null would be read as "signed out" and
      // would tear the workspace down. A null here means the write succeeded but
      // returned no record, so re-read instead.
      await org.refreshUser(user ?? undefined);
      onMessage('Profile picture removed');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function saveName() {
    if (nameDraft === null) {
      return;
    }
    setNameBusy(true);
    try {
      const user = await account.updateDisplayName(nameDraft);
      // `?? undefined` matters: passing null would be read as "signed out" and
      // would tear the workspace down. A null here means the write succeeded but
      // returned no record, so re-read instead.
      await org.refreshUser(user ?? undefined);
      setNameDraft(null);
      onMessage('Name updated');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setNameBusy(false);
    }
  }

  async function saveOrgName() {
    if (orgDraft === null) {
      return;
    }
    const next = orgDraft.trim();
    if (!next) {
      onMessage('A workspace needs a name.');
      return;
    }
    setOrgBusy(true);
    const ok = await onRenameOrg(next);
    setOrgBusy(false);
    if (ok) {
      setOrgDraft(null);
    }
  }

  async function signOutEverywhere() {
    setSignOutBusy(true);
    try {
      await account.signOutEverywhere();
      // signOut({scope: 'global'}) ends this session too, so the app has to run
      // the same teardown it does for an ordinary sign-out.
      await onSignOut();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSignOutBusy(false);
    }
  }

  const providers = org.providers.map(account.describeProvider).join(' · ');

  return (
    <>
      <SettingsGroup>
        <div className="settings-identity">
          {org.avatarUrl ?
            <img alt="" className="settings-identity-avatar" referrerPolicy="no-referrer" src={org.avatarUrl} /> :
            <span className="settings-identity-avatar">{initials(shownName)}</span>}
          <div className="settings-identity-text">
            <strong>{shownName}</strong>
            <span title={org.email}>{org.email}</span>
          </div>
          <div className="settings-identity-actions">
            <input
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="visually-hidden"
              onChange={(event) => void pickAvatar(event.target.files?.[0])}
              ref={fileRef}
              type="file"
            />
            <button
              className="ghost"
              disabled={avatarBusy}
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              <Camera size={15} /> {avatarBusy ? 'Working…' : 'Change picture'}
            </button>
            {org.hasCustomAvatar && (
              <button className="ghost" disabled={avatarBusy} onClick={() => void removeAvatar()} type="button">
                Remove
              </button>
            )}
          </div>
        </div>

        <SettingsRow
          label="Display name"
          description="Shown on this device. Leave it empty to go by your email address."
        >
          {nameDraft === null ? (
            <>
              <SettingsValue>{org.displayName || '—'}</SettingsValue>
              <button className="ghost" onClick={() => setNameDraft(org.displayName)} type="button">
                Change
              </button>
            </>
          ) : (
            <>
              <input
                autoFocus
                maxLength={80}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void saveName();
                  }
                  if (event.key === 'Escape') {
                    setNameDraft(null);
                  }
                }}
                placeholder="Your name"
                type="text"
                value={nameDraft}
              />
              <button disabled={nameBusy} onClick={() => void saveName()} type="button">
                {nameBusy ? 'Saving…' : 'Save'}
              </button>
              <button className="ghost" disabled={nameBusy} onClick={() => setNameDraft(null)} type="button">
                Cancel
              </button>
            </>
          )}
        </SettingsRow>

        <SettingsRow label="Email" description="The address your sign-in codes go to.">
          <SettingsValue title={org.email}>{org.email || '—'}</SettingsValue>
        </SettingsRow>

        <SettingsRow label="Signed in with">
          <SettingsValue>{providers || '—'}</SettingsValue>
        </SettingsRow>

        <SettingsRow label="Member since">
          <SettingsValue>{formatDate(org.createdAt) || '—'}</SettingsValue>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Workspace">
        {/* Renaming is no longer owner-only: organizations_update is is_org_member
            as of 2026-08-10, and the entitlement columns are held back by column
            grants rather than by the role. So there is one description now
            instead of a permission branch. */}
        <SettingsRow
          label="Name"
          description="Shared with everyone in this workspace."
        >
          {orgDraft === null ? (
            <>
              <SettingsValue>{org.org?.name || '—'}</SettingsValue>
              {org.org && (
                <button className="ghost" onClick={() => setOrgDraft(org.org?.name || '')} type="button">
                  Rename
                </button>
              )}
            </>
          ) : (
            <>
              <input
                autoFocus
                maxLength={80}
                onChange={(event) => setOrgDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void saveOrgName();
                  }
                  if (event.key === 'Escape') {
                    setOrgDraft(null);
                  }
                }}
                type="text"
                value={orgDraft}
              />
              <button disabled={orgBusy} onClick={() => void saveOrgName()} type="button">
                {orgBusy ? 'Saving…' : 'Save'}
              </button>
              <button className="ghost" disabled={orgBusy} onClick={() => setOrgDraft(null)} type="button">
                Cancel
              </button>
            </>
          )}
        </SettingsRow>

        <SettingsRow label="Your role" description="Owners and admins manage workspace-wide settings.">
          <SettingsValue>{org.role ? org.role[0].toUpperCase() + org.role.slice(1) : '—'}</SettingsValue>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Session">
        <SettingsRow label="Sign out" description="Ends the session on this computer only.">
          <button className="ghost" onClick={() => void onSignOut()} type="button">
            <LogOut size={15} /> Sign out
          </button>
        </SettingsRow>

        <SettingsRow
          label="Sign out everywhere"
          description="Signs out every device and browser this account is signed in on, including this one."
        >
          <button className="ghost" disabled={signOutBusy} onClick={() => void signOutEverywhere()} type="button">
            {signOutBusy ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </SettingsRow>

        <SettingsRow
          label="Delete account"
          description="Removes your account and its cloud data. Handled by support so a workspace is never left without an owner."
        >
          <button className="ghost danger" onClick={() => onOpenSite('/support')} type="button">
            <Trash2 size={15} /> Contact support
          </button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
