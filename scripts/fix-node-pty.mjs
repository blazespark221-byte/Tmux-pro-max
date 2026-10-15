// node-pty ships a `spawn-helper` binary on macOS that must be executable.
// Some package managers drop the exec bit when extracting prebuilds, which makes
// every terminal fail with "posix_spawnp failed". Restore it defensively.
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform !== 'darwin') process.exit(0)

const roots = [join('node_modules', 'node-pty', 'prebuilds'), join('node_modules', 'node-pty', 'build', 'Release')]
for (const root of roots) {
  if (!existsSync(root)) continue
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) stack.push(full)
      else if (name === 'spawn-helper') {
        try {
          chmodSync(full, 0o755)
        } catch {
          // best effort
        }
      }
    }
  }
}
