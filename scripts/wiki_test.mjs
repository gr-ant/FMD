// Wiki visual verification — drives the configurator on :5213 to screenshot the
// Wiki panel for both the wedding config and a line-items config.
// Usage: node scripts/wiki_test.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

mkdirSync('scratch', { recursive: true })

const WEDDING_FMD = `[App Name] Wedding Planner

[Display] Home
  [Title] Wedding Planner
  [TopMenu] Home, Schedule, Budget

  [Button -> Event] New Event
  [Table -> Schedule] Time, Activity

[Display] Schedule
    [cTable -> Schedule] Time, Activity, Vendor, VendorStatus

[Display] Budget
    [Table -> Budget] Category, Spent, Cap, Remaining

[Form -> Schedule] New Event
    [Field "Start of Event" ()] Time
    [Fields] Activity, Vendor

[Action] Approve All Vendors
  [Update -> Vendors ? Status == False] Status = true

[Trigger -> Vendors ? Status == False] Auto-check vendors
  [Update] Status = true

[Data]
  [List Schedule] txtTime, txtActivity, linkVendor
  (Vendors) -> Vendors Name ? Status
  [Lookup] VendorStatus = Vendor.Status
  [List Vendors] txtName, boolStatus
    [Permission]
      {Admin} read, create, update, delete
      {Staff} read, update
  [List Budget] dropCategory, curSpent, curCap, curRemaining
  (Category) Venue, Catering, Photography, Flowers
  [Calc] Remaining = Cap - Spent

[Role] Admin
[Role] Staff
`

const LINE_ITEMS_FMD = `[App Name] Sales Orders

[Display] Orders
  [cudTable -> Orders] Number, Customer, Total

[Form -> Orders] New Order
  [Fields] !Number, Customer
  [LineItems -> OrderLines] Item, !1Qty, 2Price
  [Total] Subtotal = sum(Price * Qty)
  [Total] Tax = Subtotal * 0.1
  [Total] Grand = Subtotal + Tax

[Data]
  [List Orders] txtNumber, linkCustomer, curTotal
  [List OrderLines] linkOrder, txtItem, numQty, curPrice
  [List Customers] txtName, txtEmail
`

const URL = 'http://localhost:5213'

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

async function openWiki(fmd) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
  await page.waitForSelector('.code-input', { timeout: 10000 })
  await page.fill('.code-input', fmd)
  await page.waitForTimeout(1000)
  // Open Menu dropdown
  await page.click('button:has-text("Menu")')
  await page.waitForTimeout(300)
  // Click App wiki
  await page.click('button:has-text("App wiki")')
  await page.waitForTimeout(800)
  const panel = page.locator('.wiki-panel').first()
  await panel.waitFor({ timeout: 5000 })
  return panel
}

let exitCode = 0

try {
  // ---- Wedding config ----
  const wPanel = await openWiki(WEDDING_FMD)
  const wText = await wPanel.textContent()
  await page.screenshot({ path: 'scratch/wiki_wedding.png' })
  console.log('Wedding wiki (first 400 chars):', wText.slice(0, 400))

  const checks_wedding = [
    ['app name', wText.includes('Wedding Planner')],
    ['pages listed', wText.includes('Home') && wText.includes('Schedule')],
    ['lookup field', wText.includes('VendorStatus')],
    ['calc badge', wText.includes('Calc')],
    ['action', wText.includes('Approve All Vendors')],
    ['trigger section', wText.includes('Trigger')],
    ['permission matrix', wText.includes('admin') && wText.includes('staff')],
    ['roles', wText.includes('Admin') || wText.includes('Staff')],
  ]
  for (const [label, ok] of checks_wedding) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${label}`)
    if (!ok) exitCode = 1
  }

  // Close the wiki panel
  await page.click('.wiki-close')
  await page.waitForTimeout(300)

  // ---- Line items config ----
  const liPanel = await openWiki(LINE_ITEMS_FMD)
  const liText = await liPanel.textContent()
  await page.screenshot({ path: 'scratch/wiki_lineitems.png' })
  console.log('\nLine items wiki (first 300 chars):', liText.slice(0, 300))

  const checks_li = [
    ['app name', liText.includes('Sales Orders')],
    ['lineitems section', liText.includes('Line items')],
    ['totals', liText.includes('Subtotal') && liText.includes('Grand')],
    ['form fields', liText.includes('Number') && liText.includes('Customer')],
  ]
  for (const [label, ok] of checks_li) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'} — ${label}`)
    if (!ok) exitCode = 1
  }

  // Also screenshot with the "Data" section filter active
  await page.click('button:has-text("Data (")')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'scratch/wiki_lineitems_data.png' })
  console.log('\nScreenshots: scratch/wiki_wedding.png, scratch/wiki_lineitems.png, scratch/wiki_lineitems_data.png')

} catch (e) {
  console.error('Test error:', e)
  exitCode = 1
} finally {
  await browser.close()
  process.exit(exitCode)
}
