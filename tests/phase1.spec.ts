/**
 * Phase 1 Acceptance Tests
 * Tests all 5 cases from test-cases.md against the live Supabase edge function.
 *
 * NOTE: The engine reads `life_limit` and `cycles_used` from engine_llps.
 * The DB has `limit_cycles` and `cycles_since_new`.
 * If tests fail with "missing Life Limit / Cycles Used", it means the engine
 * field names need to be updated to match the DB schema.
 *
 * Run: npx playwright test
 * Run with UI: npx playwright test --ui
 */

import { test, expect, Page } from '@playwright/test'

const EMAIL = process.env.TEST_EMAIL || ''
const PASSWORD = process.env.TEST_PASSWORD || ''

if (!EMAIL || !PASSWORD) {
  throw new Error('Set TEST_EMAIL and TEST_PASSWORD in .env.local before running tests.')
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function login(page: Page) {
  await page.goto('/')
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button:has-text("Sign In")')
  await expect(page.getByRole('button', { name: 'Create Engine' })).toBeVisible()
}

async function createEngine(page: Page): Promise<string> {
  await page.click('button:has-text("Create Engine")')
  // Wait for the readonly UUID input to appear and have a value
  const uuidInput = page.locator('input[readonly]')
  await expect(uuidInput).not.toHaveValue('')
  return uuidInput.inputValue()
}

async function saveTechData(page: Page, data: {
  csn: string
  cspr?: string
  tspr?: string
  cslv?: string
  ecslv?: string
  cso?: string
  tso?: string
  tslv?: string
}) {
  await page.fill('input[placeholder="Cycles Since New"]', data.csn)
  if (data.cspr) await page.fill('input[placeholder="CSPR"]', data.cspr)
  if (data.tspr) await page.fill('input[placeholder="TSPR"]', data.tspr)
  if (data.cslv) await page.fill('input[placeholder="CSLV"]', data.cslv)
  if (data.ecslv) await page.fill('input[placeholder="ECSLV"]', data.ecslv)
  if (data.cso) await page.fill('input[placeholder="CSO"]', data.cso)
  if (data.tso) await page.fill('input[placeholder="TSO"]', data.tso)
  if (data.tslv) await page.fill('input[placeholder="TSLV"]', data.tslv)
  await page.click('button:has-text("Add Technical Data")')
  await expect(page.getByText('Technical Data saved')).toBeVisible()
}

async function addLlpRow(page: Page, row: {
  group_name?: string
  part_name: string
  life_limit: string
  cycles_used: string
  remaining_cycles: string
}) {
  if (row.group_name) await page.fill('input[placeholder="Group Name"]', row.group_name)
  await page.fill('input[placeholder="Part Name"]', row.part_name)
  await page.fill('input[placeholder="e.g. 20000"]', row.life_limit)
  await page.fill('input[placeholder="e.g. 13509"]', row.cycles_used)
  await page.fill('input[placeholder="e.g. 6491"]', row.remaining_cycles)
  await page.click('button:has-text("Add Row")')
  // Wait for row to appear in the table
  await expect(page.locator(`td:has-text("${row.part_name}")`)).toBeVisible()
}

async function runCalculation(page: Page, intent: string) {
  await page.selectOption('select:has(option[value=""])', { label: intent })
  await page.click('button:has-text("Run Calculation")')
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 30000 })
}

