import type { AgentDef, PaneConfig, Settings } from '@shared/types'

export interface Launch {
  command: string | null
  resumed: boolean
}

/**
 * Work out the command line for a pane. Claude Code panes pin a conversation id
 * with `--session-id` the first time and `--resume` it afterwards, so every pane
 * comes back to its own conversation after the app restarts.
 */
export async function buildLaunch(pane: PaneConfig, agent: AgentDef, settings: Settings): Promise<Launch> {
  if (agent.command === null) return { command: null, resumed: false }
  const command = agent.command.trim()
  if (agent.sessions === 'claude' && pane.sessionId && settings.resumeSessions) {
    const exists = await window.tpm.claude.sessionExists(pane.sessionId)
    return exists
      ? { command: `${command} --resume ${pane.sessionId}`, resumed: true }
      : { command: `${command} --session-id ${pane.sessionId}`, resumed: false }
  }
  return { command, resumed: false }
}
