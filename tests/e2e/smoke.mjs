// End-to-end smoke test: launches the built app (run `npm run build` first) and
// drives it like a user would. On Linux without a display, run it under xvfb:
//   xvfb-run -a npm run test:e2e
import { _electron as electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shots = path.join(root, 'tests/e2e/screenshots')
mkdirSync(shots, { recursive: true })

const isMac = process.platform === 'darwin'
const mod = (key) => (isMac ? `Meta+${key}` : `Control+Shift+${key}`)
const SHORTCUT = {
  newWorkspace: mod('KeyT'),
  splitRight: mod('KeyD'),
  closePane: mod('KeyW'),
  broadcast: mod('KeyB'),
  zoom: isMac ? 'Meta+Enter' : 'Control+Shift+Enter'
}

const work = mkdtempSync(path.join(tmpdir(), 'tpm-e2e-'))
const userData = path.join(work, 'user-data')
const repo = path.join(work, 'demo-project')
const claudeConfig = path.join(work, 'claude-config')
mkdirSync(repo, { recursive: true })
mkdirSync(claudeConfig, { recursive: true })
writeFileSync(path.join(repo, 'README.md'), '# demo\n')
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
git('init', '-q', '-b', 'main')
git('add', '.')
git('-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'commit', '-q', '-m', 'init')

let failures = 0
const check = (cond, message) => {
  if (cond) console.log(`  ✓ ${message}`)
  else {
    failures++
    console.log(`  ✗ ${message}`)
  }
}

async function waitFor(fn, { timeout = 15000, interval = 150, label = 'condition' } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeout) {
    try {
      last = await fn()
      if (last) return last
    } catch (err) {
      last = err
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error(`Timed out waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`)
}

async function launch() {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, '--no-sandbox'],
    env: {
      ...process.env,
      TPM_USER_DATA_DIR: userData,
      TPM_E2E: '1',
      CLAUDE_CONFIG_DIR: claudeConfig,
      ELECTRON_ENABLE_LOGGING: '1'
    }
  })
  const win = await app.firstWindow()
  win.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`    [renderer error] ${msg.text()}`)
  })
  win.on('pageerror', (err) => {
    failures++
    console.log(`    [page error] ${err.message}`)
  })
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

const paneIds = (win) => win.$$eval('.workspace.active [data-pane-id]', (els) => els.map((e) => e.getAttribute('data-pane-id')))
const paneText = (win, id) => win.evaluate((paneId) => window.__tpm.text(paneId), id)
const shot = (win, name) => win.screenshot({ path: path.join(shots, `${name}.png`) })

