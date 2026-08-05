// The Team roster.
//
// A table rather than the card grid Automations and Extensions use: a member
// carries a name, a role, a join date and one row action, which is the shape
// the Profiles tab already solved. Cards earn their place when an item has more
// than a row's worth to say, and a person here does not.
//
// Pending invites are rows in the SAME table, not a second list below it. "Who
// is on this team" includes the people you have asked, and an admin comparing
// seats against the plan needs one number to count. They are visually distinct
// -- envelope instead of an avatar, a Pending badge, different actions -- but
// they sit in the order they were sent, in the roster they are joining.
//
// Nothing here is the security boundary. Every mutation is gated by RLS
// (is_org_admin on org_members and org_invites) and the seat cap is enforced by
// trg_seat_limit and create_org_invite. The UI's job is to not offer what will
// be refused, and to say why when it does not offer it.
import {useEffect, useState} from 'react';
import {
  Copy, Crown, LogOut, Mail, Shield, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import {Badge} from '../ui/Badge';
import {EmptyState} from '../ui/EmptyState';
import {Meter} from '../ui/Meter';
import {Modal} from '../ui/Modal';
import {Popover} from '../ui/Popover';
import {InviteMemberModal} from '../modals/InviteMemberModal';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import {inviteUrl} from '../../workspace/useTeamActions';
import {seatCap} from '../../team/limit';
import {SITE_LINKS} from '../../data/links';
import {formatDate, initials} from '../../lib/text';
import type {OrgInvite, OrgMember, OrgRole} from '../../types';

type View = 'all' | 'pending';

// "in 5 days" / "5 days ago", to the nearest sensible unit.
//
// Local to this file on purpose: it is the only screen with a deadline on it,
// and lib/text.ts holds formatters that several tabs share. If a second surface
// ever needs this, that is the moment to move it.
function relativeDays(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) {
    return '';
  }
  const days = Math.round(ms / 86_400_000);
  if (days === 0) {
    return 'today';
  }
  if (days > 0) {
    return days === 1 ? 'tomorrow' : `in ${days} days`;
  }
  const ago = Math.abs(days);
  return ago === 1 ? 'yesterday' : `${ago} days ago`;
}

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

function MemberAvatar({member}: {member: OrgMember}) {
  const name = member.display_name || member.email;
  if (member.avatar_url) {
    return (
      <img alt="" className="team-avatar" referrerPolicy="no-referrer" src={member.avatar_url} />
    );
  }
  return <span className="team-avatar is-initials">{initials(name)}</span>;
}

