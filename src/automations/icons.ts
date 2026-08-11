// Step glyphs, resolved from the name in step-schema.json.
//
// StepSpec.icon has been declared for all thirteen step types since the
// catalogue was written, and documented as "a lucide icon name, resolved by the
// editor" -- but nothing ever resolved it. The rows showed a text label where a
// glyph was meant to be.
//
// Keyed by the schema's string rather than by StepType on purpose. Keying it by
// StepType would give a compile-time exhaustiveness check, but it would also
// make adding a step type a FOUR-file job, and automations/types.ts promises
// three: a member of the union, an entry in the JSON, and an executor. A fourth
// place to forget is the drift this codebase keeps designing against. The cost
// of the string key is that a typo degrades to the fallback glyph instead of
// failing typecheck -- visible immediately in the editor, and harmless.
import {
  Camera,
  Circle,
  ClipboardList,
  Code,
  Cookie,
  GitBranch,
  Globe,
  Hourglass,
  Keyboard,
  Mouse,
  MousePointerClick,
  Repeat,
  ScanEye,
  Sparkles,
  Timer,
  Variable,
  Webhook,
  Workflow,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

const ICON_BY_NAME: Record<string, LucideIcon> = {
  'camera': Camera,
  'clipboard-list': ClipboardList,
  'code': Code,
  'cookie': Cookie,
  'git-branch': GitBranch,
  'globe': Globe,
  'hourglass': Hourglass,
  'keyboard': Keyboard,
  'mouse': Mouse,
  'mouse-pointer-click': MousePointerClick,
  'repeat': Repeat,
  'scan-eye': ScanEye,
  'sparkles': Sparkles,
  'timer': Timer,
  'variable': Variable,
  'webhook': Webhook,
  'workflow': Workflow,
};

export function stepIcon(name: string): LucideIcon {
  return ICON_BY_NAME[name] || Circle;
}
