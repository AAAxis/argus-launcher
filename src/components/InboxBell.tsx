// The topbar bell: what a teammate has handed you, and what your automations
// have to report -- two kinds, one surface.
//
// It lives in the Topbar rather than as a tenth sidebar tab because this is
// empty almost all of the time, and a permanent nav entry that says nothing on
// 364 days a year trains people to stop looking at it. A bell with no count is
// quiet; a bell with a count is not.
//
// Handoffs come first when both kinds are present: they demand a decision,
// while a run notification only reports one already made. Accept and Decline
// are inline rather than on a detail page -- the decision needs the sender,
// the kind and the note, all of which fit, and an offer that can only be
// answered two clicks away is one that sits unanswered.
//
// A run notification's tone comes off its stored `status`, which was copied
// from the run record when the row was written. It is REPORTED, never
// recomputed here -- the record decided the verdict, and this must not become
// a fifth place the outcome is worked out.
import {useEffect} from 'react';
import {
  AlertTriangle, Bell, CheckCircle2, Cookie, Monitor, StopCircle, Waypoints, Workflow, X,
  XCircle,
} from 'lucide-react';
import * as db from '../db';
import {ago} from '../lib/relativeTime';
import {Popover} from './ui/Popover';
import {useOrg} from '../org';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import type {ArgusNotification, HandoffKind} from '../types';

const KIND_ICON: Record<HandoffKind, typeof Monitor> = {
  profile: Monitor,
  proxy: Waypoints,
  cookie_set: Cookie,
  automation: Workflow,
};

// The same nouns the sidebar uses for the tab each of these lives on, so the
// inbox and the rail are one vocabulary rather than two.
const KIND_LABEL: Record<HandoffKind, string> = {
  profile: 'Profile',
  proxy: 'Proxy',
  cookie_set: 'Cookie set',
  automation: 'Automation',
};

// Glyph and tone per run status. Keyed by the stored string rather than
// RunStatus because the column is text -- a status written by a newer build
// falls through to the neutral workflow glyph instead of crashing the bell.
const STATUS_GLYPH: Record<string, {icon: typeof Workflow; tone: string}> = {
  ok: {icon: CheckCircle2, tone: 'active'},
  partial: {icon: AlertTriangle, tone: 'warmup'},
  failed: {icon: XCircle, tone: 'ban'},
  cancelled: {icon: StopCircle, tone: 'neutral'},
};

