import { useEffect, useState } from 'react'
import { BUILTIN_AGENTS } from '@shared/agents'
import { DEFAULT_FONT_FAMILY, DEFAULT_SETTINGS } from '@shared/defaults'
import { SHORTCUTS, formatAccelerator } from '@shared/shortcuts'
import type { AgentDef, Settings } from '@shared/types'
import { classNames, isMac } from '../lib/util'
import { actions, useAgents, useApp } from '../store/app'
import { AgentBadge, agentBinary } from './Dropdown'
import { TrashIcon } from './Icons'
import { Modal } from './Modal'

const COLORS = ['#7c8aff', '#d97757', '#3ecf8e', '#f2c14e', '#56d4dd', '#c792ea', '#f0646e', '#e5e7eb']

export function SettingsDialog() {
  const settings = useApp((s) => s.settings)
  const installed = useApp((s) => s.installed)
  const agents = useAgents()
  const [tab, setTab] = useState<'general' | 'terminal' | 'agents'>('general')

  useEffect(() => {
    void actions.detectAgents()
  }, [settings.agentCommandOverrides, settings.customAgents])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void =>
    actions.updateSettings({ [key]: value } as Partial<Settings>)

  return (
    <Modal title="Settings" width={720}>
      <div className="tabs">
        {(['general', 'terminal', 'agents'] as const).map((t) => (
          <button key={t} type="button" className={classNames('tab', tab === t && 'on')} onClick={() => setTab(t)}>
            {t === 'general' ? 'General' : t === 'terminal' ? 'Terminal' : 'Agents'}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="settings-section">
          <label className="setting">
            <span className="setting-text">
              <span className="setting-title">Default agent</span>
              <span className="setting-desc">Used for new panes and pre-selected when creating a workspace.</span>
            </span>
            <select value={settings.defaultAgentId} onChange={(e) => set('defaultAgentId', e.target.value)}>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <Toggle
            title="Desktop notifications"
            desc="Notify when an agent finishes working or rings the bell while the window is in the background."
            checked={settings.notifications}
            onChange={(v) => set('notifications', v)}
          />
          <Toggle
            title="Resume Claude Code conversations"
            desc="Each Claude Code pane keeps its own conversation id and resumes it when the app restarts."
            checked={settings.resumeSessions}
            onChange={(v) => set('resumeSessions', v)}
          />
          <Toggle
            title="Confirm before closing a running pane"
            checked={settings.confirmClosePane}
            onChange={(v) => set('confirmClosePane', v)}
          />
          <Toggle
            title="Shift+Enter inserts a newline"
            desc="Sends ESC+Enter, which Claude Code, Codex and most agent CLIs treat as a line break in the prompt."
            checked={settings.shiftEnterNewline}
            onChange={(v) => set('shiftEnterNewline', v)}
          />
          {isMac && (
            <Toggle
              title="Use Option as Meta key"
              desc="Turn on for Emacs-style Alt shortcuts. Leave off to type special characters with Option."
              checked={settings.macOptionIsMeta}
              onChange={(v) => set('macOptionIsMeta', v)}
            />
          )}
        </div>
      )}

      {tab === 'terminal' && (
        <div className="settings-section">
          <label className="setting">
            <span className="setting-text">
              <span className="setting-title">Font family</span>
              <span className="setting-desc">Any installed monospace font. Nerd Fonts work too.</span>
            </span>
            <input
              className="wide-input"
              value={settings.fontFamily}
              spellCheck={false}
              onChange={(e) => set('fontFamily', e.target.value || DEFAULT_FONT_FAMILY)}
            />
          </label>
          <label className="setting">
            <span className="setting-text">
              <span className="setting-title">Font size</span>
              <span className="setting-desc">
                {formatAccelerator(isMac ? 'Cmd+=' : 'Ctrl+=', isMac)} / {formatAccelerator(isMac ? 'Cmd+-' : 'Ctrl+-', isMac)} to
                adjust quickly.
              </span>
            </span>
            <input
              type="number"
              min={8}
              max={28}
              value={settings.fontSize}
              onChange={(e) => actions.setFontSize(Number(e.target.value) || DEFAULT_SETTINGS.fontSize)}
            />
          </label>
          <label className="setting">
            <span className="setting-text">
              <span className="setting-title">Line height</span>
            </span>
            <input
              type="number"
              min={1}
              max={2}
              step={0.05}
              value={settings.lineHeight}
              onChange={(e) => set('lineHeight', Math.min(2, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <label className="setting">
            <span className="setting-text">
              <span className="setting-title">Cursor</span>
            </span>
            <select value={settings.cursorStyle} onChange={(e) => set('cursorStyle', e.target.value as Settings['cursorStyle'])}>
              <option value="block">Block</option>
              <option value="bar">Bar</option>
              <option value="underline">Underline</option>
            </select>
          </label>
          <Toggle title="Blinking cursor" checked={settings.cursorBlink} onChange={(v) => set('cursorBlink', v)} />
          <label className="setting">
            <span className="setting-text">
              <span className="setting-title">Scrollback lines</span>
            </span>
            <input
              type="number"
              min={1000}
              max={200000}
              step={1000}
              value={settings.scrollback}
              onChange={(e) => set('scrollback', Math.min(200000, Math.max(1000, Number(e.target.value) || 10000)))}
            />
          </label>
        </div>
      )}

      {tab === 'agents' && (
        <div className="settings-section">
          <p className="settings-intro">
            Edit the command each agent runs, e.g. <code>claude --model opus</code> or <code>codex --full-auto</code>. Commands
            run through your shell inside the pane’s folder.
          </p>
          <div className="agent-table">
            {BUILTIN_AGENTS.filter((a) => a.command !== null).map((base) => {
              const agent = agents.find((a) => a.id === base.id) ?? base
              const bin = agentBinary(agent)
              const found = bin ? installed[bin] : true
              return (
                <div key={base.id} className="agent-row">
                  <AgentBadge agent={agent} size="md" />
                  <div className="agent-row-name">
                    {agent.name}
                    <span className={classNames('agent-row-status', found === false && 'missing')}>
                      {found === undefined ? '…' : found ? 'installed' : 'not found'}
                    </span>
                  </div>
                  <input
                    value={settings.agentCommandOverrides[base.id] ?? base.command ?? ''}
                    spellCheck={false}
                    onChange={(e) => {
                      const next = { ...settings.agentCommandOverrides }
                      const v = e.target.value
                      if (!v.trim() || v === base.command) delete next[base.id]
                      else next[base.id] = v
                      set('agentCommandOverrides', next)
                    }}
                  />
                </div>
              )
            })}
          </div>

          <h3 className="settings-subtitle">Custom agents</h3>
          {settings.customAgents.length === 0 && (
            <p className="settings-intro">Add any CLI you like: a script, a different model, an SSH session…</p>
          )}
          <div className="agent-table">
            {settings.customAgents.map((agent) => (
              <CustomAgentRow key={agent.id} agent={agent} />
            ))}
          </div>
          <AddCustomAgent />
        </div>
      )}
    </Modal>
  )
}

function Toggle({
  title,
  desc,
  checked,
  onChange
}: {
  title: string
  desc?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="setting">
      <span className="setting-text">
        <span className="setting-title">{title}</span>
        {desc && <span className="setting-desc">{desc}</span>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

function updateCustom(id: string, patch: Partial<AgentDef>): void {
  const list = useApp.getState().settings.customAgents.map((a) => (a.id === id ? { ...a, ...patch } : a))
  actions.updateSettings({ customAgents: list })
}

function CustomAgentRow({ agent }: { agent: AgentDef }) {
  return (
    <div className="agent-row">
      <AgentBadge agent={agent} size="md" />
      <input className="agent-name-input" value={agent.name} onChange={(e) => updateCustom(agent.id, { name: e.target.value })} />
      <input
        value={agent.command ?? ''}
        spellCheck={false}
        onChange={(e) => updateCustom(agent.id, { command: e.target.value })}
      />
      <button
        type="button"
        className="icon-btn danger"
        title="Remove"
        onClick={() => {
          const s = useApp.getState().settings
          actions.updateSettings({
            customAgents: s.customAgents.filter((a) => a.id !== agent.id),
            defaultAgentId: s.defaultAgentId === agent.id ? DEFAULT_SETTINGS.defaultAgentId : s.defaultAgentId
          })
        }}
      >
        <TrashIcon />
      </button>
    </div>
  )
}

function AddCustomAgent() {
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const add = (): void => {
    if (!name.trim() || !command.trim()) return
    const existing = useApp.getState().settings.customAgents
    const glyph =
      name
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || '★'
    const agent: AgentDef = {
      id: `custom-${crypto.randomUUID().slice(0, 8)}`,
      name: name.trim(),
      command: command.trim(),
      color: COLORS[existing.length % COLORS.length],
      glyph
    }
    actions.updateSettings({ customAgents: [...existing, agent] })
    setName('')
    setCommand('')
  }
  return (
    <form
      className="add-agent"
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
    >
      <input placeholder="Name (e.g. Claude Opus)" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        placeholder="Command (e.g. claude --model opus)"
        value={command}
        spellCheck={false}
        onChange={(e) => setCommand(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={!name.trim() || !command.trim()}>
        Add agent
      </button>
    </form>
  )
}

export function ShortcutsDialog() {
  const groups = ['Workspaces', 'Panes', 'Navigation', 'Terminal', 'App'] as const
  return (
    <Modal title="Keyboard shortcuts" width={680}>
      <div className="shortcut-groups">
        {groups.map((group) => {
          const defs = SHORTCUTS.filter((s) => s.group === group && (isMac ? s.mac : s.other))
          // Collapse "Go to workspace 1..9" into one row.
          const rows = defs.filter((d) => !/^workspace-[2-9]$/.test(d.action))
          return (
            <div key={group} className="shortcut-group">
              <h3>{group}</h3>
              {rows.map((d) => (
                <div key={d.action} className="shortcut-row">
                  <span>{d.action === 'workspace-1' ? 'Go to workspace 1–9' : d.label}</span>
                  <kbd>
                    {d.action === 'workspace-1'
                      ? formatAccelerator(isMac ? 'Cmd+1' : 'Alt+1', isMac).replace('1', '1…9')
                      : formatAccelerator(isMac ? d.mac : d.other, isMac)}
                  </kbd>
                </div>
              ))}
              {group === 'Terminal' && (
                <div className="shortcut-row">
                  <span>Newline in agent prompt</span>
                  <kbd>{isMac ? '⇧↩' : 'Shift+Enter'}</kbd>
                </div>
              )}
              {group === 'Panes' && (
                <div className="shortcut-row">
                  <span>Swap panes</span>
                  <kbd>drag header</kbd>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
