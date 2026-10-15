import { Menu, app, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { SHORTCUTS, toElectronAccelerator } from '@shared/shortcuts'
import type { MenuAction } from '@shared/types'

// On macOS we install a native menu. Shortcuts are listed for discoverability but
// handled by the renderer (registerAccelerator: false) so a key press never fires
// twice. On Linux/Windows the menu bar is removed entirely; the renderer handles
// every shortcut itself.

export function installMenu(send: (action: MenuAction) => void, isDev: boolean): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }

  const item = (action: MenuAction, label?: string): MenuItemConstructorOptions => {
    const def = SHORTCUTS.find((s) => s.action === action)
    return {
      label: label ?? def?.label ?? action,
      accelerator: def?.mac ? toElectronAccelerator(def.mac) : undefined,
      registerAccelerator: false,
      click: () => send(action)
    }
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        item('settings', 'Settings…'),
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [item('new-workspace', 'New Workspace…'), { type: 'separator' }, item('close-pane'), item('close-workspace')]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('find', 'Find…'),
        item('clear')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('toggle-sidebar'),
        item('zoom-pane'),
        { type: 'separator' },
        item('font-bigger'),
        item('font-smaller'),
        item('font-reset'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev
          ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: 'Pane',
      submenu: [
        item('split-right'),
        item('split-down'),
        item('restart-pane'),
        item('toggle-broadcast', 'Broadcast to All Panes…'),
        { type: 'separator' },
        item('focus-left'),
        item('focus-right'),
        item('focus-up'),
        item('focus-down'),
        item('next-pane'),
        item('prev-pane')
      ]
    },
    {
      label: 'Workspace',
      submenu: [
        item('next-workspace'),
        item('prev-workspace'),
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => item(`workspace-${i + 1}` as MenuAction))
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        item('shortcuts', 'Keyboard Shortcuts'),
        { label: 'Project on GitHub', click: () => void shell.openExternal('https://github.com/blazespark221-byte/Tmux-pro-max') }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
