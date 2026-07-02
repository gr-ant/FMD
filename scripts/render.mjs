// Render an FMD config in the editor preview and dump what it looks like.
// Usage: node scripts/render.mjs <config.fmd> [pageTabToClick]
// Non-destructive: types into the editor (does not save to the config store).
import { chromium } from 'playwright'
import { readFileSync } from 'fs'

const file = process.argv[2]
const tab = process.argv[3]
if (!file) { console.error('usage: node scripts/render.mjs <config.fmd> [tab]'); process.exit(1) }
const config = readFileSync(file, 'utf8')
const URL = process.env.FMD_URL || 'http://localhost:5173'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()) })

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.code-input', { timeout: 20000 })
await page.fill('.code-input', config)
await page.waitForTimeout(1800)
if (tab) { await page.click(`.fmd-menu button:has-text("${tab}")`, { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(900) }

const preview = page.locator('.preview-scroll').first()
const text = await preview.innerText().catch(() => '(no .preview-scroll found)')
await preview.screenshot({ path: 'scratch/render.png' }).catch(() => page.screenshot({ path: 'scratch/render.png' }))

console.log('=== PREVIEW TEXT ===\n' + text)
console.log('\n=== RENDERED TAGS ===')
console.log(await page.evaluate(() => Array.from(document.querySelectorAll('.preview-scroll .cases-list, .preview-scroll .detail, .preview-scroll .fmd-view, .preview-scroll table, .preview-scroll .widget, .preview-scroll .cases-link')).map(e => e.className.split(' ')[0]).join(', ')))
if (errs.length) console.log('\n=== ERRORS ===\n' + errs.join('\n'))
console.log('\n=== screenshot: scratch/render.png ===')
await browser.close()
