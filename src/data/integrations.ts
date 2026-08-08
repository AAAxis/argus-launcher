import {Bot, Code, Hexagon, PanelsTopLeft, Plug, SquareTerminal, Waypoints, Wind} from 'lucide-react';
import claudeCodeLogo from '../assets/claude-code.svg';
import codexLogo from '../assets/codex.svg';
import cursorLogo from '../assets/cursor.svg';
import geminiCliLogo from '../assets/gemini-cli.svg';
import mcpLogo from '../assets/mcp.svg';
import openclawLogo from '../assets/openclaw.svg';
import vscodeLogo from '../assets/vscode.svg';
import windsurfLogo from '../assets/windsurf.svg';
import zedLogo from '../assets/zed.svg';

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
  // disappears on a dark surface, while Cursor's (#edecec) and the white-only
  // cuts of Zed, Windsurf and the MCP mark disappear on a light one. They
  // therefore invert in opposite themes, which one boolean could not express.
  // Marks that carry their own colours -- Claude Code, Gemini CLI, VS Code,
  // OpenClaw -- name neither and are left alone.
  invertOn?: 'dark' | 'light';
  // What the connect flow writes, in the user's words. Shown before anything is
  // touched, so "one click and it edited a file in my home directory" is never
  // a surprise.
  configLabel: string;
  // What the user has to do after connecting, if anything. Every one of these
  // tools reads its MCP config at process start and there is no reload signal
  // we can send, so this is always some form of "restart it".
  restartLabel: string;
  // Where that tool shows its MCP servers, so the user can confirm from the
  // other side instead of taking this app's word for it. Deliberately per-tool:
  // a generic "check its MCP settings" sends people hunting through preferences,
  // and the one thing they want after a restart is the sentence that ends the
  // question. Where a tool has a literal command for it, the command is quoted.
  confirmLabel: string;
  // Only for `category: 'manual'` -- the shape of the thing the user pastes.
  // Hive reads environment variables out of its own .env; a generic MCP client
  // wants the server block. Same key either way, two very different files.
  manualFormat?: 'env' | 'mcp';
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
    confirmLabel: 'Then run /mcp in any project — argus should be in the list.',
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
    confirmLabel: 'Codex reads its MCP servers at startup — ask it what tools it has and the argus ones should be there.',
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
    confirmLabel: 'Then open Cursor Settings → MCP: argus should be listed and switched on.',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    description: "Google's coding agent CLI. Same tools, in its own settings file.",
    category: 'agent',
    icon: Code,
    logo: geminiCliLogo,
    configLabel: '~/.gemini/settings.json',
    restartLabel: 'Restart Gemini CLI',
    confirmLabel: 'Then run /mcp — argus should be in the list.',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'The Codeium editor. Registered for Cascade to use.',
    category: 'agent',
    icon: Wind,
    logo: windsurfLogo,
    invertOn: 'light',
    configLabel: '~/.codeium/windsurf/mcp_config.json',
    restartLabel: 'Reload Windsurf',
    confirmLabel: 'Then open Cascade’s plugin panel: argus should be listed there.',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Agent mode in Visual Studio Code, through its user MCP config.',
    category: 'agent',
    icon: PanelsTopLeft,
    logo: vscodeLogo,
    configLabel: 'Code/User/mcp.json',
    restartLabel: 'Reload VS Code',
    confirmLabel: 'Then switch Chat to Agent mode and open the tools picker — the argus tools should be listed.',
  },
  {
    id: 'zed',
    name: 'Zed',
    description: "Zed's agent panel, through its context server settings.",
    category: 'agent',
    icon: Code,
    logo: zedLogo,
    invertOn: 'light',
    configLabel: '~/.config/zed/settings.json',
    restartLabel: 'Restart Zed',
    confirmLabel: 'Then check the agent panel’s settings: argus should appear under context servers.',
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
    confirmLabel: 'It loads its config at startup — argus should show up among its tools.',
  },
  {
    id: 'hive',
    name: 'Hive',
    description: 'Multi-agent runtime. Run QA and monitoring sweeps across many profiles at once.',
    category: 'manual',
    icon: Hexagon,
    configLabel: 'its own .env',
    restartLabel: 'Restart Hive',
    confirmLabel: 'Hive reads the .env at startup — its first sweep will use this key.',
    manualFormat: 'env',
  },
  {
    id: 'other',
    name: 'Any other MCP client',
    description: 'Anything that speaks MCP. Copy the server block into its config yourself.',
    category: 'manual',
    icon: Plug,
    // The protocol's own mark rather than a vendor's -- this card is the one
    // that stands for every client we have not named.
    logo: mcpLogo,
    invertOn: 'light',
    configLabel: 'whatever your client reads',
    restartLabel: 'Restart your client',
    confirmLabel: 'Your client should list argus among its MCP servers once it is back up.',
    manualFormat: 'mcp',
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
  'Create, read, update and trash profiles',
  'Set a profile\'s proxy mode and fingerprint',
  'Launch and close a profile session',
  'Navigate, read page text and screenshot',
  'List and assign proxies',
];
