import type { AgentDef, Settings } from './types'

export const SHELL_AGENT_ID = 'shell'

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    color: '#d97757',
    glyph: 'CC',
    sessions: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    builtin: true
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    color: '#9aa5ff',
    glyph: 'CX',
    installHint: 'npm install -g @openai/codex',
    builtin: true
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    color: '#5aa9ff',
    glyph: 'GM',
    installHint: 'npm install -g @google/gemini-cli',
    builtin: true
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    color: '#e5e7eb',
    glyph: 'OC',
    installHint: 'npm install -g opencode-ai',
    builtin: true
  },
  {
    id: 'amp',
    name: 'Amp',
    command: 'amp',
    color: '#f4a261',
    glyph: 'AM',
    installHint: 'npm install -g @sourcegraph/amp',
    builtin: true
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    color: '#c7d2fe',
    glyph: 'CA',
    installHint: 'curl https://cursor.com/install -fsS | bash',
    builtin: true
  },
  {
    id: 'copilot',
    name: 'Copilot CLI',
    command: 'copilot',
    color: '#b38cff',
    glyph: 'CP',
    installHint: 'npm install -g @github/copilot',
    builtin: true
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    color: '#4ade80',
    glyph: 'AI',
    installHint: 'python -m pip install aider-install && aider-install',
    builtin: true
  },
  {
    id: SHELL_AGENT_ID,
    name: 'Terminal',
    command: null,
    color: '#8b929c',
    glyph: '>_',
    builtin: true
  }
]

/** All agents available to the user: built-ins (with command overrides applied) followed by custom ones. */
export function resolveAgents(settings: Pick<Settings, 'agentCommandOverrides' | 'customAgents'>): AgentDef[] {
  const builtins = BUILTIN_AGENTS.map((agent) => {
    const override = settings.agentCommandOverrides[agent.id]
    return override && agent.command !== null ? { ...agent, command: override } : agent
  })
  return [...builtins, ...settings.customAgents]
}

export function findAgent(agents: AgentDef[], id: string): AgentDef {
  return (
    agents.find((a) => a.id === id) ?? agents.find((a) => a.id === SHELL_AGENT_ID) ?? BUILTIN_AGENTS[BUILTIN_AGENTS.length - 1]
  )
}

/** First word of a command line, used to check whether the agent is installed. */
export function commandBinary(command: string | null): string | null {
  if (!command) return null
  const tokens = command.trim().split(/\s+/)
  // Skip leading VAR=value assignments.
  const bin = tokens.find((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))
  return bin ?? null
}
