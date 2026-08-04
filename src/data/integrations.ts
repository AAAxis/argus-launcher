import {Bot, Code, Hexagon, PanelsTopLeft, Plug, SquareTerminal, Waypoints, Wind} from 'lucide-react';
import claudeCodeLogo from '../assets/claude-code.svg';
import codexLogo from '../assets/codex.svg';
import cursorLogo from '../assets/cursor.svg';
import openclawLogo from '../assets/openclaw.svg';

export type IntegrationId =
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'openclaw'
  | 'gemini-cli'
  | 'windsurf'
  | 'vscode'
  | 'zed'
  | 'hive'
  | 'other';

// Sections on the tab. 'manual' is not a lesser category -- it is the honest
// one: those two have no config file this app can write, so connecting them
// means handing over a snippet rather than pretending to wire them up.
export type IntegrationCategory = 'agent' | 'automation' | 'manual';

export type Integration = {
  id: IntegrationId;
  name: string;
  description: string;
  category: IntegrationCategory;
  icon: typeof Hexagon;
  logo?: string;
  // Which theme the mark has to be inverted in. A single-colour mark only reads
  // on the background it was drawn for: Codex's is near-black (#111) so it
  // disappears on a dark surface, Cursor's is near-white (#edecec) so it
  // disappears on a light one. They therefore invert in opposite themes, which
  // one boolean could not express.
  invertOn?: 'dark' | 'light';
  // What the connect flow writes, in the user's words. Shown before anything is
  // touched, so "one click and it edited a file in my home directory" is never
  // a surprise.
  configLabel: string;
  // What the user has to do after connecting, if anything. Every one of these
  // tools reads its MCP config at process start and there is no reload signal
  // we can send, so this is always some form of "restart it".
  restartLabel: string;
};

// Ordered as they appear on the tab. Claude Code first because it is the one
// most of these users already have.
export const INTEGRATIONS: Integration[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's coding agent CLI. Drive profiles as tools from any project.",
    category: 'agent',
    icon: Bot,
    logo: claudeCodeLogo,
    configLabel: '~/.claude.json',
    restartLabel: 'Restart Claude Code',
  },
  {
    id: 'codex',
    name: 'Codex',
    description: "OpenAI's coding agent CLI. Same tools, wired into Codex's own config.",
    category: 'agent',
    icon: SquareTerminal,
    logo: codexLogo,
    invertOn: 'dark',
    configLabel: '~/.codex/config.toml',
    restartLabel: 'Restart Codex',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: "The AI editor. Registered in Cursor's global MCP config.",
    category: 'agent',
    icon: SquareTerminal,
    logo: cursorLogo,
    invertOn: 'light',
    configLabel: '~/.cursor/mcp.json',
    restartLabel: 'Reload Cursor',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: "Google's coding agent CLI. Same tools, in its own settings file.",
    category: 'agent',
    icon: Code,
    configLabel: '~/.gemini/settings.json',
    restartLabel: 'Restart Gemini CLI',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'The Codeium editor. Registered for Cascade to use.',
    category: 'agent',
    icon: Wind,
    configLabel: '~/.codeium/windsurf/mcp_config.json',
    restartLabel: 'Reload Windsurf',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Agent mode in Visual Studio Code, through its user MCP config.',
    category: 'agent',
    icon: PanelsTopLeft,
    configLabel: 'Code/User/mcp.json',
    restartLabel: 'Reload VS Code',
  },
  {
    id: 'zed',
    name: 'Zed',
    description: "Zed's agent panel, through its context server settings.",
    category: 'agent',
    icon: Code,
    configLabel: '~/.config/zed/settings.json',
    restartLabel: 'Restart Zed',
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'Personal assistant gateway across chat channels.',
    category: 'automation',
    icon: Waypoints,
    logo: openclawLogo,
    configLabel: '~/.openclaw/openclaw.json',
    restartLabel: 'Restart OpenClaw',
  },
  {
    id: 'hive',
    name: 'Hive',
    description: 'Multi-agent runtime. Run QA and monitoring sweeps across many profiles at once.',
    category: 'manual',
    icon: Hexagon,
    configLabel: 'its own .env',
    restartLabel: 'Restart Hive',
  },
  {
    id: 'other',
    name: 'Any other MCP client',
    description: 'Anything that speaks MCP. Copy the server block into its config yourself.',
    category: 'manual',
    icon: Plug,
    configLabel: 'whatever your client reads',
    restartLabel: 'Restart your client',
  },
];

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  agent: 'Coding agents',
  automation: 'Automation',
  manual: 'Set up by hand',
};

export const CATEGORY_ORDER: IntegrationCategory[] = ['agent', 'automation', 'manual'];

export function findIntegration(id: string | null | undefined): Integration | undefined {
  return INTEGRATIONS.find((item) => item.id === id);
}

// The tools an agent gets once connected. Listed in the dialog so the value of
// connecting is visible before you do it, and kept in step with
// electron/mcp/tools.cjs by hand -- nothing compiles electron/, so they cannot
// share a module.
export const MCP_TOOL_SUMMARY = [
  'List, read and update profiles',
  'Launch and close a profile session',
  'Navigate, read page text and screenshot',
  'List and assign proxies',
];
