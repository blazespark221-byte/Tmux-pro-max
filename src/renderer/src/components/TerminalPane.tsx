import { memo, useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { matchShortcut } from '@shared/shortcuts'
import type { PaneConfig } from '@shared/types'
import { activity } from '../lib/activity'
import { buildLaunch } from '../lib/launch'
import { getTerminal, markReady, pasteInto, registerTerminal, shellQuote, unregisterTerminal } from '../lib/terminals'
import type { TerminalHandle } from '../lib/terminals'
import { isMac } from '../lib/util'
import { actions, getAgent, useApp, workspaceOfPane } from '../store/app'
import { paneRuntime, patchPane, usePaneRuntime } from '../store/runtime'
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, RestartIcon } from './Icons'

export const TERMINAL_THEME: ITheme = {
  background: '#0d0f13',
  foreground: '#d9dce1',
  cursor: '#e8eaee',
  cursorAccent: '#0d0f13',
  selectionBackground: 'rgba(124, 138, 255, 0.35)',
  selectionInactiveBackground: 'rgba(124, 138, 255, 0.18)',
  scrollbarSliderBackground: 'rgba(255, 255, 255, 0.08)',
  scrollbarSliderHoverBackground: 'rgba(255, 255, 255, 0.16)',
  scrollbarSliderActiveBackground: 'rgba(255, 255, 255, 0.22)',
  black: '#1c1f26',
  red: '#f0646e',
  green: '#3ecf8e',
  yellow: '#f2c14e',
  blue: '#6ea8fe',
  magenta: '#c792ea',
  cyan: '#56d4dd',
  white: '#d9dce1',
  brightBlack: '#5f6672',
  brightRed: '#ff7f88',
  brightGreen: '#63e2a8',
  brightYellow: '#ffd479',
  brightBlue: '#92bdff',
  brightMagenta: '#dcb0ff',
  brightCyan: '#82e6ee',
  brightWhite: '#ffffff'
}

interface Props {
  workspaceId: string
  pane: PaneConfig
  visible: boolean
  focused: boolean
}

