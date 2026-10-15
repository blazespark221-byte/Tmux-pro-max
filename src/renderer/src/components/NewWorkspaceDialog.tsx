import { useEffect, useMemo, useState } from 'react'
import { LAYOUT_PRESETS, buildRows, computeGeometry, findPreset } from '@shared/layout'
import type { GitInfo, LayoutNode, PathInfo } from '@shared/types'
import { basename, classNames, shortenPath, slugify } from '../lib/util'
import { actions, activeWorkspace, getAgent, newPaneConfig, useAgents, useApp } from '../store/app'
import { AgentBadge, agentBinary } from './Dropdown'
import { BranchIcon, CopyIcon, FolderIcon } from './Icons'
import { LayoutThumb } from './LayoutThumb'
import { Modal } from './Modal'

const CUSTOM = 'custom'

function buildLayout(presetId: string, ids: string[], rows: number, cols: number): LayoutNode {
  if (presetId === CUSTOM)
    return buildRows(
      ids,
      Array.from({ length: rows }, () => cols)
    )
  const preset = findPreset(presetId) ?? LAYOUT_PRESETS[0]
  return preset.build(ids)
}

function paneCount(presetId: string, rows: number, cols: number): number {
  if (presetId === CUSTOM) return rows * cols
  return findPreset(presetId)?.count ?? 1
}

