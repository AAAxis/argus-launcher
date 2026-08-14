import {
  Bot, Cookie, LayoutGrid, Monitor, Plug, Sparkles, Users, Waypoints, Workflow,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {showsPlanPicker} from '../plans';

export type TabId = 'profiles' | 'proxies' | 'cookies' | 'startPage' | 'automations' |
  'extensions' | 'integrations' | 'team' | 'plans';

export const tabs: Array<{id: TabId; label: string; icon: LucideIcon}> = [
  {id: 'profiles', label: 'Profiles', icon: Monitor},
  {id: 'proxies', label: 'Proxies', icon: Waypoints},
  {id: 'cookies', label: 'Cookies', icon: Cookie},
  {id: 'startPage', label: 'Start page', icon: LayoutGrid},
  {id: 'automations', label: 'Automations', icon: Workflow},
  {id: 'extensions', label: 'Extensions', icon: Plug},
  // No API tab: the API reference and key management live on the website, and
  // the Integrations tab carries the link (SITE_LINKS.api).
  {id: 'integrations', label: 'Integrations', icon: Bot},
  // Shown to everyone rather than hidden behind the plan: a single-seat org gets
  // the upsell hero instead of a roster, which is how someone on Base finds out
  // that a team is what the next tier buys. A tab that only appears once you
  // have paid cannot be the reason you pay.
  {id: 'team', label: 'Team', icon: Users},
  // The exception to that, and last for the same reason it is an exception: this
  // tab IS the buying screen, so it has nothing to say to a workspace that has
  // already bought. See visibleTabs below.
  {id: 'plans', label: 'Plans', icon: Sparkles},
];

// The sidebar's list, which is `tabs` minus anything this workspace has no use
// for. Pass the org's plan, or undefined while it is still loading -- see
// showsPlanPicker in src/plans.ts for why undefined must hide the tab rather
// than show it.
//
// Callers that resolve a tab id to a label (the topbar title) should read `tabs`
// instead: a title looked up in this list would go missing for the frame between
// a plan landing and the tab switching away from itself.
export function visibleTabs(plan: string | null | undefined) {
  return tabs.filter((tab) => tab.id !== 'plans' || showsPlanPicker(plan));
}
