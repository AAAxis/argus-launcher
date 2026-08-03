import {Bot, Hexagon, SquareTerminal, Waypoints} from 'lucide-react';
import claudeCodeLogo from '../assets/claude-code.svg';
import codexLogo from '../assets/codex.svg';
import cursorLogo from '../assets/cursor.svg';
import openclawLogo from '../assets/openclaw.svg';

export type IntegrationId = 'hive' | 'claude-code' | 'codex' | 'openclaw' | 'cursor';

export type Integration = {
  id: IntegrationId;
  name: string;
  description: string;
  icon: typeof Hexagon;
  logo?: string;
  // Which theme the mark has to be inverted in. A single-colour mark only reads
  // on the background it was drawn for: Codex's is near-black (#111) so it
  // disappears on a dark surface, Cursor's is near-white (#edecec) so it
  // disappears on a light one. They therefore invert in opposite themes, which
  // one boolean could not express.
  invertOn?: 'dark' | 'light';
  // What the connect flow writes, in the user's words. Shown in the dialog
  // before anything is touched, so "one click and it edited a file in my home
  // directory" is never a surprise.
  configLabel: string;
  // Ordered steps for the dialog's "How it works".
  steps: string[];
};

export const INTEGRATIONS: Integration[] = [
  {
    id: 'hive',
    name: 'Hive',
    description: 'Multi-agent runtime -- run QA/monitoring sweeps across many profiles in parallel.',
    icon: Hexagon,
    configLabel: 'argus-hive-bridge/.env (copied by hand)',
    steps: [
      'Anty creates an API key scoped to the folders you pick.',
      'You copy the key into argus-hive-bridge/.env as ARGYS_API_TOKEN -- Hive has no config file for Anty to write.',
      'Hive then drives your profiles: launch, navigate, read, screenshot, close.',
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's coding agent CLI -- drive profiles as MCP tools from any project.",
    icon: Bot,
    logo: claudeCodeLogo,
    configLabel: '~/.claude.json',
    steps: [
      'Anty creates an API key scoped to the folders you pick.',
      'It writes an "argus" MCP server into ~/.claude.json, carrying that key.',
      'Restart Claude Code. Your profiles appear as tools: launch, navigate, read, screenshot, close.',
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    description: "OpenAI's coding agent CLI -- same MCP tools, wired into Codex's own config.",
    icon: SquareTerminal,
    logo: codexLogo,
    invertOn: 'dark',
    configLabel: '~/.codex/config.toml',
    steps: [
      'Anty creates an API key scoped to the folders you pick.',
      'It writes an [mcp_servers.argus] table into ~/.codex/config.toml, carrying that key.',
      'Restart Codex. Your profiles appear as tools: launch, navigate, read, screenshot, close.',
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'The AI editor -- same MCP tools, registered in Cursor\'s global MCP config.',
    icon: SquareTerminal,
    logo: cursorLogo,
    invertOn: 'light',
    configLabel: '~/.cursor/mcp.json',
    steps: [
      'Anty creates an API key scoped to the folders you pick.',
      'It writes an "argus" MCP server into ~/.cursor/mcp.json, carrying that key.',
      'Reload Cursor. Your profiles appear as tools: launch, navigate, read, screenshot, close.',
    ],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'Personal AI assistant gateway across chat channels -- same MCP tools, wired into its own config.',
    icon: Waypoints,
    logo: openclawLogo,
    configLabel: '~/.openclaw/openclaw.json',
    steps: [
      'Anty creates an API key scoped to the folders you pick.',
      'It writes an "argus" MCP server into ~/.openclaw/openclaw.json, carrying that key.',
      'Restart OpenClaw. Your profiles appear as tools: launch, navigate, read, screenshot, close.',
    ],
  },
];

export function findIntegration(id: string | null | undefined): Integration | undefined {
  return INTEGRATIONS.find((item) => item.id === id);
}