// Marks everything on screen as read the moment the panel opens. A component
// rather than an effect in InboxBell because the Popover only renders its
// children while open -- mounting IS the "user looked at these" signal.
//
// Optimistic patch first, insert after: the rows are per-user and insert-only
// (markRead swallows duplicates), so the write cannot conflict with anything,
// and an offline failure merely resurfaces the dot on the next full load.
function MarkReadOnOpen({ids}: {ids: string[]}) {
  const {data} = useWorkspace();
  const {patch} = data;
  useEffect(() => {
    if (ids.length === 0) {
      return;
    }
    patch.notifications((list) =>
      list.map((item) => (ids.includes(item.id) ? {...item, read: true} : item)));
    void db.notifications.markRead(ids).catch(() => undefined);
    // Once, on open. `ids` is rebuilt every render and re-running on the patch
    // above would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function InboxBell({onViewAll, onOpenAutomationHistory}: {
  onViewAll: () => void;
  // Opens the run history of the automation a notification points at.
  onOpenAutomationHistory: (automationId: string) => void;
}) {
  const org = useOrg();
  const {data, shared, toast, reload} = useWorkspace();
  const {patch} = data;

  // Addressed to me, specifically. shared.pending holds the whole org's pending
  // offers -- handoffs_select is is_org_member and one read is cheaper than two
  // -- so the bell filters rather than the query. The ones I sent are somebody
  // else's decision and belong in the Team tab, not in my notifications.
  const mine = shared.pending.filter((item) => item.to_user === org.userId);
  const notifications = data.state.notifications;
  const unreadIds = notifications.filter((item) => !item.read).map((item) => item.id);

  // Hidden entirely when there is nothing at all, rather than shown empty --
  // an always-on bell in a busy topbar is one more thing to scan past. But
  // read notifications keep it visible WITHOUT a count: history stays
  // reachable, and the count only ever means "things you have not seen",
  // which is what makes it worth believing.
  if (mine.length === 0 && notifications.length === 0) {
    return null;
  }

  const count = mine.length + unreadIds.length;

  function nameOf(userId: string | null | undefined) {
    if (!userId) {
      return 'someone';
    }
    const member = data.state.members.find((item) => item.user_id === userId);
    if (!member) {
      return 'a former teammate';
    }
    return member.display_name || member.email.split('@')[0] || member.email;
  }

  function clear(notification: ArgusNotification) {
    // Any member may clear one -- the row is the workspace's, not anyone's.
    patch.notifications((list) => list.filter((item) => item.id !== notification.id));
    if (org.orgId) {
      void db.notifications.remove(org.orgId, [notification.id]).catch(() => undefined);
    }
  }

  return (
    <Popover
      label={count > 0 ? `${count} waiting for you` : 'Notifications'}
      panelClassName="inbox-pop"
      triggerClassName="ghost icon-button inbox-button"
      width={320}
      trigger={
        <>
          <Bell size={16} />
          {count > 0 && <span className="inbox-count">{count > 9 ? '9+' : count}</span>}
        </>
      }
    >
      {(close) => (
        <>
          <MarkReadOnOpen ids={unreadIds} />
          {mine.map((item) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <div className="inbox-item" key={item.id}>
                <div className="inbox-item-head">
                  <Icon size={14} />
                  <span className="inbox-item-name">{item.item_name}</span>
                </div>
                <span className="inbox-item-from">
                  {KIND_LABEL[item.kind]} · {nameOf(item.from_user)} wants you to take this over
                </span>
                {item.note && <p className="inbox-item-note">{item.note}</p>}
                <div className="inbox-item-actions">
                  <button
                    className="ghost"
                    onClick={() => {
                      if (org.orgId) {
                        void shared.decline(item.id, org.orgId);
                      }
                      if (mine.length === 1 && notifications.length === 0) {
                        close();
                      }
                    }}
                  >Decline</button>
                  <button
                    disabled={!org.orgId}
                    onClick={() => {
                      const orgId = org.orgId;
                      if (!orgId) {
                        return;
                      }
                      void shared.accept(item.id, orgId, reload).then((ok) => {
                        if (ok) {
                          // Named, because accepting changes a column on a tab
                          // the user is probably not looking at -- without this,
                          // Accept reads as a button that made something vanish.
                          toast.setMessage(`${item.item_name} is assigned to you`);
                        }
                      });
                      if (mine.length === 1 && notifications.length === 0) {
                        close();
                      }
                    }}
                  >Accept</button>
                </div>
              </div>
            );
          })}

          {mine.length > 0 && notifications.length > 0 && (
            <div className="inbox-divider" aria-hidden="true" />
          )}

          {notifications.map((item) => {
            const glyph = STATUS_GLYPH[item.status || ''] || {icon: Workflow, tone: 'neutral'};
            const Icon = glyph.icon;
            const openable = Boolean(item.automation_id);
            return (
              <div
                className={item.read ? 'inbox-item is-notification' :
                  'inbox-item is-notification is-unread'}
                key={item.id}
              >
                <div className="inbox-item-head">
                  <Icon className={`inbox-status is-${glyph.tone}`} size={14} />
                  {/* The title is the row's one action: it opens the run
                      history the notification is reporting on. A notification
                      whose automation has since been deleted has nowhere to
                      go, and renders as text rather than a button that does
                      nothing. */}
                  {openable ? (
                    <button
                      className="inbox-item-name inbox-item-open"
                      onClick={() => {
                        close();
                        onOpenAutomationHistory(item.automation_id as string);
                      }}
                      type="button"
                    >{item.title}</button>
                  ) : (
                    <span className="inbox-item-name">{item.title}</span>
                  )}
                  {!item.read && <span className="inbox-unread-dot" aria-label="Unread" />}
                  <button
                    aria-label={`Clear "${item.title}"`}
                    className="ghost icon-button inbox-item-clear"
                    onClick={() => clear(item)}
                    title="Clear this notification"
                    type="button"
                  ><X size={13} /></button>
                </div>
                <p className="inbox-item-note">{item.body}</p>
                <span className="inbox-item-from">
                  {nameOf(item.created_by)} ran it{item.created_at ?
                    ` · ${ago(item.created_at)}` : ''}
                </span>
              </div>
            );
          })}

          <div className="inbox-foot">
            <button className="ghost" onClick={() => {
              close();
              onViewAll();
            }}>View all</button>
          </div>
        </>
      )}
    </Popover>
  );
}
