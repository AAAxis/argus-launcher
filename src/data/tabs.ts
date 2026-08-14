import {
  Bot, Cookie, LayoutGrid, Monitor, Plug, Users, Waypoints, Workflow,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

export type TabId = 'profiles' | 'proxies' | 'cookies' | 'startPage' | 'automations' |
  'extensions' | 'integrations' | 'team';

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
  // No Plans tab: plans live in Settings > Plan & usage, which links out to the
  // website for pricing and checkout.
];
