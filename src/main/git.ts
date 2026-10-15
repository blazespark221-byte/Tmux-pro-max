import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CreateWorktreeResult, GitInfo } from '@shared/types'
import { expandHome } from './shell-env'

function git(
  args: string[],
  cwd: string,
  env: Record<string, string>
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error
        ? typeof (error as NodeJS.ErrnoException).code === 'number'
          ? Number((error as NodeJS.ErrnoException).code)
          : 1
        : 0
      resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() || (error && !stderr ? error.message : '') })
    })
  })
}

export async function gitInfo(dir: string, env: Record<string, string>): Promise<GitInfo> {
  const cwd = expandHome(dir)
  if (!existsSync(cwd)) return { isRepo: false }
  const top = await git(['rev-parse', '--show-toplevel'], cwd, env)
  if (top.code !== 0) return { isRepo: false }
  const root = top.stdout.trim()
  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, env)
  return { isRepo: true, root, branch: head.code === 0 ? head.stdout.trim() : undefined }
}

export function sanitizeBranch(hint: string): string {
  const cleaned = hint
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/-{2,}/g, '-')
    .replace(/(^[-/.]+|[-/.]+$)/g, '')
  return cleaned || 'agent'
}

export function worktreesRoot(): string {
  return path.join(os.homedir(), '.tmux-pro-max', 'worktrees')
}

async function branchExists(repoRoot: string, branch: string, env: Record<string, string>): Promise<boolean> {
  const res = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot, env)
  return res.code === 0
}

/** Create a new branch + worktree for one agent so parallel agents don't trample each other's files. */
export async function createWorktree(
  repoRoot: string,
  branchHint: string,
  env: Record<string, string>
): Promise<CreateWorktreeResult> {
  const root = expandHome(repoRoot)
  const info = await gitInfo(root, env)
  if (!info.isRepo || !info.root) return { ok: false, error: `${root} is not a git repository` }

  const head = await git(['rev-parse', '--verify', 'HEAD'], info.root, env)
  if (head.code !== 0)
    return {
      ok: false,
      error: 'The repository has no commits yet, so a worktree cannot be created. Make an initial commit first.'
    }

  const repoName = path.basename(info.root)
  const hash = createHash('sha1').update(info.root).digest('hex').slice(0, 6)
  const baseDir = path.join(worktreesRoot(), `${repoName}-${hash}`)
  mkdirSync(baseDir, { recursive: true })

  const base = sanitizeBranch(branchHint)
  let branch = base
  let dir = path.join(baseDir, branch.replace(/\//g, '-'))
  for (let n = 2; (await branchExists(info.root, branch, env)) || existsSync(dir); n++) {
    branch = `${base}-${n}`
    dir = path.join(baseDir, branch.replace(/\//g, '-'))
    if (n > 500) return { ok: false, error: 'Could not find a free branch name' }
  }

  const res = await git(['worktree', 'add', '-b', branch, dir, 'HEAD'], info.root, env)
  if (res.code !== 0) return { ok: false, error: res.stderr.trim() || 'git worktree add failed' }
  return { ok: true, worktree: { path: dir, branch, repoRoot: info.root } }
}

export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  env: Record<string, string>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await git(['worktree', 'remove', worktreePath], expandHome(repoRoot), env)
  if (res.code !== 0) return { ok: false, error: res.stderr.trim() || 'git worktree remove failed' }
  return { ok: true }
}
