import { BrowserWindow, Notification, app, clipboard, dialog, ipcMain, nativeImage, screen, shell } from 'electron'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CreateWorktreeRequest, MenuAction, NotifyRequest, PathInfo, PersistedState, SpawnRequest } from '@shared/types'
import { createWorktree, gitInfo, removeWorktree } from './git'
import { installMenu } from './menu'
import { StateStore, claudeSessionExists } from './persistence'
import { PtyManager } from './pty-manager'
import { defaultShell, expandHome, findExecutable, resolveShellEnv } from './shell-env'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

app.setName('Tmux Pro Max')
// Allow e2e tests (and power users) to point the app at an isolated profile.
if (process.env.TPM_USER_DATA_DIR) app.setPath('userData', process.env.TPM_USER_DATA_DIR)

let mainWindow: BrowserWindow | null = null
const ptys = new PtyManager(resolveShellEnv, app.getVersion())
let store: StateStore
const liveNotifications = new Set<Notification>()

// Kick off shell environment resolution early; spawning waits on it.
void resolveShellEnv()

interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized?: boolean
}

function boundsFile(): string {
  return path.join(app.getPath('userData'), 'window.json')
}

function loadBounds(): WindowBounds {
  const fallback: WindowBounds = { width: 1440, height: 900 }
  try {
    const saved = JSON.parse(readFileSync(boundsFile(), 'utf8')) as WindowBounds
    const area = screen.getDisplayMatching({
      x: saved.x ?? 0,
      y: saved.y ?? 0,
      width: saved.width,
      height: saved.height
    }).workArea
    const visible =
      saved.x === undefined ||
      saved.y === undefined ||
      (saved.x < area.x + area.width - 100 && saved.y < area.y + area.height - 100 && saved.x + saved.width > area.x + 100)
    return visible ? saved : { ...fallback, maximized: saved.maximized }
  } catch {
    return fallback
  }
}

function saveBounds(win: BrowserWindow): void {
  try {
    const b = win.getNormalBounds()
    writeFileSync(boundsFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }))
  } catch {
    // non-fatal
  }
}

