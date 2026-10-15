import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { AppInfo, TpmApi } from '@shared/api'

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const info = ipcRenderer.sendSync('app:infoSync') as AppInfo

const api: TpmApi = {
  info,
  pty: {
    spawn: (req) => ipcRenderer.invoke('pty:spawn', req),
    write: (paneId, data) => ipcRenderer.send('pty:write', paneId, data),
    resize: (paneId, cols, rows) => ipcRenderer.send('pty:resize', paneId, cols, rows),
    ack: (paneId, chars) => ipcRenderer.send('pty:ack', paneId, chars),
    kill: (paneId) => ipcRenderer.invoke('pty:kill', paneId),
    alive: (paneId) => ipcRenderer.invoke('pty:alive', paneId),
    onData: (cb) => subscribe('pty:data', cb),
    onExit: (cb) => subscribe('pty:exit', cb)
  },
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (state) => ipcRenderer.send('state:save', state),
    saveSync: (state) => {
      ipcRenderer.sendSync('state:saveSync', state)
    }
  },
  agents: {
    detect: (binaries) => ipcRenderer.invoke('agents:detect', binaries)
  },
  git: {
    info: (dir) => ipcRenderer.invoke('git:info', dir),
    createWorktree: (req) => ipcRenderer.invoke('git:createWorktree', req),
    removeWorktree: (repoRoot, worktreePath) => ipcRenderer.invoke('git:removeWorktree', repoRoot, worktreePath)
  },
  claude: {
    sessionExists: (sessionId) => ipcRenderer.invoke('claude:sessionExists', sessionId)
  },
  dialog: {
    pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath)
  },
  path: {
    info: (p) => ipcRenderer.invoke('path:info', p),
    forFile: (file) => webUtils.getPathForFile(file)
  },
  shell: {
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
    showItemInFolder: (p) => ipcRenderer.send('shell:showItemInFolder', p),
    openPath: (p) => ipcRenderer.send('shell:openPath', p)
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    write: (text) => ipcRenderer.send('clipboard:write', text)
  },
  notify: (req) => ipcRenderer.send('notify', req),
  setBadge: (count) => ipcRenderer.send('badge', count),
  flashFrame: () => ipcRenderer.send('window:flashFrame'),
  onMenuAction: (cb) => subscribe('menu:action', cb),
  onFocusPane: (cb) => subscribe('focus-pane', cb),
  onWindowFocus: (cb) => subscribe('window:focus', cb)
}

contextBridge.exposeInMainWorld('tpm', api)
