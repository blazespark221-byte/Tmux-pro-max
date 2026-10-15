import type { Terminal } from '@xterm/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import { activity } from './activity'
import { patchPane } from '../store/runtime'

// Registry of live xterm instances keyed by pane id, plus the single place where
// PTY output from the main process is routed to them. Output never goes
// through React state, so busy agents don't cause re-renders.

export interface TerminalHandle {
  paneId: string
  term: Terminal
  search: SearchAddon
  /** False until the pane's spawn/attach call has returned; output is queued meanwhile. */
  ready: boolean
}

const handles = new Map<string, TerminalHandle>()
/** Output that arrived before the pane's terminal was mounted. */
const early = new Map<string, string[]>()
const pendingAcks = new Map<string, number>()
let ackTimer: ReturnType<typeof setTimeout> | null = null
let initialized = false

function scheduleAck(paneId: string, chars: number): void {
  pendingAcks.set(paneId, (pendingAcks.get(paneId) ?? 0) + chars)
  if (ackTimer) return
  ackTimer = setTimeout(() => {
    ackTimer = null
    for (const [id, n] of pendingAcks) window.tpm.pty.ack(id, n)
    pendingAcks.clear()
  }, 25)
}

function deliver(paneId: string, data: string): void {
  const handle = handles.get(paneId)
  if (!handle || !handle.ready) {
    const queue = early.get(paneId) ?? []
    queue.push(data)
    early.set(paneId, queue)
    return
  }
  handle.term.write(data, () => scheduleAck(paneId, data.length))
}

export function initTerminalRouting(): void {
  if (initialized) return
  initialized = true
  window.tpm.pty.onData((batch) => {
    for (const [paneId, data] of batch) {
      activity.onOutput(paneId)
      deliver(paneId, data)
    }
  })
  window.tpm.pty.onExit(({ paneId, exitCode }) => {
    patchPane(paneId, { status: 'exited', exitCode, attention: false })
    activity.onExit(paneId, exitCode)
  })
}

export function registerTerminal(handle: TerminalHandle): void {
  handles.set(handle.paneId, handle)
}

/**
 * Start streaming output into the terminal. When re-attaching to a running
 * process the replayed history already contains anything queued, so the queue
 * is dropped instead of written twice.
 */
export function markReady(handle: TerminalHandle, discardQueued: boolean): void {
  handle.ready = true
  const queued = early.get(handle.paneId)
  early.delete(handle.paneId)
  if (!queued || discardQueued) return
  for (const chunk of queued) handle.term.write(chunk, () => scheduleAck(handle.paneId, chunk.length))
}

export function unregisterTerminal(paneId: string, handle: TerminalHandle): void {
  if (handles.get(paneId) === handle) handles.delete(paneId)
}

export function forgetPane(paneId: string): void {
  early.delete(paneId)
  pendingAcks.delete(paneId)
}

export function getTerminal(paneId: string | null | undefined): TerminalHandle | undefined {
  return paneId ? handles.get(paneId) : undefined
}

/** Type text into a pane the way a paste would (bracketed paste when the program asked for it). */
export function pasteInto(paneId: string, text: string): void {
  const handle = handles.get(paneId)
  if (handle) handle.term.paste(text)
  else window.tpm.pty.write(paneId, text)
}

/** Send a prompt to an agent: paste it, then press Enter once the program has digested the paste. */
export function submitPrompt(paneId: string, text: string): void {
  if (text.length > 0) pasteInto(paneId, text)
  setTimeout(() => window.tpm.pty.write(paneId, '\r'), text.length > 0 ? 120 : 0)
}

export function shellQuote(path: string): string {
  if (window.tpm.info.platform === 'win32') return /\s/.test(path) ? `"${path}"` : path
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(path)) return path
  return `'${path.replace(/'/g, `'\\''`)}'`
}
