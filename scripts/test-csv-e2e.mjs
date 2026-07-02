// Playwright integration test for the CSV import modal.
// Intercepts POSTs to /api/workorders and asserts one per CSV data row.
import { chromium } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONFIG = `
[Data]
[List WorkOrders] txtName, txtStatus

[Display]
[Import -> WorkOrders] Import CSV
`

const SMALL_CSV = `Name,Status
Alice,Active
Bob,Inactive
Carol,Pending`

async function run() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })

  // intercept POST /api/workorders — capture bodies, return 201 {}
  const captured = []
  await ctx.route('**/api/workorders', (route) => {
    if (route.request().method() === 'POST') {
      route.request().postDataJSON().then((body) => {
        captured.push(body)
      }).catch(() => captured.push(null))
      route.fulfill({ status: 201, contentType: 'application/json', body: '{"_id":1}' })
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    }
  })
  // also stub GET /api/workorders (data source)
  await ctx.route('**/api/workorders**', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    } else {
      route.continue()
    }
  })
  // stub config / schema fetches
  await ctx.route('**/api/**', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    } else {
      route.continue()
    }
  })

  const page = await ctx.newPage()
  await page.goto('http://localhost:5224/')

  // wait for the code editor textarea
  await page.waitForSelector('.code-input', { timeout: 15000 })

  // fill config via triple-click-select-all + type
  await page.click('.code-input')
  await page.keyboard.press('Control+a')
  await page.keyboard.type(CONFIG)
  // wait for the parser to re-render (debounced), look for the Import button
  await page.waitForSelector('button.fmd-button.csv-import-btn', { timeout: 10000 })

  // screenshot: button visible
  await page.screenshot({ path: path.join(__dirname, 'shot-01-button.png') })
  console.log('Step 1: Import CSV button found.')

  // click to open modal
  await page.click('button.fmd-button.csv-import-btn')
  await page.waitForSelector('.csv-modal', { timeout: 5000 })
  await page.screenshot({ path: path.join(__dirname, 'shot-02-paste-step.png') })
  console.log('Step 2: Modal opened (paste step).')

  // paste CSV
  await page.fill('.csv-textarea', SMALL_CSV)
  await page.click('button:has-text("Next: Map columns")')
  await page.waitForSelector('.csv-map-table', { timeout: 5000 })
  await page.screenshot({ path: path.join(__dirname, 'shot-03-map-step.png') })
  console.log('Step 3: Map step visible.')

  // advance to preview
  await page.click('button:has-text("Preview")')
  await page.waitForSelector('.csv-preview-table', { timeout: 5000 })
  await page.screenshot({ path: path.join(__dirname, 'shot-04-preview-step.png') })
  console.log('Step 4: Preview visible.')

  // click Import
  await page.click('button:has-text("Import 3 rows")')
  // wait for the done step
  await page.waitForSelector('.csv-done', { timeout: 10000 })
  await page.screenshot({ path: path.join(__dirname, 'shot-05-done.png') })
  console.log('Step 5: Done step visible.')

  // give the intercept a tick to settle
  await page.waitForTimeout(500)
  console.log(`Captured POST bodies: ${JSON.stringify(captured)}`)

  // verify: 3 POSTs, one per data row
  if (captured.length !== 3) {
    console.error(`FAIL: expected 3 POSTs, got ${captured.length}`)
    await browser.close(); process.exit(1)
  }
  const names = captured.map((b) => b?.Name).sort()
  const wantNames = ['Alice','Bob','Carol'].sort()
  if (JSON.stringify(names) !== JSON.stringify(wantNames)) {
    console.error(`FAIL: Name values wrong. Got: ${names}`)
    await browser.close(); process.exit(1)
  }
  console.log('PASS: 3 POSTs intercepted with correct mapped bodies.')
  await browser.close()
}

run().catch((e) => { console.error(e); process.exit(1) })
