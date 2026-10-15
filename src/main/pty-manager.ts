import { existsSync, statSync } from 'node:fs'
import os from 'node:os'
import * as pty from 'node-pty'
import type { IDisposable, IPty } from 'node-pty'
import type { PtyExitEvent, SpawnRequest, SpawnResult } from '@shared/types'
import { defaultShell, expandHome, findExecutable } from './shell-env'

/** Something that can receive IPC events, i.e. a WebContents. */
export interface PtySink {
  send(channel: string, ...args: unknown[]): void
  isDestroyed(): boolean
}

interface Session {
  pty: IPty
  disposables: IDisposable[]
  /** Recent output so a reloaded/reopened window can repaint the pane. */
  history: string
  unacked: number
  paused: boolean
  cols: number
  rows: number
}

const HISTORY_LIMIT = 400_000
const FLOW_HIGH_WATERMARK = 400_000
const FLOW_LOW_WATERMARK = 100_000
const FLUSH_INTERVAL_MS = 5

export class PtyManager {
  private sessions = new Map<string, Session>()
  private pending = new Map<string, string>()
  private flushTimer: NodeJS.Timeout | null = null
  private sink: PtySink | null = null

  constructor(
    private readonly getEnv: () => Promise<Record<string, string>>,
    private readonly appVersion: string
  ) {}

  setSink(sink: PtySink | null): void {
    this.sink = sink
    // A new window starts with a clean slate for flow control.
    for (const session of this.sessions.values()) {
      session.unacked = 0
      if (session.paused) {
        session.paused = false
        session.pty.resume()
      }
    }
  }

  has(paneId: string): boolean {
    return this.sessions.has(paneId)
  }

