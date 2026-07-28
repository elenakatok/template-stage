// ═══════════════════════════════════════════════════════════════════════════════
// ROBOT MODE — the BROWSER runner. THE SHELL IS COMPLETE; THE STRATEGY IS NOT.
//
// Fills N seats of a live game with robots that PLAY THROUGH THE REAL UI in headed,
// tiled Chromium windows an instructor can watch. Per seat the driver:
//   1. drives login → knowledge check → prep → attendance → ready through the EXISTING
//      launcher (POST /api/student-url {mode:'ready'}) — nothing reimplemented here;
//   2. opens a tiled headed window at the ?token= game URL;
//   3. waits for the game to start, then runs read → decide → ACT-VIA-UI → wait until
//      the game finishes.
//
// ⚠ THIS FILE IS WHY THE TEMPLATE EXISTS. Robot mode kept not making it into a spawn
// without a separate prompt, because every game rebuilt the shell from scratch. The
// shell — windows, tiling, drive-to-ready, the loop, the launcher button — generalises
// completely. What does NOT generalise is exactly two things, both marked below:
//
//        ▸ SLOT 1  READ   turning the seat view into what decide() needs
//        ▸ SLOT 2  ACT    turning an action into clicks
//
// Fill those two, implement decide(), and robot mode works. Nothing else here changes.
//
// ── THE READ PATH, AND WHY IT IS NOT TESTID SCRAPING ─────────────────────────
// It reads `window.__gameState` directly — exactly what getRoundView returned. A label
// or testid rename therefore cannot break the robot, and, more importantly, the robot
// sees EXACTLY what the student sees and cannot accidentally read a hidden field.
//
// ── THE ACT PATH, AND WHY IT IS NOT A CALLABLE ───────────────────────────────
// Actions go THROUGH THE UI — click the button a student clicks. That is what makes a
// robot run a real test of the frontend rather than of the server, which the round-loop
// harness already covers. Do not "speed it up" by calling the callable directly; you
// would delete the only thing this runner tests that nothing else does.
//
// ── THE STRATEGY ─────────────────────────────────────────────────────────────
// Imported INWARD from functions/lib — the SAME compiled decide() the server bot runner
// uses. There is no mirrored copy and there must never be one; a drift test between two
// copies is a confession that two copies exist.
//
// Usage: node robot-driver.mjs --instance <id> [--seats 2] [--pace watch|fast]
//                              [--launcher http://localhost:5180] [--screen 1920x1080]
// Prereq: `npm run build` in ../functions, the launcher running, and an instructor who
// has generated an attendance code and started the game.
// ═══════════════════════════════════════════════════════════════════════════════

import { createRequire } from 'node:module'
import { decide, isStrategyImplemented } from '../functions/lib/round/decide.js'
import { DEFAULT_ROUND_SETTINGS as S } from '../functions/lib/round/settings.js'

// Playwright resolves from the repo root node_modules (installed for the harnesses);
// the bot directory has none of its own.
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

// ── CLI ────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {}
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k.startsWith('--')) {
      a[k.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i]
    }
  }
  return a
}
const args = parseArgs(process.argv.slice(2))
const INSTANCE = args.instance
const SEATS = Math.max(1, Math.min(16, Number(args.seats) || 2))
const PACE = String(args.pace || 'watch')
const LAUNCHER = String(args.launcher || 'http://localhost:5180').replace(/\/$/, '')
const [SCREEN_W, SCREEN_H] = String(args.screen || '1920x1080').split('x').map(Number)

if (!INSTANCE || INSTANCE === true) {
  console.error('ERROR: --instance <gameInstanceId> is required.')
  process.exit(1)
}

/**
 * Fail EARLY and by name if no strategy has been written. Without this the run reaches
 * the first decision, throws from inside a browser callback, and reads as a Playwright
 * problem — which is a genuinely confusing half-hour.
 */
if (!isStrategyImplemented()) {
  console.error(
    '\nROBOT MODE IS NOT WIRED YET.\n\n' +
    'This game still ships the template\'s bot-strategy SLOT. Implement decide() in\n' +
    'functions/src/round/decide.ts (and make isStrategyImplemented() return true, then\n' +
    'delete it), rebuild functions, and run this again.\n\n' +
    'The driver shell below needs no changes beyond SLOT 1 (read) and SLOT 2 (act).\n',
  )
  process.exit(2)
}

