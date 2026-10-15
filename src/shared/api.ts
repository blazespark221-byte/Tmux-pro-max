import type {
  CreateWorktreeRequest,
  CreateWorktreeResult,
  GitInfo,
  MenuAction,
  NotifyRequest,
  PathInfo,
  PersistedState,
  PtyExitEvent,
  SpawnRequest,
  SpawnResult
} from './types'

export interface AppInfo {
  platform: string
  homeDir: string
  version: string
  shell: string
  isDev: boolean
  /** Set by the e2e test harness (TPM_E2E=1) to expose read-only test hooks. */
  e2e: boolean
}

type Unsubscribe = () => void

/** The bridge the preload script exposes as `window.tpm`. */
export interface TpmApi {
  info: AppInfo
  pty: {
    spawn(req: SpawnRequest): Promise<SpawnResult>
    write(paneId: string, data: string): void
    resize(paneId: string, cols: number, rows: number): void
    ack(paneId: string, chars: number): void
    kill(paneId: string): Promise<void>
    alive(paneId: string): Promise<boolean>
    onData(cb: (batch: [paneId: string, data: string][]) => void): Unsubscribe
    onExit(cb: (event: PtyExitEvent) => void): Unsubscribe
  }
  state: {
    load(): Promise<PersistedState | null>
    save(state: PersistedState): void
    saveSync(state: PersistedState): void
  }
  agents: {
    detect(binaries: string[]): Promise<Record<string, boolean>>
  }
  git: {
    info(dir: string): Promise<GitInfo>
    createWorktree(req: CreateWorktreeRequest): Promise<CreateWorktreeResult>
    removeWorktree(repoRoot: string, worktreePath: string): Promise<{ ok: true } | { ok: false; error: string }>
  }
  claude: {
    sessionExists(sessionId: string): Promise<boolean>
  }
  dialog: {
    pickFolder(defaultPath?: string): Promise<string | null>
  }
  path: {
    info(p: string): Promise<PathInfo>
    forFile(file: File): string
  }
  shell: {
    openExternal(url: string): void
    showItemInFolder(p: string): void
    openPath(p: string): void
  }
  clipboard: {
    read(): Promise<string>
    write(text: string): void
  }
  notify(req: NotifyRequest): void
  setBadge(count: number): void
  flashFrame(): void
  onMenuAction(cb: (action: MenuAction) => void): Unsubscribe
  onFocusPane(cb: (target: { workspaceId: string; paneId: string }) => void): Unsubscribe
  onWindowFocus(cb: (focused: boolean) => void): Unsubscribe
}
