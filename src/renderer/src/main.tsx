import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { App } from './components/App'
import { getTerminal } from './lib/terminals'
import { hydrateStore } from './store/app'

const isMac = window.tpm.info.platform === 'darwin'
document.documentElement.dataset.platform = isMac ? 'mac' : window.tpm.info.platform

if (window.tpm.info.e2e) {
  // Read-only hooks for the end-to-end smoke test (canvas rendering hides text from the DOM).
  Object.assign(window, {
    __tpm: {
      text(paneId: string): string {
        const term = getTerminal(paneId)?.term
        if (!term) return ''
        const buf = term.buffer.active
        const lines: string[] = []
        for (let i = 0; i < buf.length; i++) {
          const line = buf.getLine(i)
          const text = line?.translateToString(true) ?? ''
          // Soft-wrapped rows continue the previous line.
          if (line?.isWrapped && lines.length > 0) lines[lines.length - 1] += text
          else lines.push(text)
        }
        return lines.join('\n')
      }
    }
  })
}

void hydrateStore().then(() => {
  createRoot(document.getElementById('root')!).render(<App />)
})
