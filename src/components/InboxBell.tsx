// The topbar bell: what a teammate has handed you, and the two buttons that
// answer it.
//
// It lives in the Topbar rather than as a tenth sidebar tab because this is
// empty almost all of the time, and a permanent nav entry that says nothing on
// 364 days a year trains people to stop looking at it. A bell with no count is
// quiet; a bell with a count is not.
//
// Accept and Decline are both here, inline, rather than only on a detail page.
// The decision needs the sender, the kind and the note -- all of which fit --
// and an offer that can only be answered two clicks away is one that sits
// unanswered.
import {Bell, Cookie, Monitor, Waypoints, Workflow} from 'lucide-react';
import {Popover} from './ui/Popover';
import {useOrg} from '../org';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import type {HandoffKind} from '../types';

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

export function InboxBell({onViewAll}: {onViewAll: () => void}) {
  const org = useOrg();
  const {data, shared, toast, reload} = useWorkspace();

  // Addressed to me, specifically. shared.pending holds the whole org's pending
  // offers -- handoffs_select is is_org_member and one read is cheaper than two
  // -- so the bell filters rather than the query. The ones I sent are somebody
  // else's decision and belong in the Team tab, not in my notifications.
  const mine = shared.pending.filter((item) => item.to_user === org.userId);

  // Hidden entirely when there is nothing, rather than shown empty. An
  // always-on bell in a busy topbar is one more thing to scan past; this
  // appears only when it has something to say, which is what makes the count
  // worth believing.
  //
  // The trade-off, stated plainly: there is no way to browse an empty inbox
  // from here. Team -> Shared is the durable surface for that, and it is always
  // reachable.
  if (mine.length === 0) {
    return null;
  }

  function nameOf(userId: string | null) {
    if (!userId) {
      return 'someone';
    }
    const member = data.state.members.find((item) => item.user_id === userId);
    if (!member) {
      return 'a former teammate';
    }
    return member.display_name || member.email.split('@')[0] || member.email;
  }

  return (
    <Popover
      label={`${mine.length} waiting for you`}
      panelClassName="inbox-pop"
      triggerClassName="ghost icon-button inbox-button"
      width={320}
      trigger={
        <>
          <Bell size={16} />
          <span className="inbox-count">{mine.length > 9 ? '9+' : mine.length}</span>
        </>
      }
    >
      {(close) => (
        <>
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
                      if (mine.length === 1) {
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
                      if (mine.length === 1) {
                        close();
                      }
                    }}
                  >Accept</button>
                </div>
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