export function NewWorkspaceDialog() {
  const settings = useApp((s) => s.settings)
  const installed = useApp((s) => s.installed)
  const agents = useAgents()

  const initialFolder = activeWorkspace()?.cwd ?? settings.recentFolders[0] ?? window.tpm.info.homeDir
  const [folder, setFolder] = useState(initialFolder)
  const [name, setName] = useState(basename(initialFolder))
  const [nameTouched, setNameTouched] = useState(false)
  const [presetId, setPresetId] = useState('grid-2x2')
  const [rows, setRows] = useState(2)
  const [cols, setCols] = useState(3)
  const count = paneCount(presetId, rows, cols)
  const defaultAgent = agents.some((a) => a.id === settings.defaultAgentId) ? settings.defaultAgentId : agents[0].id
  const [cellAgents, setCellAgents] = useState<string[]>(() => Array.from({ length: 20 }, () => defaultAgent))
  const [pathInfo, setPathInfo] = useState<PathInfo | null>(null)
  const [git, setGit] = useState<GitInfo | null>(null)
  const [useWorktrees, setUseWorktrees] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void actions.detectAgents()
  }, [])

  // Validate the folder and look for a git repository as the user types.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const info = await window.tpm.path.info(folder)
      if (cancelled) return
      setPathInfo(info)
      if (info.exists && info.isDirectory) {
        const g = await window.tpm.git.info(info.resolved)
        if (!cancelled) setGit(g)
      } else {
        setGit(null)
      }
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [folder])

  useEffect(() => {
    if (!nameTouched) setName(basename(pathInfo?.resolved ?? folder))
  }, [folder, pathInfo, nameTouched])

  const ids = useMemo(() => Array.from({ length: count }, (_, i) => `cell-${i}`), [count])
  const previewLayout = useMemo(() => buildLayout(presetId, ids, rows, cols), [presetId, ids, rows, cols])
  const previewRects = useMemo(() => computeGeometry(previewLayout).panes, [previewLayout])
  const selected = cellAgents.slice(0, count)
  const uniform = selected.every((a) => a === selected[0]) ? selected[0] : null

  const missing = [...new Set(selected)]
    .map((id) => getAgent(id))
    .filter((a) => {
      const bin = agentBinary(a)
      return bin !== null && installed[bin] === false
    })

  const folderOk = !!pathInfo?.exists && pathInfo.isDirectory
  const canCreate = folderOk && name.trim().length > 0 && !busy

  const pickFolder = async (): Promise<void> => {
    const picked = await window.tpm.dialog.pickFolder(pathInfo?.resolved ?? folder)
    if (picked) setFolder(picked)
  }

  const create = async (): Promise<void> => {
    if (!canCreate || !pathInfo) return
    setBusy(true)
    setError(null)
    const cwd = pathInfo.resolved
    const panes = selected.map((agentId) => newPaneConfig(agentId, cwd))

    if (useWorktrees && git?.isRepo && git.root) {
      const slug = slugify(name)
      const agentPanes = panes.filter((p) => getAgent(p.agentId).command !== null)
      for (let i = 0; i < agentPanes.length; i++) {
        const pane = agentPanes[i]
        setProgress(`Creating worktree ${i + 1} of ${agentPanes.length}…`)
        const res = await window.tpm.git.createWorktree({
          repoRoot: git.root,
          branchHint: `tpm/${slug}-${pane.agentId}-${i + 1}`
        })
        if (!res.ok) {
          setError(`Could not create a worktree: ${res.error}`)
          setBusy(false)
          setProgress('')
          return
        }
        pane.cwd = res.worktree.path
        pane.worktree = res.worktree
      }
    }

    const layout = buildLayout(
      presetId,
      panes.map((p) => p.id),
      rows,
      cols
    )
    actions.createWorkspace({ name: name.trim(), cwd, layout, panes })
    actions.rememberFolder(cwd)
    actions.setModal(null)
  }

  const setAll = (agentId: string): void => setCellAgents((prev) => prev.map(() => agentId))

  return (
    <Modal
      title="New workspace"
      subtitle="Pick a project folder, a layout and which agent runs in each pane."
      width={760}
      footer={
        <>
          {progress && <span className="footer-progress">{progress}</span>}
          <span className="footer-spacer" />
          <button type="button" className="btn" onClick={() => actions.setModal(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canCreate} onClick={() => void create()}>
            Create workspace
            <kbd>↩</kbd>
          </button>
        </>
      }
    >
      <form
        className="nw-form"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className="field-row">
          <label className="field grow">
            <span className="field-label">Project folder</span>
            <div className="input-with-button">
              <FolderIcon className="input-icon" />
              <input
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                spellCheck={false}
                autoFocus
                placeholder="~/code/my-project"
              />
              <button type="button" className="btn btn-small" onClick={() => void pickFolder()}>
                Browse…
              </button>
            </div>
            <span className={classNames('field-hint', pathInfo && !folderOk && 'error')}>
              {pathInfo && !pathInfo.exists ? (
                'Folder does not exist'
              ) : pathInfo && !pathInfo.isDirectory ? (
                'Not a folder'
              ) : git?.isRepo ? (
                <>
                  <BranchIcon size={11} /> git repository · {git.branch ?? 'no commits yet'}
                </>
              ) : (
                'Not a git repository'
              )}
            </span>
          </label>
          <label className="field name-field">
            <span className="field-label">Name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameTouched(true)
              }}
              spellCheck={false}
            />
          </label>
        </div>

        {settings.recentFolders.length > 0 && (
          <div className="recent-folders">
            {settings.recentFolders.slice(0, 6).map((f) => (
              <button
                key={f}
                type="button"
                className={classNames('chip', f === pathInfo?.resolved && 'on')}
                onClick={() => setFolder(f)}
              >
                {shortenPath(f)}
              </button>
            ))}
          </div>
        )}

        <div className="field">
          <span className="field-label">Layout</span>
          <div className="preset-grid">
            {LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={classNames('preset', presetId === preset.id && 'on')}
                onClick={() => setPresetId(preset.id)}
                title={`${preset.label} · ${preset.count} ${preset.count === 1 ? 'pane' : 'panes'}`}
              >
                <LayoutThumb preset={preset} size={44} />
                <span>{preset.label}</span>
              </button>
            ))}
            <div className={classNames('preset custom', presetId === CUSTOM && 'on')} onClick={() => setPresetId(CUSTOM)}>
              <div className="stepper-row">
                <Stepper
                  value={rows}
                  min={1}
                  max={4}
                  onChange={(v) => {
                    setRows(v)
                    setPresetId(CUSTOM)
                  }}
                />
                <span>×</span>
                <Stepper
                  value={cols}
                  min={1}
                  max={5}
                  onChange={(v) => {
                    setCols(v)
                    setPresetId(CUSTOM)
                  }}
                />
              </div>
              <span>Custom rows × cols</span>
            </div>
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            Agents <span className="field-label-note">— click a pane in the preview to change just that one</span>
          </span>
          <div className="agent-chips">
            {agents.map((agent) => {
              const bin = agentBinary(agent)
              const notFound = bin !== null && installed[bin] === false
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={classNames('agent-chip', uniform === agent.id && 'on', notFound && 'missing')}
                  onClick={() => setAll(agent.id)}
                  title={notFound ? `${agent.command} not found on PATH` : (agent.command ?? 'Login shell')}
                >
                  <AgentBadge agent={agent} />
                  {agent.name}
                </button>
              )
            })}
          </div>
        </div>

        <div className="layout-preview">
          {ids.map((id, i) => {
            const r = previewRects[id]
            if (!r) return null
            const agent = getAgent(selected[i])
            return (
              <div
                key={id}
                className="preview-cell"
                style={{
                  left: `calc(${r.x * 100}% + 3px)`,
                  top: `calc(${r.y * 100}% + 3px)`,
                  width: `calc(${r.w * 100}% - 6px)`,
                  height: `calc(${r.h * 100}% - 6px)`,
                  ['--agent-color' as string]: agent.color
                }}
              >
                <span className="preview-index">{i + 1}</span>
                <AgentBadge agent={agent} size="md" />
                <select
                  value={selected[i]}
                  onChange={(e) => {
                    const value = e.target.value
                    setCellAgents((prev) => prev.map((a, j) => (j === i ? value : a)))
                  }}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>

        {missing.length > 0 && (
          <div className="notice warn">
            {missing.map((a) => (
              <div key={a.id} className="notice-line">
                <strong>{a.name}</strong>&nbsp;(<code>{agentBinary(a)}</code>) wasn’t found on your PATH.
                {a.installHint && (
                  <>
                    &nbsp;Install it with <code>{a.installHint}</code>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Copy install command"
                      onClick={() => window.tpm.clipboard.write(a.installHint!)}
                    >
                      <CopyIcon size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <label className={classNames('toggle-row', !git?.isRepo && 'disabled')}>
          <input
            type="checkbox"
            checked={useWorktrees && !!git?.isRepo}
            disabled={!git?.isRepo}
            onChange={(e) => setUseWorktrees(e.target.checked)}
          />
          <div>
            <div className="toggle-title">Give each agent its own git worktree</div>
            <div className="toggle-desc">
              {git?.isRepo
                ? 'Every agent works on its own branch in a separate checkout (under ~/.tmux-pro-max/worktrees), so parallel agents never overwrite each other’s files.'
                : 'Available when the folder is a git repository.'}
            </div>
          </div>
        </label>

        {error && <div className="notice error">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <span>{value}</span>
      <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  )
}
