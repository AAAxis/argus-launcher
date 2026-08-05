// The Team roster.
//
// A table rather than the card grid Automations and Extensions use: a member
// carries a name, a role, a join date and one row action, which is the shape
// the Profiles tab already solved. Cards earn their place when an item has more
// than a row's worth to say, and a person here does not.
//
// Pending invites are rows in the SAME table, not a second list below it. "Who
// is on this team" includes the people you have asked, and an owner comparing
// seats against the plan needs one number to count. They are visually distinct
// -- envelope instead of an avatar, a Pending badge, different actions -- but
// they sit in the order they were sent, in the roster they are joining.
//
// Nothing here is the security boundary. Every mutation is gated by RLS
// (is_org_owner on org_invites and on the delete policy on org_members) and the
// seat cap is enforced by trg_seat_limit and create_org_invite. The UI's job is
// to not offer what will be refused, and to say why when it does not offer it.
//
// There is no role picker. Two roles exist -- owner and member -- and neither is
// grantable from here: membership arrives by accepting an invite, and ownership
// belongs to whoever created the workspace.
import {useEffect, useState} from 'react';
import {
  Copy, Crown, LogOut, Mail, Share2, Shield, Trash2, UserPlus, Users, X,
} from 'lucide-react';
import {Badge} from '../ui/Badge';
import {EmptyState} from '../ui/EmptyState';
import {Meter} from '../ui/Meter';
import {Modal} from '../ui/Modal';
import {InviteMemberModal} from '../modals/InviteMemberModal';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import {inviteUrl} from '../../workspace/useTeamActions';
import {seatCap} from '../../team/limit';
import {SITE_LINKS} from '../../data/links';
import {formatDate, initials} from '../../lib/text';
import type {ShareRequest} from '../modals/ShareModal';
import type {Handoff, HandoffKind, OrgInvite, OrgMember, OrgRole} from '../../types';

// Three flat chips rather than a Members/Shared split with a second filter row
// nested inside it. Pending invites and the share inbox are both "the roster,
// but not yet" -- they belong at the same level as the roster, not one level
// down from it.
//
// Owned by App rather than by this component, because the inbox bell's "View
// all" has to land on `shared` specifically.
export type TeamView = 'members' | 'pending' | 'shared';

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
  member: 'Member',
};