// "Watch" paces the robots at human speed so a class can follow along; "fast" is for
// a smoke run. Neither affects what is decided.
const THINK = PACE === 'watch' ? { min: 5000, max: 15000 } : { min: 700, max: 1400 }
const POLL_MS = 1500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const think = () => sleep(THINK.min + Math.random() * (THINK.max - THINK.min))

// ── window tiling ──────────────────────────────────────────────────────────────

function tile(index, total) {
  const cols = Math.ceil(Math.sqrt(total))
  const rows = Math.ceil(total / cols)
  const w = Math.floor(SCREEN_W / cols)
  const h = Math.floor(SCREEN_H / rows)
  return { x: (index % cols) * w, y: Math.floor(index / cols) * h, width: w, height: h }
}

// ── drive one seat to the game screen, via the launcher ────────────────────────

async function readyUrlFor(seatIndex) {
  const res = await fetch(`${LAUNCHER}/api/student-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ instance: INSTANCE, index: seatIndex, mode: 'ready' }),
  })
  if (!res.ok) throw new Error(`launcher /api/student-url failed: ${res.status} ${await res.text()}`)
  const body = await res.json()
  return body.url
}

// ═══════════════════════════════════════════════════════════════════════════════
// ▸ SLOT 1 — READ. ⚠ PLACEHOLDER_GAME.
//
// Turn the page's `window.__gameState` into whatever decide() takes. For the placeholder
// game they are the same object, so this is the identity — a real game usually needs
// nothing more either. Return null when the page is not on a decision yet.
// ═══════════════════════════════════════════════════════════════════════════════
async function readSeatView(page) {
  return page.evaluate(() => {
    const s = window.__gameState
    return s ? s.view : null
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// ▸ SLOT 2 — ACT. ⚠ PLACEHOLDER_GAME.
//
// Turn an action from decide() into clicks. THROUGH THE UI — see the header.
//
// One rule: wait for the control before clicking it. A robot that clicks faster than
// the page renders produces a flaky failure that looks like a game bug, and it will be
// investigated as one.
// ═══════════════════════════════════════════════════════════════════════════════
async function actInUi(page, action) {
  if (action.kind === 'signal') {
    const sel = `[data-testid="signal-choices-${action.signal}"]`
    await page.waitForSelector(sel, { timeout: 15000 })
    await page.click(sel)
    return
  }
  if (action.kind === 'respond') {
    const sel = `[data-testid="quantity-choices-${action.quantity}"]`
    await page.waitForSelector(sel, { timeout: 15000 })
    await page.click(sel)
    return
  }
  throw new Error(`actInUi: unknown action kind ${JSON.stringify(action)}`)
}

// ── the loop (SHARED — do not edit per game) ───────────────────────────────────

async function runSeat(page, label) {
  for (;;) {
    const view = await readSeatView(page)
    if (!view) { await sleep(POLL_MS); continue }
    if (view.status === 'finished') {
      console.log(`[${label}] game over`)
      return
    }
    if (!view.owes) { await sleep(POLL_MS); continue }

    await think()
    const action = decide(view, S)
    console.log(`[${label}] round ${view.round} ${view.stage} → ${JSON.stringify(action)}`)
    await actInUi(page, action)
    await sleep(POLL_MS)
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Robot mode: ${SEATS} seat(s) on instance ${INSTANCE} (pace=${PACE})`)
  const browsers = []
  const runs = []

  for (let i = 0; i < SEATS; i++) {
    const box = tile(i, SEATS)
    const browser = await chromium.launch({
      headless: false,
      args: [`--window-position=${box.x},${box.y}`, `--window-size=${box.width},${box.height}`],
    })
    browsers.push(browser)
    const page = await browser.newPage({ viewport: { width: box.width, height: box.height - 90 } })
    const url = await readyUrlFor(i)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    runs.push(runSeat(page, `seat ${i}`).catch((e) => console.error(`[seat ${i}]`, e.message)))
  }

  await Promise.all(runs)
  // Left open on purpose: the final screen is usually the thing worth looking at.
  console.log('All seats finished. Windows left open — close them when you are done.')
  void browsers
}

main().catch((e) => { console.error(e); process.exit(1) })