  async spawn(req: SpawnRequest): Promise<SpawnResult> {
    const existing = this.sessions.get(req.paneId)
    if (existing) return this.attach(req, existing)

    const env = await this.getEnv()
    // The session may have been created while we were awaiting the environment.
    const raced = this.sessions.get(req.paneId)
    if (raced) return this.attach(req, raced)

    let cwd = expandHome(req.cwd || os.homedir())
    let cwdNote = ''
    try {
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error('missing')
    } catch {
      cwdNote = `\x1b[33m[tmux-pro-max] folder ${cwd} does not exist, starting in home directory\x1b[0m\r\n`
      cwd = os.homedir()
    }

    const childEnv: Record<string, string> = {
      ...env,
      ...(req.env ?? {}),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'TmuxProMax',
      TERM_PROGRAM_VERSION: this.appVersion
    }

    const { file, args } = this.commandLine(req.command, childEnv)
    const cols = Math.max(2, Math.floor(req.cols) || 80)
    const rows = Math.max(1, Math.floor(req.rows) || 24)

    let proc: IPty
    try {
      proc = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: childEnv,
        encoding: 'utf8'
      })
    } catch (err) {
      return { ok: false, error: `Failed to start ${req.command ?? 'shell'}: ${(err as Error).message}` }
    }

    const session: Session = { pty: proc, disposables: [], history: '', unacked: 0, paused: false, cols, rows }
    this.sessions.set(req.paneId, session)
    if (cwdNote) this.onData(req.paneId, session, cwdNote)

    session.disposables.push(
      proc.onData((data) => this.onData(req.paneId, session, data)),
      proc.onExit(({ exitCode, signal }) => {
        if (this.sessions.get(req.paneId) !== session) return
        this.flush()
        this.sessions.delete(req.paneId)
        session.disposables.forEach((d) => d.dispose())
        const event: PtyExitEvent = { paneId: req.paneId, exitCode, signal }
        this.emit('pty:exit', event)
      })
    )

    return { ok: true, pid: proc.pid, attached: false, replay: '', cwd }
  }

  private attach(req: SpawnRequest, session: Session): SpawnResult {
    // Everything pending is already part of the history we are about to replay.
    this.pending.delete(req.paneId)
    session.unacked = 0
    if (session.paused) {
      session.paused = false
      session.pty.resume()
    }
    const cols = Math.max(2, Math.floor(req.cols) || session.cols)
    const rows = Math.max(1, Math.floor(req.rows) || session.rows)
    // Nudge full-screen programs (agents' TUIs) into repainting for the new view.
    try {
      session.pty.resize(Math.max(2, cols - 1), rows)
      setTimeout(() => this.resize(req.paneId, cols, rows), 60)
    } catch {
      // process may be exiting
    }
    return { ok: true, pid: session.pty.pid, attached: true, replay: session.history, cwd: req.cwd }
  }

  private commandLine(command: string | null, env: Record<string, string>): { file: string; args: string[] | string } {
    if (process.platform === 'win32') {
      if (command === null) {
        const pwsh = findExecutable('pwsh', env)
        return { file: pwsh ?? 'powershell.exe', args: ['-NoLogo'] }
      }
      return { file: env.COMSPEC || 'cmd.exe', args: `/d /s /c "${command}"` }
    }
    const shell = defaultShell()
    if (command === null) return { file: shell, args: ['-l'] }
    return { file: shell, args: ['-c', command] }
  }

  private onData(paneId: string, session: Session, data: string): void {
    session.history += data
    if (session.history.length > HISTORY_LIMIT) {
      let cut = session.history.length - HISTORY_LIMIT
      // Prefer to cut at a line boundary so we don't start mid escape sequence.
      const nl = session.history.indexOf('\n', cut)
      if (nl >= 0 && nl - cut < 4096) cut = nl + 1
      session.history = session.history.slice(cut)
    }

    if (this.sink && !this.sink.isDestroyed()) {
      this.pending.set(paneId, (this.pending.get(paneId) ?? '') + data)
      session.unacked += data.length
      if (!session.paused && session.unacked > FLOW_HIGH_WATERMARK) {
        session.paused = true
        session.pty.pause()
      }
      if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pending.size === 0) return
    const batch = [...this.pending.entries()]
    this.pending.clear()
    this.emit('pty:data', batch)
  }

  private emit(channel: string, payload: unknown): void {
    if (this.sink && !this.sink.isDestroyed()) this.sink.send(channel, payload)
  }

  write(paneId: string, data: string): void {
    this.sessions.get(paneId)?.pty.write(data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    const session = this.sessions.get(paneId)
    if (!session) return
    cols = Math.max(2, Math.floor(cols))
    rows = Math.max(1, Math.floor(rows))
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return
    session.cols = cols
    session.rows = rows
    try {
      session.pty.resize(cols, rows)
    } catch {
      // The process may have exited between the check and the call.
    }
  }

  ack(paneId: string, chars: number): void {
    const session = this.sessions.get(paneId)
    if (!session) return
    session.unacked = Math.max(0, session.unacked - chars)
    if (session.paused && session.unacked < FLOW_LOW_WATERMARK) {
      session.paused = false
      session.pty.resume()
    }
  }

  kill(paneId: string): void {
    const session = this.sessions.get(paneId)
    if (!session) return
    this.sessions.delete(paneId)
    this.pending.delete(paneId)
    session.disposables.forEach((d) => d.dispose())
    terminate(session.pty)
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  count(): number {
    return this.sessions.size
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function terminate(proc: IPty): void {
  const pid = proc.pid
  if (process.platform === 'win32') {
    try {
      proc.kill()
    } catch {
      // already exited
    }
    return
  }
  // node-pty starts each child in its own session, so the pid is also the
  // process group id. Hang up the whole group like closing a terminal would.
  try {
    process.kill(-pid, 'SIGHUP')
  } catch {
    try {
      proc.kill('SIGHUP')
    } catch {
      // already exited
    }
  }
  const timer = setTimeout(() => {
    if (!alive(pid)) return
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // gone
      }
    }
  }, 3000)
  timer.unref()
}
