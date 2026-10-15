// Types shared between the main process, preload bridge and renderer.

export type SplitDirection = 'row' | 'column'

export type LayoutNode = PaneLeaf | SplitNode

export interface PaneLeaf {
  type: 'pane'
  paneId: string
}

export interface SplitNode {
  type: 'split'
  id: string
  /** `row` lays children out left→right, `column` top→bottom. */
  direction: SplitDirection
  children: LayoutNode[]
  /** Fractions that sum to 1, one per child. */
  sizes: number[]
}

export interface AgentDef {
  id: string
  name: string
  /** Shell command line used to launch the agent. `null` launches the user's login shell. */
  command: string | null
  color: string
  /** Short label rendered in the agent badge. */
  glyph: string
  installHint?: string
  /** Agent supports pinning a conversation id so a pane can resume it after restarts. */
  sessions?: 'claude'
  builtin?: boolean
}

export interface WorktreeInfo {
  path: string
  branch: string
  repoRoot: string
}

export interface PaneConfig {
  id: string
  agentId: string
  cwd: string
  /** Conversation id for agents that support resuming (Claude Code). */
  sessionId?: string
  worktree?: WorktreeInfo
}

export interface Workspace {
  id: string
  name: string
  cwd: string
  layout: LayoutNode
  panes: Record<string, PaneConfig>
  focusedPaneId: string | null
  zoomedPaneId: string | null
}

export interface Settings {
  fontFamily: string
  fontSize: number
  lineHeight: number
  scrollback: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  defaultAgentId: string
  shiftEnterNewline: boolean
  notifications: boolean
  confirmClosePane: boolean
  resumeSessions: boolean
  macOptionIsMeta: boolean
  agentCommandOverrides: Record<string, string>
  customAgents: AgentDef[]
  recentFolders: string[]
}

export interface PersistedState {
  version: 1
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  settings: Settings
  sidebarWidth?: number
}

// ---- IPC payloads -------------------------------------------------------

export interface SpawnRequest {
  paneId: string
  cwd: string
  /** Shell command line to run; `null` starts an interactive login shell. */
  command: string | null
  cols: number
  rows: number
  env?: Record<string, string>
}

export type SpawnResult = { ok: true; pid: number; attached: boolean; replay: string; cwd: string } | { ok: false; error: string }

export interface PtyExitEvent {
  paneId: string
  exitCode: number
  signal?: number
}

export interface GitInfo {
  isRepo: boolean
  root?: string
  branch?: string
}

export interface CreateWorktreeRequest {
  repoRoot: string
  branchHint: string
}

export type CreateWorktreeResult = { ok: true; worktree: WorktreeInfo } | { ok: false; error: string }

export interface NotifyRequest {
  title: string
  body: string
  workspaceId: string
  paneId: string
}

export interface PathInfo {
  exists: boolean
  isDirectory: boolean
  resolved: string
}

export type MenuAction =
  | 'new-workspace'
  | 'close-workspace'
  | 'split-right'
  | 'split-down'
  | 'close-pane'
  | 'zoom-pane'
  | 'restart-pane'
  | 'focus-left'
  | 'focus-right'
  | 'focus-up'
  | 'focus-down'
  | 'next-pane'
  | 'prev-pane'
  | 'next-workspace'
  | 'prev-workspace'
  | 'toggle-broadcast'
  | 'toggle-sidebar'
  | 'settings'
  | 'font-bigger'
  | 'font-smaller'
  | 'font-reset'
  | 'find'
  | 'copy'
  | 'paste'
  | 'clear'
  | 'shortcuts'
  | `workspace-${number}`
