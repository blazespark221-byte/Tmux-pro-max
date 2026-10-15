// Renders build/icon.png (1024×1024) from an inline SVG using Playwright's Chromium.
// Run: node scripts/render-icon.mjs
import { chromium } from 'playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/icon.png')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8b95ff"/>
      <stop offset="1" stop-color="#d97757"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#bg)"/>
  <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#shine)"/>
  <g fill="#0b0d10">
    <rect x="232" y="232" width="262" height="262" rx="54" opacity="0.88"/>
    <rect x="530" y="232" width="262" height="262" rx="54" opacity="0.62"/>
    <rect x="232" y="530" width="262" height="262" rx="54" opacity="0.62"/>
    <rect x="530" y="530" width="262" height="262" rx="54" opacity="0.88"/>
  </g>
  <g fill="none" stroke="#e8eaee" stroke-width="30" stroke-linecap="round" stroke-linejoin="round">
    <path d="M298 318 L358 363 L298 408"/>
  </g>
  <rect x="380" y="392" width="70" height="26" rx="8" fill="#e8eaee"/>
  <rect x="596" y="596" width="130" height="26" rx="8" fill="#d97757"/>
  <rect x="596" y="646" width="90" height="26" rx="8" fill="#d97757" opacity="0.7"/>
</svg>`

// CHROMIUM_PATH lets you point at an existing Chromium instead of Playwright's download.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
await page.locator('svg').screenshot({ path: out, omitBackground: true })
await browser.close()
console.log(`wrote ${out}`)
