import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// GUI apps on macOS (and some Linux launchers) start with a minimal PATH, so
// `claude`, `codex`, nvm-managed node etc. would not be found. Resolve the
// environment a login + interactive shell would see once at startup, the same
// trick VS Code uses.

let resolvedEnv: Record<string, string> | null = null
let pending: Promise<Record<string, string>> | null = null

export function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC || 'cmd.exe'
  let shell = process.env.SHELL
  if (!shell) {
    try {
      shell = os.userInfo().shell ?? undefined
    } catch {
      shell = undefined
    }
  }
  return shell || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
}

const STRIP_EXACT = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SSE_PORT',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TERM_SESSION_ID',
  'ITERM_SESSION_ID',
  'TMUX',
  'TMUX_PANE',
  'STY',
  'COLUMNS',
  'LINES',
  'PWD',
  'OLDPWD',
  'INIT_CWD',
  'NODE_ENV_ELECTRON_VITE',
  'GOOGLE_API_KEY_ELECTRON'
])

function sanitize(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (STRIP_EXACT.has(key)) continue
    if (key.startsWith('npm_') || key.startsWith('ELECTRON_')) continue
    out[key] = value
  }
  return out
}

function extraPathDirs(): string[] {
  const home = os.homedir()
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    return appData ? [path.join(appData, 'npm')] : []
  }
  return [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.opencode', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin'
  ]
}

function finalize(env: Record<string, string>): Record<string, string> {
  const out = sanitize(env)
  const pathKey = Object.keys(out).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const sep = path.delimiter
  const parts = (out[pathKey] ?? '').split(sep).filter(Boolean)
  for (const dir of extraPathDirs()) if (!parts.includes(dir)) parts.push(dir)
  out[pathKey] = parts.join(sep)
  if (process.platform !== 'win32') {
    if (!out.LANG) out.LANG = 'en_US.UTF-8'
    if (!out.SHELL) out.SHELL = defaultShell()
  }
  return out
}

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function readLoginShellEnv(timeoutMs: number): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const mark = `__TPM_ENV_${Math.random().toString(36).slice(2)}__`
    const script = `${quote(process.execPath)} -p '"${mark}" + JSON.stringify(process.env) + "${mark}"'`
    const child = spawn(defaultShell(), ['-i', '-l', '-c', script], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }
    })
    let stdout = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // already gone
      }
      reject(new Error('Timed out resolving the login shell environment'))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
    child.stderr.on('data', () => {})
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const start = stdout.indexOf(mark)
      const end = stdout.lastIndexOf(mark)
      if (start < 0 || end <= start) return reject(new Error('Could not parse login shell environment'))
      try {
        resolve(JSON.parse(stdout.slice(start + mark.length, end)))
      } catch (err) {
        reject(err)
      }
    })
  })
}

export function resolveShellEnv(): Promise<Record<string, string>> {
  if (resolvedEnv) return Promise.resolve(resolvedEnv)
  if (pending) return pending
  pending = (async () => {
    let base: Record<string, string | undefined> = process.env
    if (process.platform !== 'win32') {
      try {
        base = await readLoginShellEnv(10_000)
      } catch (err) {
        console.warn('[shell-env] falling back to process.env:', (err as Error).message)
      }
    }
    resolvedEnv = finalize(base as Record<string, string>)
    return resolvedEnv
  })()
  return pending
}

function isExecutable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false
    if (process.platform === 'win32') return true
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** Look a binary up on PATH (honouring PATHEXT on Windows). */
export function findExecutable(bin: string, env: Record<string, string>): string | null {
  const expanded = expandHome(bin)
  if (expanded.includes('/') || expanded.includes('\\')) return isExecutable(expanded) ? expanded : null
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const dirs = (env[pathKey] ?? '').split(path.delimiter).filter(Boolean)
  const exts =
    process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.toLowerCase())] : ['']
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, bin + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}