// ── CASE 1: Explicit Baseline — DISK governs ─────────────────────────────────
// CSPR = 6,200 | CSN = 32,000 | LLP remaining min = 5,500
// Intent = Lease Placement, Toggle OFF
// Expected: GT_BASE=3800, binding=DISK, baseline=Explicit, confidence=MEDIUM
// Disclosures: D-ASSUMP-DEFAULT, D-SCENARIO, D-MODEL-LIM
test('Case 1 — Explicit Baseline, DISK governs', async ({ page }) => {
  await login(page)
  await createEngine(page)

  await saveTechData(page, {
    csn: '32000',
    cspr: '6200',
  })

  await addLlpRow(page, {
    part_name: 'Fan Disk',
    life_limit: '20000',
    cycles_used: '14500',
    remaining_cycles: '5500',
  })

  await runCalculation(page, 'Lease Placement')

  // Core assertions
  await expect(page.locator('text=3,800 cycles').first()).toBeVisible()        // GT_BASE
  await expect(page.getByText('DISK', { exact: true })).toBeVisible()          // Binding constraint
  await expect(page.getByText('Explicit', { exact: true })).toBeVisible()      // Baseline type
  await expect(page.getByText('MEDIUM', { exact: true })).toBeVisible()        // Confidence

  // Disclosures
  await expect(page.getByText('D-ASSUMP-DEFAULT', { exact: true })).toBeVisible()
  await expect(page.getByText('D-SCENARIO', { exact: true })).toBeVisible()
  await expect(page.getByText('D-MODEL-LIM', { exact: true })).toBeVisible()

  // Must NOT be blocked
  await expect(page.getByText('BLOCKED', { exact: true })).not.toBeVisible()
})

// ── CASE 2: Validated Baseline — GT zero, runway exhausted ────────────────────
// CSO = 13,509 | No CSPR | LLP cycles_used clustered ~13,509
// Intent = Financing, Toggle OFF
// Expected: GT_BASE=0, baseline=Validated, confidence=LOW
// Disclosures: D-VAL-BASE, D-GT-ZERO, D-ASSUMP-DEFAULT, D-SCENARIO, D-MODEL-LIM
test('Case 2 — Validated Baseline, GT zero', async ({ page }) => {
  await login(page)
  await createEngine(page)

  await saveTechData(page, {
    csn: '28000',
    cso: '13509',
    // No CSPR
  })

  // LLP cycles_used clustered around 13,509 — validates the CSO counter
  await addLlpRow(page, {
    part_name: 'Fan Disk',
    life_limit: '20000', cycles_used: '13480', remaining_cycles: '6520',
  })
  await addLlpRow(page, {
    part_name: 'Core Disk',
    life_limit: '20000', cycles_used: '13512', remaining_cycles: '6488',
  })
  await addLlpRow(page, {
    part_name: 'LPT Disk',
    life_limit: '17525', cycles_used: '13525', remaining_cycles: '4000',
  })

  await runCalculation(page, 'Financing')

  // GT_BASE must be 0
  await expect(page.getByText('0 cycles').first()).toBeVisible()
  await expect(page.getByText('Validated', { exact: true })).toBeVisible()
  await expect(page.getByText('LOW', { exact: true })).toBeVisible()

  // Disclosures
  await expect(page.getByText('D-VAL-BASE', { exact: true })).toBeVisible()
  await expect(page.getByText('D-GT-ZERO', { exact: true })).toBeVisible()
  await expect(page.getByText('D-ASSUMP-DEFAULT', { exact: true })).toBeVisible()
  await expect(page.getByText('D-SCENARIO', { exact: true })).toBeVisible()
  await expect(page.getByText('D-MODEL-LIM', { exact: true })).toBeVisible()

  await expect(page.getByText('BLOCKED')).not.toBeVisible()
})

