import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readdir, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { PersistedState } from '@shared/types'

export class StateStore {
  private writing: Promise<void> = Promise.resolve()
  private latest: string | null = null

  constructor(private readonly dir: string) {}

  private get file(): string {
    return path.join(this.dir, 'state.json')
  }

  load(): PersistedState | null {
    if (!existsSync(this.file)) return null
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as PersistedState
      if (data && data.version === 1 && Array.isArray(data.workspaces)) return data
      return null
    } catch (err) {
      // Keep the unreadable file around for debugging instead of silently losing it.
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`)
      } catch {
        // ignore
      }
      console.error('[state] failed to read state:', (err as Error).message)
      return null
    }
  }

  /** Queue an async write; only the newest state is written if several arrive while busy. */
  save(state: PersistedState): void {
    this.latest = JSON.stringify(state, null, 2)
    this.writing = this.writing.then(async () => {
      const content = this.latest
      if (content === null) return
      this.latest = null
      const tmp = `${this.file}.tmp`
      try {
        await writeFile(tmp, content, 'utf8')
        await rename(tmp, this.file)
      } catch (err) {
        console.error('[state] failed to save state:', (err as Error).message)
      }
    })
  }

  saveSync(state: PersistedState): void {
    this.latest = null
    const tmp = `${this.file}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
      renameSync(tmp, this.file)
    } catch (err) {
      console.error('[state] failed to save state:', (err as Error).message)
    }
  }
}

export function claudeConfigDir(env: Record<string, string>): string {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether Claude Code has a transcript for this session id (so `--resume <id>` will work). */
export async function claudeSessionExists(sessionId: string, env: Record<string, string>): Promise<boolean> {
  if (!UUID.test(sessionId)) return false
  const projects = path.join(claudeConfigDir(env), 'projects')
  let dirs: string[]
  try {
    dirs = await readdir(projects)
  } catch {
    return false
  }
  const file = `${sessionId}.jsonl`
  return dirs.some((d) => existsSync(path.join(projects, d, file)))
}