function createWindow(): void {
  const bounds = loadBounds()
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Tmux Pro Max',
    backgroundColor: '#0b0d10',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    autoHideMenuBar: true,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  mainWindow = win
  ptys.setSink(win.webContents)

  win.once('ready-to-show', () => {
    if (bounds.maximized) win.maximize()
    win.show()
  })
  win.on('close', () => saveBounds(win))
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      ptys.setSink(null)
    }
  })
  win.on('focus', () => win.webContents.send('window:focus', true))
  win.on('blur', () => win.webContents.send('window:focus', false))

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return
    event.preventDefault()
    openExternal(url)
  })
  // Devtools on F12 / Ctrl+Shift+I in development builds.
  win.webContents.on('before-input-event', (event, input) => {
    if (!isDev || input.type !== 'keyDown') return
    const devtools = input.key === 'F12' || (input.key.toLowerCase() === 'i' && input.shift && (input.control || input.meta))
    if (devtools) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function iconPath(): string | undefined {
  const candidates = [path.join(process.resourcesPath ?? '', 'icon.png'), path.join(app.getAppPath(), 'build', 'icon.png')]
  return candidates.find((p) => existsSync(p))
}

function openExternal(url: string): void {
  try {
    const parsed = new URL(url)
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) void shell.openExternal(url)
  } catch {
    // ignore malformed URLs
  }
}

function sendMenuAction(action: MenuAction): void {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:action', action)
}

function focusWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function registerIpc(): void {
  ipcMain.handle('pty:spawn', (_e, req: SpawnRequest) => ptys.spawn(req))
  ipcMain.on('pty:write', (_e, paneId: string, data: string) => ptys.write(paneId, data))
  ipcMain.on('pty:resize', (_e, paneId: string, cols: number, rows: number) => ptys.resize(paneId, cols, rows))
  ipcMain.on('pty:ack', (_e, paneId: string, chars: number) => ptys.ack(paneId, chars))
  ipcMain.handle('pty:kill', (_e, paneId: string) => ptys.kill(paneId))
  ipcMain.handle('pty:alive', (_e, paneId: string) => ptys.has(paneId))

  ipcMain.handle('state:load', () => store.load())
  ipcMain.on('state:save', (_e, state: PersistedState) => store.save(state))
  ipcMain.on('state:saveSync', (e, state: PersistedState) => {
    store.saveSync(state)
    e.returnValue = true
  })

  ipcMain.handle('agents:detect', async (_e, binaries: string[]) => {
    const env = await resolveShellEnv()
    const result: Record<string, boolean> = {}
    for (const bin of binaries) result[bin] = findExecutable(bin, env) !== null
    return result
  })

  ipcMain.handle('git:info', async (_e, dir: string) => gitInfo(dir, await resolveShellEnv()))
  ipcMain.handle('git:createWorktree', async (_e, req: CreateWorktreeRequest) =>
    createWorktree(req.repoRoot, req.branchHint, await resolveShellEnv())
  )
  ipcMain.handle('git:removeWorktree', async (_e, repoRoot: string, worktreePath: string) =>
    removeWorktree(repoRoot, worktreePath, await resolveShellEnv())
  )
  ipcMain.handle('claude:sessionExists', async (_e, sessionId: string) => claudeSessionExists(sessionId, await resolveShellEnv()))

  ipcMain.handle('dialog:pickFolder', async (_e, defaultPath?: string) => {
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a project folder',
      defaultPath: defaultPath ? expandHome(defaultPath) : os.homedir(),
      properties: ['openDirectory', 'createDirectory']
    }
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('path:info', (_e, p: string): PathInfo => {
    const resolved = path.resolve(expandHome(p.trim() || '~'))
    try {
      const st = statSync(resolved)
      return { exists: true, isDirectory: st.isDirectory(), resolved }
    } catch {
      return { exists: false, isDirectory: false, resolved }
    }
  })

  ipcMain.on('shell:openExternal', (_e, url: string) => openExternal(url))
  ipcMain.on('shell:showItemInFolder', (_e, p: string) => shell.showItemInFolder(expandHome(p)))
  ipcMain.on('shell:openPath', (_e, p: string) => void shell.openPath(expandHome(p)))

  ipcMain.handle('clipboard:read', () => clipboard.readText())
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text))

  ipcMain.on('notify', (_e, req: NotifyRequest) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: req.title, body: req.body, silent: false })
    liveNotifications.add(n)
    const forget = (): void => {
      liveNotifications.delete(n)
    }
    n.on('click', () => {
      focusWindow()
      mainWindow?.webContents.send('focus-pane', { workspaceId: req.workspaceId, paneId: req.paneId })
      forget()
    })
    n.on('close', forget)
    n.show()
    // Don't hold on to notifications forever if the OS never reports them closed.
    setTimeout(forget, 10 * 60 * 1000).unref()
  })

  ipcMain.on('badge', (_e, count: number) => {
    try {
      app.setBadgeCount(Math.max(0, Math.floor(count)))
    } catch {
      // unsupported platform
    }
    if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '')
  })
  ipcMain.on('window:flashFrame', () => {
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true)
  })

  ipcMain.on('app:infoSync', (e) => {
    e.returnValue = {
      platform: process.platform,
      homeDir: os.homedir(),
      version: app.getVersion(),
      shell: defaultShell(),
      isDev,
      e2e: process.env.TPM_E2E === '1'
    }
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusWindow())

  app.whenReady().then(() => {
    store = new StateStore(app.getPath('userData'))
    registerIpc()
    installMenu(sendMenuAction, isDev)
    if (process.platform === 'darwin') {
      const icon = iconPath()
      if (icon) app.dock?.setIcon(nativeImage.createFromPath(icon))
    }
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // On macOS the agents keep running when the window is closed; reopening the
  // window re-attaches to them. Everywhere else closing the window quits.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    ptys.killAll()
  })
}