export function TeamTab({onOpenSite}: {onOpenSite: (pathname: string) => void}) {
  const {data, team} = useWorkspace();
  const org = useOrg();
  const [view, setView] = useState<View>('all');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState('');

  const members = data.state.members;
  const orgId = org.orgId;
  const isAdmin = org.isAdmin;

  // Only an admin can read org_invites -- every policy on it is is_org_admin --
  // so a member's fetch would come back empty rather than forbidden, which is
  // the kind of silent nothing that is worse than not asking.
  useEffect(() => {
    if (orgId && isAdmin) {
      void team.loadInvites(orgId);
    }
    // team is rebuilt every render; loadInvites is the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, isAdmin, team.loadInvites]);

  const invites = isAdmin ? team.invites : [];
  const live = invites.filter((invite) => new Date(invite.expires_at).getTime() > Date.now());
  const cap = seatCap(org.org, members.length, live.length);

  // The plan gate. Shown rather than hidden: a Base customer who cannot find
  // the feature cannot decide to pay for it, and an empty roster of one would
  // not explain itself.
  //
  // `cap.loading` is checked first and falls through to the roster, never to
  // this hero -- putting an upsell in front of a paying team every cold start
  // is exactly the failure src/automations/limit.ts was fixed for.
  if (!cap.loading && !cap.entitled) {
    return (
      <section className="team-tab is-empty">
        <EmptyState
          hero
          icon={<Users size={20} strokeWidth={1.75} />}
          title="Work as a team"
          body={'Your plan is for one person. On a team plan everyone shares the same ' +
            'profiles, proxies, cookie sets and automations — one person sets them up, ' +
            'another checks them, and nobody trades files or passwords to do it.'}
        >
          <button className="primary" onClick={() => onOpenSite(SITE_LINKS.pricing)}>
            See plans
          </button>
        </EmptyState>
      </section>
    );
  }

  // The Pending chip filters the roster down to invites; All shows both, with
  // members first because they are the answer to "who is here" and invites are
  // the answer to "who might be".
  const rows = view === 'pending' ? [] : members;
  const inviteRows = invites;
  const nothingYet = members.length <= 1 && inviteRows.length === 0;

  return (
    <section className="team-tab">
      <section className="integration-bar">
        {isAdmin ? (
          <div className="choice-chips" role="radiogroup" aria-label="Team view">
            {(['all', 'pending'] as const).map((option) => (
              <button
                aria-checked={view === option}
                className={view === option ? 'choice-chip active' : 'choice-chip'}
                key={option}
                onClick={() => setView(option)}
                role="radio"
                type="button"
              >
                {option === 'all' ? 'All' : `Pending${invites.length ? ` · ${invites.length}` : ''}`}
              </button>
            ))}
          </div>
        ) : (
          <span className="integration-bar-count">
            <strong>{members.length}</strong> {members.length === 1 ? 'person' : 'people'}
          </span>
        )}

        <div className="integration-bar-side">
          {/* Seats, not people: the number an admin is deciding against is
              members plus outstanding invites, which is what create_org_invite
              compares to the limit.

              Held back entirely while the org is loading. cap.limit is null
              until it arrives, and Meter reads null as "of unlimited" -- so
              rendering early would flash an unlimited seat allowance at someone
              who has ten, which is the same class of lie the disabled-button
              bug in automations/limit.ts was. */}
          {!cap.loading && (
            <span className="team-seats">
              <span className="team-seats-label">Seats</span>
              <Meter used={cap.used} limit={cap.limit} />
            </span>
          )}
          {isAdmin && (
            <button
              className="ghost"
              disabled={cap.atCap}
              onClick={() => setInviting(true)}
              title={cap.atCap ?
                'Every seat on your plan is taken. Revoke a pending invite, remove ' +
                  'someone, or upgrade the plan.' :
                'Invite someone to this workspace'}
            >
              <UserPlus size={16} /> Invite member
            </button>
          )}
        </div>
      </section>

      {!isAdmin && (
        // The standing-fact shape the Extensions tab uses for its admin note,
        // not a toast: this is always true of this screen for this person, not
        // something that just happened.
        <section className="api-note">
          <Shield size={18} />
          <span>Only an owner or admin can invite or remove people.</span>
        </section>
      )}

      {nothingYet && view === 'all' ? (
        <EmptyState
          hero
          icon={<Users size={20} strokeWidth={1.75} />}
          title="It's just you so far"
          body={'Everyone you invite shares this workspace: the same profiles, proxies, ' +
            'cookie sets and automations. Nothing is copied and nothing is per-person.'}
        >
          {isAdmin && (
            <button className="primary" onClick={() => setInviting(true)}>
              <UserPlus size={16} /> Invite your first teammate
            </button>
          )}
        </EmptyState>
      ) : (
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Joined</th>
                <th>Invited by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <MemberRow
                  key={member.user_id}
                  member={member}
                  members={members}
                  isAdmin={isAdmin}
                  isSelf={member.user_id === org.userId}
                  // The last owner is the workspace's only route to billing and
                  // to promoting anyone else. Removing or demoting them would
                  // strand the org, so neither is offered.
                  isLastOwner={member.role === 'owner' &&
                    members.filter((item) => item.role === 'owner').length === 1}
                  onRole={(role) => {
                    if (orgId) {
                      void team.setRole(orgId, member.user_id, role);
                    }
                  }}
                  onRemove={() => setRemoving(member)}
                  onLeave={() => setLeaving(true)}
                />
              ))}

              {inviteRows.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  copied={copiedInviteId === invite.id}
                  onCopy={() => {
                    void navigator.clipboard.writeText(inviteUrl(invite.token))
                        .then(() => setCopiedInviteId(invite.id))
                        // Clipboard access can be refused; saying nothing beats
                        // claiming a copy that did not happen.
                        .catch(() => setCopiedInviteId(''));
                  }}
                  onRevoke={() => {
                    if (orgId) {
                      void team.revokeInvite(orgId, invite.id);
                    }
                  }}
                />
              ))}

              {view === 'pending' && inviteRows.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      icon={<Mail size={22} strokeWidth={1.75} />}
                      title="No pending invites"
                      body="Everyone you've invited has either joined or been revoked."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {inviting && orgId && (
        <InviteMemberModal
          onClose={() => setInviting(false)}
          onInvite={(email, role) => team.createInvite(orgId, email, role)}
          seatsLeft={cap.limit === null ? null : Math.max(0, cap.limit - cap.used)}
        />
      )}

      {removing && orgId && (
        <RemoveMemberModal
          member={removing}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await team.remove(orgId, removing.user_id);
            setRemoving(null);
          }}
        />
      )}

      {leaving && orgId && org.userId && (
        <LeaveTeamModal
          orgName={org.org?.name || 'this workspace'}
          onClose={() => setLeaving(false)}
          onConfirm={() => team.leave(orgId, org.userId as string)}
          onLeft={() => {
            setLeaving(false);
            void org.reload();
          }}
        />
      )}
    </section>
  );
}