export const TerminalPane = memo(function TerminalPane({ workspaceId, pane, visible, focused }: Props) {
  const paneId = pane.id
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const webglFailed = useRef(false)
  const fitNow = useRef<() => void>(() => {})

  const settings = useApp((s) => s.settings)
  const modalOpen = useApp((s) => s.modal !== null)
  const findOpen = useApp((s) => s.findPaneId === paneId)
  const runtime = usePaneRuntime(paneId)
  const [dropActive, setDropActive] = useState(false)

  // ---- Create the terminal and start (or re-attach to) the process -------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const s = useApp.getState().settings
    const term = new Terminal({
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      scrollback: s.scrollback,
      cursorStyle: s.cursorStyle,
      cursorBlink: s.cursorBlink,
      macOptionIsMeta: s.macOptionIsMeta,
      macOptionClickForcesSelection: true,
      allowProposedApi: true,
      theme: TERMINAL_THEME,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      rescaleOverlappingGlyphs: true,
      scrollOnUserInput: true,
      windowsPty: window.tpm.info.platform === 'win32' ? { backend: 'conpty' } : undefined
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (isMac ? event.metaKey : event.ctrlKey) window.tpm.shell.openExternal(uri)
      })
    )
    term.open(el)
    termRef.current = term
    fitRef.current = fit

    const handle: TerminalHandle = { paneId, term, search, ready: false }
    registerTerminal(handle)

    // -- input
    const subs = [
      term.onData((data) => {
        if (paneRuntime(paneId).status === 'exited') {
          if (data === '\r') void actions.restartPane(paneId)
          return
        }
        activity.suppress(paneId, 250)
        window.tpm.pty.write(paneId, data)
      }),
      term.onTitleChange((title) => patchPane(paneId, { title })),
      term.onBell(() => activity.bell(paneId)),
      // iTerm2-style notifications: OSC 9 ; message
      term.parser.registerOscHandler(9, (data) => {
        if (!/^\d+;/.test(data)) activity.notify(paneId, data)
        return true
      }),
      // rxvt-style notifications: OSC 777 ; notify ; title ; body
      term.parser.registerOscHandler(777, (data) => {
        const [kind, title, ...body] = data.split(';')
        if (kind === 'notify') activity.notify(paneId, body.join(';') || title || '')
        return true
      })
    ]

    term.attachCustomKeyEventHandler((e) => {
      if (matchShortcut(e, isMac)) return false
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey
      if (e.key === 'Enter' && e.shiftKey && plain && useApp.getState().settings.shiftEnterNewline) {
        // ESC + CR is what agents (Claude Code, Codex, ...) treat as "insert newline".
        if (e.type === 'keydown') window.tpm.pty.write(paneId, '\x1b\r')
        return false
      }
      if (isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const map: Record<string, string> = { ArrowLeft: '\x01', ArrowRight: '\x05', Backspace: '\x15' }
        const seq = map[e.key]
        if (seq) {
          if (e.type === 'keydown') window.tpm.pty.write(paneId, seq)
          return false
        }
      }
      return true
    })

    const onFocus = (): void => {
      const ws = workspaceOfPane(paneId)
      if (ws) actions.focusPane(ws.id, paneId)
    }
    term.textarea?.addEventListener('focus', onFocus)

    // -- sizing
    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    let frame = 0
    const doFit = (): void => {
      if (!el.isConnected || el.clientWidth < 24 || el.clientHeight < 16) return
      try {
        fit.fit()
      } catch {
        return
      }
      if (term.cols === lastCols && term.rows === lastRows) return
      const first = lastCols === 0
      lastCols = term.cols
      lastRows = term.rows
      if (first) return
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        activity.suppress(paneId, 800)
        window.tpm.pty.resize(paneId, term.cols, term.rows)
      }, 40)
    }
    fitNow.current = doFit
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(doFit)
    })
    observer.observe(el)

    // -- process
    let disposed = false
    const start = async (): Promise<void> => {
      doFit()
      const state = useApp.getState()
      const config = workspaceOfPane(paneId)?.panes[paneId] ?? pane
      const agent = getAgent(config.agentId)
      activity.started(paneId)
      let command = agent.command
      try {
        command = (await buildLaunch(config, agent, state.settings)).command
      } catch {
        // fall back to the plain command
      }
      if (disposed) return
      const result = await window.tpm.pty.spawn({
        paneId,
        cwd: config.cwd,
        command,
        cols: term.cols || 80,
        rows: term.rows || 24,
        env: { TPM_PANE_ID: paneId, TPM_WORKSPACE_ID: workspaceId }
      })
      // The pane was closed while we were starting: don't leave an orphan behind.
      if (!workspaceOfPane(paneId)) {
        void window.tpm.pty.kill(paneId)
        return
      }
      if (disposed) return
      if (!result.ok) {
        markReady(handle, true)
        term.write(`\r\n\x1b[31m${result.error}\x1b[0m\r\n`)
        patchPane(paneId, { status: 'exited', error: result.error, exitCode: -1 })
        return
      }
      if (result.attached) {
        term.write(result.replay)
        markReady(handle, true)
      } else {
        markReady(handle, false)
      }
      // The pty might have been sized before the first fit settled.
      if (term.cols !== lastCols || term.rows !== lastRows) doFit()
      window.tpm.pty.resize(paneId, term.cols, term.rows)
    }
    void start()

    return () => {
      disposed = true
      observer.disconnect()
      cancelAnimationFrame(frame)
      if (resizeTimer) clearTimeout(resizeTimer)
      term.textarea?.removeEventListener('focus', onFocus)
      subs.forEach((d) => d.dispose())
      unregisterTerminal(paneId, handle)
      webglRef.current = null
      termRef.current = null
      fitRef.current = null
      term.dispose()
    }
    // pane config is read fresh from the store inside; only identity matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId, workspaceId])

  // ---- Live settings ------------------------------------------------------
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = settings.fontFamily
    term.options.fontSize = settings.fontSize
    term.options.lineHeight = settings.lineHeight
    term.options.cursorStyle = settings.cursorStyle
    term.options.cursorBlink = settings.cursorBlink
    term.options.scrollback = settings.scrollback
    term.options.macOptionIsMeta = settings.macOptionIsMeta
    webglRef.current?.clearTextureAtlas()
    requestAnimationFrame(() => fitNow.current())
  }, [
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.scrollback,
    settings.macOptionIsMeta
  ])

  // ---- GPU renderer only while visible (browsers cap live WebGL contexts) --
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (visible) {
      if (!webglRef.current && !webglFailed.current) {
        try {
          const addon = new WebglAddon()
          addon.onContextLoss(() => {
            addon.dispose()
            if (webglRef.current === addon) webglRef.current = null
          })
          term.loadAddon(addon)
          webglRef.current = addon
        } catch {
          webglFailed.current = true
        }
      }
      requestAnimationFrame(() => fitNow.current())
    } else if (webglRef.current) {
      webglRef.current.dispose()
      webglRef.current = null
    }
  }, [visible])

  // ---- Keyboard focus follows the focused pane ---------------------------
  useEffect(() => {
    if (focused && visible && !modalOpen && !findOpen) termRef.current?.focus()
  }, [focused, visible, modalOpen, findOpen])

  const exited = runtime.status === 'exited'
  const agent = getAgent(pane.agentId)

  return (
    <div
      className={`terminal-host${dropActive ? ' drop-active' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropActive(true)
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        setDropActive(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length === 0) return
        e.preventDefault()
        const paths = files.map((f) => window.tpm.path.forFile(f)).filter(Boolean)
        if (paths.length) pasteInto(paneId, paths.map(shellQuote).join(' ') + ' ')
        termRef.current?.focus()
      }}
    >
      <div ref={containerRef} className="terminal-container" />
      {findOpen && <FindBar paneId={paneId} getTerm={() => termRef.current} />}
      {exited && (
        <div className="exit-banner">
          <span>
            {runtime.error
              ? 'Failed to start'
              : runtime.exitCode === 127 && agent.command
                ? `“${agent.command.split(/\s+/)[0]}” was not found.`
                : `${agent.name} exited${runtime.exitCode ? ` with code ${runtime.exitCode}` : ''}.`}
            {runtime.exitCode === 127 && agent.installHint && (
              <>
                {' '}
                Install with <code>{agent.installHint}</code>
              </>
            )}
          </span>
          <button type="button" className="btn btn-small" onClick={() => void actions.restartPane(paneId)}>
            <RestartIcon size={12} /> Restart <kbd>↩</kbd>
          </button>
        </div>
      )}
    </div>
  )
})

function FindBar({ paneId, getTerm }: { paneId: string; getTerm: () => Terminal | null }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const search = (direction: 'next' | 'prev', incremental = false): void => {
    const handle = getTerminal(paneId)
    if (!handle || !query) return
    const opts = {
      incremental,
      decorations: {
        matchBackground: '#3b4270',
        activeMatchBackground: '#7c8aff',
        matchOverviewRuler: '#7c8aff',
        activeMatchColorOverviewRuler: '#ffffff'
      }
    }
    if (direction === 'next') handle.search.findNext(query, opts)
    else handle.search.findPrevious(query, opts)
  }

  const close = (): void => {
    getTerminal(paneId)?.search.clearDecorations()
    actions.setFindPane(null)
    getTerm()?.focus()
  }

  return (
    <div className="find-bar" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={query}
        placeholder="Find"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') search(e.shiftKey ? 'prev' : 'next')
          if (e.key === 'Escape') close()
        }}
        onKeyUp={(e) => {
          if (e.key.length === 1 || e.key === 'Backspace') search('next', true)
        }}
      />
      <button type="button" className="icon-btn" title="Previous match" onClick={() => search('prev')}>
        <ArrowUpIcon size={12} />
      </button>
      <button type="button" className="icon-btn" title="Next match" onClick={() => search('next')}>
        <ArrowDownIcon size={12} />
      </button>
      <button type="button" className="icon-btn" title="Close" onClick={close}>
        <CloseIcon size={12} />
      </button>
    </div>
  )
}