// The same nouns the sidebar uses for the tab each of these lives on, so the
// hand-off list and the rail are one vocabulary rather than two.
const KIND_LABEL: Record<HandoffKind, string> = {
  profile: 'Profile',
  proxy: 'Proxy',
  cookie_set: 'Cookie set',
  automation: 'Automation',
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

export function TeamTab({view, onView, onShare, onOpenSite}: {
  view: TeamView;
  onView: (view: TeamView) => void;
  // Raises the share sheet with nothing preselected -- the "from that window"
  // entry point. The dialog carries its own item list precisely so this can
  // open cold, with no table selection behind it.
  onShare: (request: ShareRequest) => void;
  onOpenSite: (pathname: string) => void;
}) {
  const {data, team, shared, reload} = useWorkspace();
  const org = useOrg();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [copiedInviteId, setCopiedInviteId] = useState('');

  const members = data.state.members;
  const orgId = org.orgId;
  const isOwner = org.isOwner;

  // Only the owner can read org_invites -- every policy on it is is_org_owner --
  // so a member's fetch would come back empty rather than forbidden, which is
  // the kind of silent nothing that is worse than not asking.
  useEffect(() => {
    if (orgId && isOwner) {
      void team.loadInvites(orgId);
    }
    // team is rebuilt every render; loadInvites is the stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, isOwner, team.loadInvites]);

  // The outbox, unlike the roster, is only worth a round trip when somebody is
  // looking at it. Unlike invites this needs no owner check: handoffs_select is
  // is_org_member, so every teammate can read the org's pending hand-offs.
  const sharedActive = view === 'shared';
  useEffect(() => {
    if (orgId && sharedActive) {
      void shared.load(orgId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, sharedActive, shared.load]);

  const invites = isOwner ? team.invites : [];
  const live = invites.filter((invite) => new Date(invite.expires_at).getTime() > Date.now());
  const cap = seatCap(org.org, members.length, live.length);

  // The plan gate, and note what it does NOT cover any more.
  //
  // It used to return before anything rendered, which was right when this tab
  // was only a roster. It is not right now that the tab also holds hand-offs.
  // A one-seat workspace cannot have any -- there is nobody to hand anything
  // to -- but a workspace that DOWNGRADES still has colleagues and still has
  // pending offers, and hiding those behind an upsell would strand work on
  // somebody's plate with no way to see or answer it.
  //
  // `cap.loading` is checked first and falls through to the roster, never to
  // this hero -- putting an upsell in front of a paying team every cold start
  // is exactly the failure src/automations/limit.ts was fixed for.
  const gated = !cap.loading && !cap.entitled;

  // Members first because they are the answer to "who is here"; invites are the
  // answer to "who might be".
  const rows = view === 'pending' ? [] : members;
  const inviteRows = view === 'members' || view === 'pending' ? invites : [];
  const nothingYet = members.length <= 1 && invites.length === 0;
  // The chip counts only what is waiting on ME. The org's other pending
  // hand-offs are visible in the view, but a badge that counted them would be
  // telling you about somebody else's decision.
  const pendingShares = shared.pending.filter((item) => item.to_user === org.userId).length;

  return (
    <section className="team-tab">
      <section className="integration-bar">
        <div className="choice-chips" role="radiogroup" aria-label="Team view">
          {(['members', 'pending', 'shared'] as const)
              // Pending invites are an owner-only table, so the chip that shows
              // nothing but them is owner-only too. Shared is for everyone.
              .filter((option) => option !== 'pending' || isOwner)
              .map((option) => (
                <button
                  aria-checked={view === option}
                  className={view === option ? 'choice-chip active' : 'choice-chip'}
                  key={option}
                  onClick={() => onView(option)}
                  role="radio"
                  type="button"
                >
                  {option === 'members' ?
                    'Members' :
                    option === 'pending' ?
                      `Pending${invites.length ? ` · ${invites.length}` : ''}` :
                      `Shared${pendingShares ? ` · ${pendingShares}` : ''}`}
                </button>
              ))}
        </div>

        {/* The Shared view swaps the roster's controls for the one action it
            is about. A seat count means nothing beside a list of hand-offs, and
            Share means nothing beside a list of people. */}
        {sharedActive ? (
          <div className="integration-bar-side">
            <button className="ghost" onClick={() => onShare({kind: 'profile', ids: []})}>
              <Share2 size={16} /> Share…
            </button>
          </div>
        ) : (
          <div className="integration-bar-side">
            {/* Seats, not people: the number the owner is deciding against is
                members plus outstanding invites, which is what create_org_invite
                compares to the limit.

                Held back entirely while the org is loading. cap.limit is null
                until it arrives, and Meter reads null as "of unlimited" -- so
                rendering early would flash an unlimited seat allowance at someone
                who has ten, which is the same class of lie the disabled-button
                bug in automations/limit.ts was. */}
            {!cap.loading && !gated && (
              <span className="team-seats">
                <span className="team-seats-label">Seats</span>
                <Meter compact used={cap.used} limit={cap.limit} />
              </span>
            )}
            {isOwner && !gated && (
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
        )}
      </section>

      {sharedActive ? (
        <SharedView
          pending={shared.pending}
          members={members}
          userId={org.userId}
          onShare={() => onShare({kind: 'profile', ids: []})}
          onAccept={(id) => {
            if (orgId) {
              void shared.accept(id, orgId, reload);
            }
          }}
          onDecline={(id) => {
            if (orgId) {
              void shared.decline(id, orgId);
            }
          }}
          onCancel={(id) => {
            if (orgId) {
              void shared.cancel(id, orgId);
            }
          }}
        />
      ) : gated ? (
        // The plan gate, for the roster only. Shown rather than hidden: a Base
        // customer who cannot find the feature cannot decide to pay for it, and
        // an empty roster of one would not explain itself.
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
      ) : (
        <>
          {!isOwner && (
            // The standing-fact shape the Extensions tab uses for its own note,
            // not a toast: this is always true of this screen for this person, not
            // something that just happened.
            <section className="api-note">
              <Shield size={18} />
              <span>
                You have full access to this workspace. Only its owner can invite or
                remove people.
              </span>
            </section>
          )}

          {nothingYet && view === 'members' ? (
        <EmptyState
          hero
          icon={<Users size={20} strokeWidth={1.75} />}
          title="It's just you so far"
          body={'Everyone you invite shares this workspace: the same profiles, proxies, ' +
            'cookie sets and automations. Nothing is copied and nothing is per-person.'}
        >
          {isOwner && (
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
                {/* Sized by .actions-cell, not by this header. A bare th with
                    no width let the column stretch to its widest row, which is
                    how one icon and two icons ended up starting at different
                    x positions. */}
                <th className="actions-cell" />
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <MemberRow
                  key={member.user_id}
                  member={member}
                  members={members}
                  isOwner={isOwner}
                  isSelf={member.user_id === org.userId}
                  onRemove={() => setRemoving(member)}
                  onLeave={() => setLeaving(true)}
                />
              ))}

              {inviteRows.map((invite) => (
                <InviteRow
                  key={invite.id}
                  invite={invite}
                  members={members}
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
        </>
      )}

      {inviting && orgId && (
        <InviteMemberModal
          onClose={() => setInviting(false)}
          onInvite={(email) => team.createInvite(orgId, email)}
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

// Every pending hand-off in the workspace, split by who has to answer it.
//
// Two groups rather than one feed, because they are answered differently: the
// top half is a decision you have to make, the bottom half is one you are
// waiting on. Merging them would bury an Accept button among rows that carry
// nothing to press.
//
// Accepted and declined offers are deliberately absent. An accepted one is
// already visible as the assignment itself -- it is a name in the Assigned
// column on the tab where the item lives -- and a settled list here would be a
// second, staler copy of that.
function SharedView({pending, members, userId, onShare, onAccept, onDecline, onCancel}: {
  pending: Handoff[];
  members: OrgMember[];
  userId: string | null;
  onShare: () => void;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const mine = pending.filter((item) => item.to_user === userId);
  const theirs = pending.filter((item) => item.to_user !== userId);

  function nameOf(id: string | null) {
    if (!id) {
      return 'someone';
    }
    const member = members.find((item) => item.user_id === id);
    if (!member) {
      return 'a former teammate';
    }
    return member.display_name || member.email.split('@')[0] || member.email;
  }

  if (pending.length === 0) {
    return (
      <EmptyState
        hero
        icon={<Share2 size={20} strokeWidth={1.75} />}
        title="Nothing waiting"
        body={'Sharing hands a profile, proxy, cookie set or automation to someone else ' +
          'on the team. They accept it, and it shows as theirs under "Assigned to me". ' +
          'It does not change who can open it — everyone here can already see all of it.'}
      >
        <button className="primary" onClick={onShare}>
          <Share2 size={16} /> Share something
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="shared-groups">
      {mine.length > 0 && (
        <section>
          <h2 className="shared-group-title">Waiting for you · {mine.length}</h2>
          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>Sent</th>
                  <th className="actions-cell" />
                </tr>
              </thead>
              <tbody>
                {mine.map((item) => (
                  <tr key={item.id}>
                    <td className="name-cell">
                      {item.item_name}
                      {item.note && <span className="shared-note">{item.note}</span>}
                    </td>
                    <td><span className="shared-kind">{KIND_LABEL[item.kind]}</span></td>
                    <td className="team-invited-by">{nameOf(item.from_user)}</td>
                    <td>{formatDate(item.created_at)}</td>
                    <td className="actions-cell">
                      <div className="row-actions">
                        <button className="ghost" onClick={() => onDecline(item.id)}>
                          Decline
                        </button>
                        <button onClick={() => onAccept(item.id)}>Accept</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>
      )}

      {theirs.length > 0 && (
        <section>
          <h2 className="shared-group-title">Waiting on someone else</h2>
          <section className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Waiting on</th>
                  <th>Sent</th>
                  <th className="actions-cell" />
                </tr>
              </thead>
              <tbody>
                {theirs.map((item) => (
                  <tr key={item.id}>
                    <td className="name-cell">{item.item_name}</td>
                    <td><span className="shared-kind">{KIND_LABEL[item.kind]}</span></td>
                    <td className="team-invited-by">{nameOf(item.to_user)}</td>
                    <td>{formatDate(item.created_at)}</td>
                    <td className="actions-cell">
                      <div className="row-actions">
                        {/* Anyone in the org can withdraw, not just the sender.
                            handoffs_select and cancel_handoff are both
                            is_org_member, and an offer left dangling by someone
                            who is on holiday should not need them to clear it. */}
                        <button
                          className="ghost icon-button row-action row-action-danger"
                          onClick={() => onCancel(item.id)}
                          title="Withdraw this share"
                        ><X size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </section>
      )}
    </div>
  );
}

function MemberRow({
  member, members, isOwner, isSelf, onRemove, onLeave,
}: {
  member: OrgMember;
  members: OrgMember[];
  // Whether the person LOOKING at this row owns the workspace, not whether the
  // person IN it does -- that is member.role.
  isOwner: boolean;
  isSelf: boolean;
  onRemove: () => void;
  onLeave: () => void;
}) {
  const invitedBy = members.find((item) => item.user_id === member.invited_by);
  const name = member.display_name || member.email.split('@')[0] || member.email;
  // Nobody removes the owner and the owner cannot leave: their row is the
  // workspace's only route to billing and to inviting anyone, and ownership
  // transfer does not exist yet, so an ownerless org would be unrecoverable.
  // org_members_delete carries `role <> 'owner'` and refuses it either way.
  const isTheOwner = member.role === 'owner';

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

      {/* A label, not a control. Neither role is grantable from here: membership
          arrives by accepting an invite, and ownership is not transferable. */}
      <td>
        {isTheOwner ? (
          <Badge icon={<Crown size={12} />}>Owner</Badge>
        ) : (
          <Badge>{ROLE_LABEL[member.role]}</Badge>
        )}
      </td>

      <td>{formatDate(member.created_at)}</td>
      <td className="team-invited-by">
        {invitedBy ? (invitedBy.display_name || invitedBy.email) : '—'}
      </td>

      {/* The wrapper is rendered even when there is no button in it. Most rows
          here offer nothing -- an owner viewing an owner, a member viewing
          anyone -- and an empty cell that collapsed to zero height was half of
          why this table did not line up. */}
      <td className="actions-cell">
        <div className="row-actions">
          {/* Your own row offers Leave, never Remove -- and not even that if you
              are the owner, who has nobody to hand the workspace to. */}
          {isSelf ? (
            !isTheOwner && (
              <button className="ghost icon-button row-action" onClick={onLeave} title="Leave team">
                <LogOut size={16} />
              </button>
            )
          ) : isOwner && !isTheOwner ? (
            <button
              className="ghost icon-button row-action row-action-danger"
              onClick={onRemove}
              title={`Remove ${name}`}
            ><Trash2 size={16} /></button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function InviteRow({invite, members, copied, onCopy, onRevoke}: {
  invite: OrgInvite;
  members: OrgMember[];
  copied: boolean;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const expired = new Date(invite.expires_at).getTime() <= Date.now();
  const invitedBy = members.find((item) => item.user_id === invite.invited_by);
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

      {/* One cell per column, no colspan. Merging Joined and Invited-by is what
          put this badge under the wrong heading and left every cell to its
          right out of step with the member rows above it.

          The badge belongs in Joined because that is the column answering "when
          did this person arrive" -- and for an invite the honest answer is that
          they have not, with the deadline attached. */}
      <td>
        {expired ?
          <Badge tone="ban">Expired</Badge> :
          <Badge tone="warmup">Pending · expires {relativeDays(invite.expires_at)}</Badge>}
      </td>
      <td className="team-invited-by">
        {invitedBy ? (invitedBy.display_name || invitedBy.email) : '—'}
      </td>

      <td className="actions-cell">
        <div className="row-actions">
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
        </div>
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
              an explanation -- org_members_delete carries `role <> 'owner'`, so
              an owner is told they cannot leave their own workspace -- and that
              belongs next to the button that produced it. */}
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
        is deleted, and its owner can invite you back.
      </p>
    </Modal>
  );
}