async function clickPane(win, id) {
  const box = await (await win.$(`[data-pane-id="${id}"] .terminal-container`)).boundingBox()
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

async function main() {
  console.log(`work dir: ${work}`)
  let { app, win } = await launch()

  console.log('Welcome screen')
  await win.waitForSelector('.welcome', { timeout: 15000 })
  check(true, 'welcome screen renders')
  await shot(win, '01-welcome')

  console.log('Create a 3 top · 3 bottom workspace of terminals')
  await win.keyboard.press(SHORTCUT.newWorkspace)
  await win.waitForSelector('.modal-card')
  check(true, 'new workspace shortcut opens the dialog')
  const folderInput = win.locator('.input-with-button input')
  await folderInput.fill(repo)
  await win.waitForSelector('.field-hint:has-text("git repository")')
  check(true, 'folder recognised as a git repository')
  await win.locator('.preset', { hasText: '3 top · 3 bottom' }).click()
  await win.locator('.agent-chip', { hasText: 'Terminal' }).click()
  check((await win.$$('.preview-cell')).length === 6, 'preview shows 6 panes')
  await shot(win, '02-new-workspace')
  await win.locator('button', { hasText: 'Create workspace' }).click()

  await waitFor(async () => (await paneIds(win)).length === 6, { label: '6 panes' })
  check(true, '6 panes created')
  let ids = await paneIds(win)
  // Every shell should come up and print a prompt.
  await waitFor(
    async () => {
      for (const id of ids) if (!(await paneText(win, id)).trim()) return false
      return true
    },
    { label: 'shell prompts', timeout: 20000 }
  )
  check(true, 'all 6 shells started')

  const rects = await win.$$eval('.workspace.active .pane', (els) => els.map((e) => e.getBoundingClientRect().toJSON()))
  const tops = [...new Set(rects.map((r) => Math.round(r.top)))]
  check(tops.length === 2, `panes are arranged in 2 rows (found ${tops.length})`)

  await clickPane(win, ids[0])
  await win.keyboard.type('echo hello-from-pane-1\n')
  await waitFor(async () => (await paneText(win, ids[0])).split('hello-from-pane-1').length >= 3, { label: 'echo output' })
  check(true, 'typing into a pane runs commands')
  await shot(win, '03-grid')

  console.log('Split, close and zoom')
  await win.keyboard.press(SHORTCUT.splitRight)
  await waitFor(async () => (await paneIds(win)).length === 7, { label: '7 panes' })
  check(true, 'split shortcut adds a pane')
  await new Promise((r) => setTimeout(r, 800))
  await win.keyboard.press(SHORTCUT.closePane)
  await win.waitForSelector('.modal-card:has-text("Close")')
  await win.keyboard.press('Enter')
  await waitFor(async () => (await paneIds(win)).length === 6, { label: 'back to 6 panes' })
  check(true, 'close shortcut asks for confirmation and removes the pane')

  await clickPane(win, ids[1])
  await win.keyboard.press(SHORTCUT.zoom)
  await win.waitForSelector('.pane.zoomed')
  check(true, 'zoom shortcut maximises the focused pane')
  await shot(win, '04-zoom')
  await win.keyboard.press(SHORTCUT.zoom)
  await waitFor(async () => !(await win.$('.pane.zoomed')), { label: 'unzoom' })

  console.log('Resize with a divider')
  const firstPane = `[data-pane-id="${ids[0]}"]`
  const before = await win.$eval(firstPane, (e) => e.getBoundingClientRect().width)
  const divider = await win.$('.workspace.active .divider-col')
  const dbox = await divider.boundingBox()
  await win.mouse.move(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2)
  await win.mouse.down()
  await win.mouse.move(dbox.x + dbox.width / 2 + 120, dbox.y + dbox.height / 2, { steps: 6 })
  await win.mouse.up()
  const after = await win.$eval(firstPane, (e) => e.getBoundingClientRect().width)
  check(after - before > 80, `dragging a divider resizes panes (${Math.round(before)} → ${Math.round(after)}px)`)

  console.log('Broadcast')
  ids = await paneIds(win)
  await win.keyboard.press(SHORTCUT.broadcast)
  await win.waitForSelector('.broadcast-bar textarea')
  await win.keyboard.type('echo broadcast-ok')
  await shot(win, '05-broadcast')
  await win.keyboard.press('Enter')
  await waitFor(
    async () => {
      for (const id of ids) if ((await paneText(win, id)).split('broadcast-ok').length < 3) return false
      return true
    },
    { label: 'broadcast output in every pane' }
  )
  check(true, 'broadcast runs the prompt in all 6 panes')
  await win.keyboard.press('Escape')

  console.log('Attention on bell')
  await clickPane(win, ids[2])
  await win.keyboard.type("sleep 1.5; printf '\\a'\n")
  await clickPane(win, ids[3])
  await waitFor(async () => !!(await win.$(`[data-pane-id="${ids[2]}"].attention`)), { label: 'attention ring', timeout: 8000 })
  check(true, 'a bell in an unfocused pane raises attention')
  check(!!(await win.$('.workspace-item .attention-badge')), 'sidebar shows an attention badge')
  await shot(win, '06-attention')
  await clickPane(win, ids[2])
  await waitFor(async () => !(await win.$(`[data-pane-id="${ids[2]}"].attention`)), { label: 'attention cleared' })
  check(true, 'focusing the pane clears attention')

  console.log('Persistence across restarts')
  await new Promise((r) => setTimeout(r, 800))
  await app.close()
  ;({ app, win } = await launch())
  await waitFor(async () => (await paneIds(win)).length === 6, { label: 'restored panes' })
  check(true, 'workspace and its 6 panes are restored')
  const restored = await paneIds(win)
  await waitFor(async () => (await paneText(win, restored[0])).trim().length > 0, { label: 'restored shell output' })
  check(true, 'restored panes start their shells again')

  console.log('Claude Code panes in isolated git worktrees')
  await win.keyboard.press(SHORTCUT.newWorkspace)
  await win.waitForSelector('.modal-card')
  await win.locator('.input-with-button input').fill(repo)
  await win.waitForSelector('.field-hint:has-text("git repository")')
  await win.locator('.name-field input').fill('claude-squad')
  await win.locator('.preset', { hasText: 'Side by side' }).click()
  await win.locator('.agent-chip', { hasText: 'Claude Code' }).click()
  await win.locator('.toggle-row input[type="checkbox"]').check()
  await shot(win, '07-claude-dialog')
  await win.locator('button', { hasText: 'Create workspace' }).click()
  await waitFor(async () => (await win.$$('.workspace-item')).length === 2, { label: 'second workspace' })
  await waitFor(async () => (await paneIds(win)).length === 2, { label: '2 claude panes' })
  const worktrees = git('worktree', 'list')
  check(
    worktrees.split('\n').filter((l) => l.includes('tpm/claude-squad')).length === 2,
    'two worktrees on tpm/claude-squad-* branches'
  )
  const chips = await win.$$eval('.workspace.active .pane-chip', (els) => els.map((e) => e.textContent))
  check(chips.length === 2 && chips.every((c) => c.includes('tpm/claude-squad')), 'pane headers show each agent’s branch')
  const claudeIds = await paneIds(win)
  const claudeFound = existsSync('/opt/node22/bin/claude') || !!process.env.CLAUDE_PATH
  if (claudeFound) {
    await waitFor(async () => (await paneText(win, claudeIds[0])).trim().length > 20, {
      label: 'Claude Code TUI',
      timeout: 30000
    }).catch(() => null)
    await new Promise((r) => setTimeout(r, 4000))
    const text = await paneText(win, claudeIds[0])
    check(text.trim().length > 20, 'Claude Code renders its interface in the pane')
  }
  await shot(win, '08-claude-panes')

  console.log('Switch agent, restart and exit')
  await win.locator(`[data-pane-id="${claudeIds[1]}"] .pane-agent`).click()
  await win.locator('.dropdown .agent-menu-item', { hasText: 'Terminal' }).click()
  await waitFor(
    async () => (await win.locator(`[data-pane-id="${claudeIds[1]}"] .pane-agent-name`).textContent()) === 'Terminal',
    { label: 'agent switched' }
  )
  await waitFor(async () => /[#$%>] *$/m.test(await paneText(win, claudeIds[1])), { label: 'shell prompt after switch' })
  check(true, 'switching a pane to another agent restarts it with that agent')
  await clickPane(win, claudeIds[1])
  await win.keyboard.type('echo before-restart\n')
  await waitFor(async () => (await paneText(win, claudeIds[1])).includes('before-restart'), { label: 'pre-restart output' })
  await win.keyboard.press(isMac ? 'Meta+Shift+KeyR' : 'Control+Shift+KeyR')
  await waitFor(
    async () => {
      const t = await paneText(win, claudeIds[1])
      return !t.includes('before-restart') && t.trim().length > 0
    },
    { label: 'restarted pane' }
  )
  check(true, 'restart shortcut starts a fresh process')
  await clickPane(win, claudeIds[1])
  await win.keyboard.type('exit\n')
  await win.waitForSelector(`[data-pane-id="${claudeIds[1]}"] .exit-banner`)
  check(true, 'exited process shows a restart banner')
  await shot(win, '09-exited')
  await win.keyboard.press('Enter')
  await waitFor(async () => !(await win.$(`[data-pane-id="${claudeIds[1]}"] .exit-banner`)), { label: 'banner gone' })
  check(true, 'pressing Enter in an exited pane restarts it')

  console.log('Settings & shortcuts dialogs')
  await win.keyboard.press(isMac ? 'Meta+Comma' : 'Control+Comma')
  await win.waitForSelector('.modal-card:has-text("Settings")')
  await shot(win, '10-settings')
  await win.keyboard.press('Escape')
  await win.keyboard.press(isMac ? 'Meta+Slash' : 'Control+Shift+Slash')
  await win.waitForSelector('.modal-card:has-text("Keyboard shortcuts")')
  await shot(win, '11-shortcuts')
  await win.keyboard.press('Escape')

  await app.close()
  // Worktrees live under ~/.tmux-pro-max/worktrees; remove the ones this test created.
  for (const line of git('worktree', 'list', '--porcelain').split('\n')) {
    const wt = line.startsWith('worktree ') ? line.slice('worktree '.length) : null
    if (wt && wt.includes('.tmux-pro-max')) {
      rmSync(wt, { recursive: true, force: true })
      rmSync(path.dirname(wt), { recursive: true, force: true })
    }
  }
  console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`)
  if (!process.env.TPM_E2E_KEEP) rmSync(work, { recursive: true, force: true })
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
