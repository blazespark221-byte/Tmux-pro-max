import { getAgent, useApp, workspaceOfPane } from '../store/app'
import { patchPane, useRuntime } from '../store/runtime'

// Agent-agnostic activity tracking. An agent that is working streams output
// (spinners, tokens, tool logs); when it goes quiet after a real stretch of work
// it is almost always waiting for the human. We combine that heuristic with the
// explicit signals terminals already have: BEL and OSC 9 / OSC 777 notifications.

interface Track {
  startedAt: number
  lastOutput: number
  busySince: number | null
  suppressUntil: number
  lastNotified: number
}

const IDLE_AFTER_MS = 1500
const MIN_BUSY_MS = 2500
const STARTUP_GRACE_MS = 6000
const NOTIFY_COOLDOWN_MS = 15000

const tracks = new Map<string, Track>()
let ticker: ReturnType<typeof setInterval> | null = null

function now(): number {
  return performance.now()
}

/** The user is looking right at this pane, so there is no need to flag it. */
function isWatched(paneId: string): boolean {
  const app = useApp.getState()
  const ws = app.workspaces.find((w) => w.id === app.activeWorkspaceId)
  return (
    useRuntime.getState().windowFocused &&
    document.visibilityState === 'visible' &&
    !!ws &&
    ws.focusedPaneId === paneId &&
    (ws.zoomedPaneId === null || ws.zoomedPaneId === paneId)
  )
}

function raise(paneId: string, message: string): void {
  if (isWatched(paneId)) return
  patchPane(paneId, { attention: true, message })
  const track = tracks.get(paneId)
  const t = now()
  if (track && t - track.lastNotified < NOTIFY_COOLDOWN_MS) return
  if (track) track.lastNotified = t

  const { settings } = useApp.getState()
  if (!useRuntime.getState().windowFocused) {
    window.tpm.flashFrame()
    if (settings.notifications) {
      const ws = workspaceOfPane(paneId)
      const pane = ws?.panes[paneId]
      if (ws && pane) {
        const agent = getAgent(pane.agentId)
        window.tpm.notify({
          title: `${agent.name} · ${ws.name}`,
          body: message,
          workspaceId: ws.id,
          paneId
        })
      }
    }
  }
}

function tick(): void {
  const t = now()
  for (const [paneId, track] of tracks) {
    if (track.busySince !== null && t - track.lastOutput > IDLE_AFTER_MS) {
      const busyFor = track.lastOutput - track.busySince
      track.busySince = null
      patchPane(paneId, { status: 'idle' })
      if (busyFor >= MIN_BUSY_MS && track.lastOutput - track.startedAt > STARTUP_GRACE_MS) {
        raise(paneId, 'Finished working — waiting for your input')
      }
    } else if (track.busySince === null && t - track.startedAt > 2000) {
      const status = useRuntime.getState().panes[paneId]?.status
      if (status === 'starting') patchPane(paneId, { status: 'idle' })
    }
  }
}

export const activity = {
  start(): void {
    if (!ticker) ticker = setInterval(tick, 500)
  },

  /** A process was (re)started in the pane. */
  started(paneId: string): void {
    const t = now()
    tracks.set(paneId, { startedAt: t, lastOutput: t, busySince: null, suppressUntil: 0, lastNotified: 0 })
    patchPane(paneId, { status: 'starting', attention: false, exitCode: undefined, error: undefined, message: undefined })
  },

  onOutput(paneId: string): void {
    const track = tracks.get(paneId)
    if (!track) return
    const t = now()
    if (t < track.suppressUntil) return
    if (track.busySince === null) {
      track.busySince = t
      patchPane(paneId, { status: 'running' })
    }
    track.lastOutput = t
  },

  /** Ignore output for a moment (echo of typed keys, repaint after a resize). */
  suppress(paneId: string, ms: number): void {
    const track = tracks.get(paneId)
    if (track) track.suppressUntil = Math.max(track.suppressUntil, now() + ms)
  },

  onExit(paneId: string, exitCode: number): void {
    tracks.delete(paneId)
    const ws = workspaceOfPane(paneId)
    if (!ws) return
    raise(paneId, exitCode === 0 ? 'Process exited' : `Process exited with code ${exitCode}`)
  },

  bell(paneId: string): void {
    raise(paneId, 'Needs your attention')
  },

  notify(paneId: string, message: string): void {
    raise(paneId, message.trim() || 'Needs your attention')
  },

  clear(paneId: string): void {
    patchPane(paneId, { attention: false })
  },

  forget(paneId: string): void {
    tracks.delete(paneId)
  }
}