// ── CASE 3: Inferred Baseline — No counters, consistent LLP pattern ───────────
// CSN = 32,661 | No CSPR / CSO / CSLV | LLP cycles_used ≈ 13,509 across all
// Intent = Purchase / Sale, Toggle OFF
// Expected: GT_BASE=0, baseline=Inferred, confidence=LOW
// Disclosures: D-INF-BASE, D-GT-ZERO, D-ASSUMP-DEFAULT, D-SCENARIO, D-MODEL-LIM
test('Case 3 — Inferred Baseline, no counters available', async ({ page }) => {
  await login(page)
  await createEngine(page)

  await saveTechData(page, {
    csn: '32661',
    // No CSPR, CSO, CSLV
  })

  // LLP cycles_used consistently ~13,509 — triggers inferred baseline
  await addLlpRow(page, {
    part_name: 'Fan Disk',
    life_limit: '20000', cycles_used: '13509', remaining_cycles: '6491',
  })
  await addLlpRow(page, {
    part_name: 'Core Disk',
    life_limit: '20000', cycles_used: '13509', remaining_cycles: '6491',
  })
  await addLlpRow(page, {
    part_name: 'LPT Disk',
    life_limit: '19509', cycles_used: '13509', remaining_cycles: '6000',
  })

  await runCalculation(page, 'Purchase / Sale')

  await expect(page.getByText('0 cycles').first()).toBeVisible()
  await expect(page.getByText('Inferred', { exact: true })).toBeVisible()
  await expect(page.getByText('LOW', { exact: true })).toBeVisible()

  await expect(page.getByText('D-INF-BASE', { exact: true })).toBeVisible()
  await expect(page.getByText('D-GT-ZERO', { exact: true })).toBeVisible()
  await expect(page.getByText('D-ASSUMP-DEFAULT', { exact: true })).toBeVisible()
  await expect(page.getByText('D-SCENARIO', { exact: true })).toBeVisible()
  await expect(page.getByText('D-MODEL-LIM', { exact: true })).toBeVisible()

  await expect(page.getByText('BLOCKED')).not.toBeVisible()
})

// ── CASE 4: Conflicting Explicit Counters — Hard Stop ────────────────────────
// CSPR = 6,000 | TSPR = 10,800 — both explicit, differ >5% → BLOCK
// Expected: BLOCKED, D-CONF-BASE, D-MODEL-LIM
test('Case 4 — Conflicting explicit counters, hard stop', async ({ page }) => {
  await login(page)
  await createEngine(page)

  await saveTechData(page, {
    csn: '20000',
    cspr: '6000',
    tspr: '10800',  // Raw value differs from CSPR by >5% → engine triggers BLOCK
  })

  await addLlpRow(page, {
    part_name: 'Fan Disk',
    life_limit: '20000', cycles_used: '6000', remaining_cycles: '14000',
  })

  await runCalculation(page, 'Lease Placement')

  // Must be blocked
  await expect(page.getByText('⛔ BLOCKED', { exact: true })).toBeVisible()
  // No GT values should be shown
  await expect(page.getByText('GT_BASE')).not.toBeVisible()
})

// ── CASE 5: LLP Governs — Hard-Life Cap ───────────────────────────────────────
// Need GT_DISK = 6,000 → use CSPR = 4,000, Lease Placement (target 10,000 cycles)
// LLP limiting remaining = 1,250 → GT_LLP caps GT_BASE
// Expected: GT_BASE=1250, GT_LLP=1250, binding=LLP
// Disclosures: D-LLP-CAP, D-LIMIT-PROX, D-MODEL-LIM
test('Case 5 — LLP governs, hard-life cap', async ({ page }) => {
  await login(page)
  await createEngine(page)

  await saveTechData(page, {
    csn: '20000',
    cspr: '4000',  // GT_DISK = 10000 - 4000 = 6000 cycles (Lease Placement defaults)
  })

  // One LLP with only 1,250 remaining — this caps GT_BASE
  await addLlpRow(page, {
    part_name: 'Core Disk (Limiting)',
    life_limit: '20000', cycles_used: '18750', remaining_cycles: '1250',
  })
  // Other LLPs with plenty of life
  await addLlpRow(page, {
    part_name: 'Fan Disk',
    life_limit: '20000', cycles_used: '4000', remaining_cycles: '16000',
  })

  await runCalculation(page, 'Lease Placement')

  // GT_BASE and GT_LLP should both be 1,250
  await expect(page.getByText('1,250 cycles').first()).toBeVisible()
  await expect(page.getByText('LLP', { exact: true })).toBeVisible()                 // Binding constraint

  await expect(page.getByText('D-LLP-CAP', { exact: true })).toBeVisible()
  await expect(page.getByText('D-LIMIT-PROX', { exact: true })).toBeVisible()
  await expect(page.getByText('D-MODEL-LIM', { exact: true })).toBeVisible()

  await expect(page.getByText('BLOCKED')).not.toBeVisible()
})
