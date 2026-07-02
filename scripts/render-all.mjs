// Render an FMD config and screenshot EVERY page tab. Reports console/page errors.
// Usage: node scripts/render-all.mjs <config.fmd> [outPrefix]
import { chromium } from 'playwright'
import { readFileSync } from 'fs'
const file = process.argv[2], prefix = process.argv[3] || 'page'
const config = readFileSync(file, 'utf8')
const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1280, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push('console.error: ' + m.text()) })
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.code-input', { timeout: 20000 })
await page.fill('.code-input', config)
await page.waitForTimeout(1800)
const tabs = await page.locator('.fmd-menu button').allInnerTexts().catch(() => [])
console.log('TABS:', JSON.stringify(tabs))
const seen = new Set()
const targets = tabs.length ? tabs : ['(single)']
for (let i = 0; i < targets.length; i++) {
  const t = targets[i]
  if (t !== '(single)') { await page.click(`.fmd-menu button:has-text("${t}")`, { timeout: 3000 }).catch(()=>{}); await page.waitForTimeout(700) }
  const txt = await page.locator('.preview-scroll').innerText().catch(()=>'(none)')
  const tags = await page.evaluate(() => Array.from(document.querySelectorAll('.preview-scroll [class*="fmd-"], .preview-scroll .widget, .preview-scroll table, .preview-scroll .cases-list, .preview-scroll .detail')).map(e=>e.className.split(' ').find(c=>c.startsWith('fmd-')||['widget','cases-list','detail'].includes(c))).filter((v,j,a)=>a.indexOf(v)===j).join(','))
  console.log(`\n=== TAB ${i}: ${t} ===`)
  console.log(txt.split('\n').slice(0,14).join(' | '))
  console.log('components:', tags)
  await page.screenshot({ path: `scratch/${prefix}-${i}.png` }).catch(()=>{})
}
console.log('\nERRORS:', errs.length ? '\n' + errs.join('\n') : 'none')
await b.close()