function MemberRow({
  member, members, isAdmin, isSelf, isLastOwner, onRole, onRemove, onLeave,
}: {
  member: OrgMember;
  members: OrgMember[];
  isAdmin: boolean;
  isSelf: boolean;
  isLastOwner: boolean;
  onRole: (role: Exclude<OrgRole, 'owner'>) => void;
  onRemove: () => void;
  onLeave: () => void;
}) {
  const invitedBy = members.find((item) => item.user_id === member.invited_by);
  const name = member.display_name || member.email.split('@')[0] || member.email;
  // Roles are editable by an admin for anyone who is not an owner. Owners are
  // never demoted here -- see isLastOwner above, and the fact that ownership
  // transfer does not exist yet, so demoting the one owner is unrecoverable.
  const canEditRole = isAdmin && member.role !== 'owner';

  return (
    <tr>
      <td className="name-cell">
        <span className="team-member">
          <MemberAvatar member={member} />
          <span className="team-member-text">
            <strong>
              {name}
              {isSelf && <Badge>You</Badge>}
            </strong>
            <span className="team-member-email">{member.email}</span>
          </span>
        </span>
      </td>

      <td>
        {member.role === 'owner' ? (
          <Badge icon={<Crown size={12} />}>Owner</Badge>
        ) : canEditRole ? (
          <span className="status-picker">
            <Badge>{ROLE_LABEL[member.role]}</Badge>
            <Popover
              label={`Change role for ${name}`}
              panelClassName="status-pop"
              trigger={<Shield size={13} />}
              triggerClassName="icon-button status-picker-edit"
              width={230}
            >
              {(close) => (
                <div className="status-pop-list" role="listbox" aria-label="Role">
                  {(['member', 'admin'] as const).map((option) => (
                    <button
                      aria-selected={option === member.role}
                      className={option === member.role ?
                        'status-pop-option active' : 'status-pop-option'}
                      key={option}
                      onClick={() => {
                        onRole(option);
                        close();
                      }}
                      role="option"
                      type="button"
                    ><Badge>{ROLE_LABEL[option]}</Badge></button>
                  ))}
                </div>
              )}
            </Popover>
          </span>
        ) : (
          <Badge>{ROLE_LABEL[member.role]}</Badge>
        )}
      </td>

      <td>{formatDate(member.created_at)}</td>
      <td className="team-invited-by">
        {invitedBy ? (invitedBy.display_name || invitedBy.email) : '—'}
      </td>

      <td>
        {/* Your own row offers Leave, never Remove -- and not even that if you
            are the last owner, who has nobody to hand the workspace to. */}
        {isSelf ? (
          !isLastOwner && (
            <button className="ghost icon-button row-action" onClick={onLeave} title="Leave team">
              <LogOut size={16} />
            </button>
          )
        ) : isAdmin && !isLastOwner && member.role !== 'owner' ? (
          <button
            className="ghost icon-button row-action row-action-danger"
            onClick={onRemove}
            title={`Remove ${name}`}
          ><Trash2 size={16} /></button>
        ) : null}
      </td>
    </tr>
  );
}

