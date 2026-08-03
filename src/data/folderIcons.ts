// The icons a folder can be given, keyed by a short stable name.
//
// The key is what goes in folders.icon, not an SVG or a URL -- so the stored
// value stays a dozen bytes, survives an icon-library swap, and can never carry
// markup. Anything unrecognized resolves to the plain folder glyph, which means
// dropping an entry from this list downgrades old folders instead of crashing
// them.
import {
  Bot, Briefcase, Building2, Flame, Folder, Globe, Megaphone, Rocket,
  ShoppingCart, Star, Users, Wallet,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

export const FOLDER_ICONS: {key: string; label: string; icon: LucideIcon}[] = [
  {key: 'folder', label: 'Folder', icon: Folder},
  {key: 'users', label: 'Team', icon: Users},
  {key: 'briefcase', label: 'Work', icon: Briefcase},
  {key: 'cart', label: 'Commerce', icon: ShoppingCart},
  {key: 'megaphone', label: 'Ads', icon: Megaphone},
  {key: 'rocket', label: 'Launch', icon: Rocket},
  {key: 'star', label: 'Priority', icon: Star},
  {key: 'flame', label: 'Warmup', icon: Flame},
  {key: 'building', label: 'Client', icon: Building2},
  {key: 'wallet', label: 'Finance', icon: Wallet},
  {key: 'bot', label: 'Automation', icon: Bot},
  {key: 'globe', label: 'Region', icon: Globe},
];

export const DEFAULT_FOLDER_ICON = 'folder';

export function folderIcon(key?: string | null): LucideIcon {
  return FOLDER_ICONS.find((entry) => entry.key === key)?.icon || Folder;
}