function InviteRow({invite, copied, onCopy, onRevoke}: {
  invite: OrgInvite;
  copied: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const expired = new Date(invite.expires_at).getTime() <= Date.now();
  return (
    <tr className="team-invite-row">
      <td className="name-cell">
        <span className="team-member">
          <span className="team-avatar is-invite"><Mail size={15} strokeWidth={1.75} /></span>
          <span className="team-member-text">
            <strong>{invite.email}</strong>
            <span className="team-member-email">
              Invited {relativeDays(invite.created_at)}
            </span>
          </span>
        </span>
      </td>
      <td><Badge>{ROLE_LABEL[invite.role]}</Badge></td>
      <td colSpan={2}>
        {expired ?
          <Badge tone="ban">Expired</Badge> :
          <Badge tone="warmup">Pending · expires {relativeDays(invite.expires_at)}</Badge>}
      </td>
      <td>
        <span className="team-invite-actions">
          {/* No copy button on a dead link: the URL still exists but
              accept_org_invite refuses it, so offering it would hand the admin
              something that fails for their teammate rather than for them. */}
          {!expired && (
            <button className="ghost icon-button row-action" onClick={onCopy}
              title={copied ? 'Link copied' : 'Copy invite link'}>
              <Copy size={16} />
            </button>
          )}
          <button
            className="ghost icon-button row-action row-action-danger"
            onClick={onRevoke}
            title="Revoke invite"
          ><X size={16} /></button>
        </span>
      </td>
    </tr>
  );
}

function RemoveMemberModal({member, onClose, onConfirm}: {
  member: OrgMember;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const name = member.display_name || member.email;
  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={`Remove ${name}?`}
      footer={
        <>
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="danger" disabled={busy} onClick={() => {
            setBusy(true);
            void onConfirm().finally(() => setBusy(false));
          }}>
            <Trash2 size={16} /> Remove
          </button>
        </>
      }
    >
      {/* Naming what does NOT happen is the point. The natural fear is that
          removing someone takes their work with them, and it does not: profiles
          belong to the organization, which is what org-scoped rows mean. */}
      <p className="error-detail">
        They'll lose access to this workspace immediately and their seat is freed.
        Everything they made stays — profiles, proxies, cookie sets and automations
        belong to the workspace, not to the person who created them.
      </p>
    </Modal>
  );
}

function LeaveTeamModal({orgName, onClose, onConfirm, onLeft}: {
  orgName: string;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
  onLeft: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      className="small-modal"
      onClose={onClose}
      title={`Leave ${orgName}?`}
      footer={
        <>
          {/* Rendered here rather than as a toast because the likely failure is
              an instruction -- org_members_delete is is_org_admin, so a plain
              member is told to ask an admin -- and that belongs next to the
              button that produced it. */}
          {error && <p className="settings-error">{error}</p>}
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="danger" disabled={busy} onClick={() => {
            setBusy(true);
            setError('');
            void onConfirm().then((message) => {
              setBusy(false);
              if (message) {
                setError(message);
                return;
              }
              onLeft();
            });
          }}>
            <LogOut size={16} /> Leave
          </button>
        </>
      }
    >
      <p className="error-detail">
        You'll lose access to this workspace's profiles, proxies and cookie sets. Nothing
        is deleted, and an admin can invite you back.
      </p>
    </Modal>
  );
}
