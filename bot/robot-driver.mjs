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
/**
 * ⚠ DEFAULT TO A WHOLE GROUP. Filling EVERY seat with a robot is what makes a game run
 * unattended; one robot and an empty seat waits forever (online) or plays a game of
 * defaults (classroom), and neither tests anything. Set GROUP_SIZE to this game's seats.
 */
const GROUP_SIZE = 2
const SEATS = Math.max(1, Math.min(16, Number(args.seats) || GROUP_SIZE))
const PACE = String(args.pace || 'watch')
const LAUNCHER = String(args.launcher || 'http://localhost:5180').replace(/\/$/, '')
const [SCREEN_W, SCREEN_H] = String(args.screen || '1920x1080').split('x').map(Number)

if (!INSTANCE || INSTANCE === true) {
  console.error('ERROR: --instance <gameInstanceId> is required.')
  process.exit(1)
}

if (SEATS % GROUP_SIZE !== 0) {
  console.warn(
    `WARNING: --seats ${SEATS} is not a multiple of the group size (${GROUP_SIZE}).\n` +
    '         At least one group will be short a seat and will not finish on its own.',
  )
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
    // ⚠ `game_instance_id`, NOT `instance`. The launcher's /api/student-url requires
    // that exact key and 400s on anything else — the template shipped `instance`, so
    // robot mode was broken in every game spawned from it, and the failure surfaced as
    // a 400 from the launcher rather than as anything naming the driver.
    body: JSON.stringify({ game_instance_id: INSTANCE, index: seatIndex, mode: 'ready' }),
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
/** The test id for each action kind — the ids this game's decision screens render. */
const SELECTOR_FOR = (action) =>
    action.kind === 'signal'  ? `[data-testid="signal-choices-${action.signal}"]`
  : action.kind === 'respond' ? `[data-testid="quantity-choices-${action.quantity}"]`
  : null

async function actInUi(page, action) {
  const sel = SELECTOR_FOR(action)
  if (!sel) throw new Error(`actInUi: unknown action kind ${JSON.stringify(action)}`)
  /*
    ⚠ A MISSING CONTROL IS "THE SCREEN MOVED ON", NOT A FAILURE.

    This used to `waitForSelector` and throw on timeout, which killed the seat outright.
    The sequence that hit it: the driver clicked, polled before its own submission was
    reflected, decided again, and by the time it looked for the button the round had
    resolved and the RESULTS screen had replaced the decision screen. The control was
    legitimately gone, and the driver treated that as fatal — one round into a ten-round
    game, both seats dead.

    Returning false lets the loop re-read and find out what actually happened, which is
    the only honest response to "the thing I expected is not there".
  */
  const found = await page.waitForSelector(sel, { timeout: 8000 }).catch(() => null)
  if (!found) return false
  await page.click(sel).catch(() => {})
  return true
}

// ── the loop (SHARED — do not edit per game) ───────────────────────────────────

/**
 * Dismiss the round-results screen if it is up.
 *
 * ⚠ SHELL WORK, NOT A SLOT. `results-continue` is a FIXED test id on the shared
 * RoundResultsScreen widget, so this is identical for every stage game.
 *
 * Without it an all-robot game stalls after round 1: the round has resolved server-side,
 * but the results screen covers the decision controls so `actInUi` finds no button. In
 * ONLINE mode nothing dismisses it but a click — there is no timer — so the run hangs
 * indefinitely and looks like a game bug.
 */
async function dismissResultsIfShowing(page) {
  const btn = page.locator('[data-testid="results-continue"]')
  if (await btn.count() === 0) return false
  if (await btn.isDisabled().catch(() => true)) return false
  await btn.click().catch(() => {})
  return true
}


/**
 * WHERE THIS SEAT IS, as one comparable value: round, stage, and what it owes.
 *
 * ⚠ THIS IS THE THING THAT DISTINGUISHES "MY SUBMISSION LANDED" FROM "THE POLL RETURNED
 * THE SAME THING AGAIN", and getting that distinction wrong is how a waiter becomes
 * either a hang or a false pass.
 *
 * Unchanged tuple ⇒ genuinely nothing happened: same round, same stage, still owed.
 * Changed tuple   ⇒ the state moved past the point I acted at. `owes` going null is the
 *                   direct evidence that MY action was accepted — the server is the only
 *                   thing that can clear it for this seat.
 *
 * A tuple cannot change while my submission is still outstanding, and cannot stay the
 * same once it has landed, so the two cases can never be confused. (A clock default can
 * also move it, and that is fine: my action did not land but the state moved on, and
 * continuing is correct either way.)
 */
const positionOf = (v) => `${v.round}:${v.stage ?? ''}:${v.owes ?? ''}`

/**
 * Wait until this seat's position actually moves. Never a fixed sleep: a sleep long
 * enough to be safe is long enough to make a ten-round game take an hour, and a sleep
 * short enough to be quick re-decides before the submission is reflected — which is the
 * double-act this replaces.
 *
 * ⚠ ON TIMEOUT IT RETURNS 'timeout' AND THE CALLER CONTINUES. It does not throw and it
 * does not pretend to have moved. The loop re-reads; if the submission did land, `owes`
 * is null and nothing is re-sent; if it did not, the seat legitimately owes an action
 * again and retries. Neither branch can silently report success.
 */
async function waitForMove(page, before, label, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await sleep(POLL_MS)
    if (await dismissResultsIfShowing(page)) {
      console.log(`[${label}] continued past the round result`)
      return 'results'
    }
    const v = await readSeatView(page)
    if (!v) continue
    if (v.status === 'finished') return 'finished'
    if (positionOf(v) !== before) return 'moved'
  }
  console.warn(`[${label}] ⚠ no movement in ${timeoutMs}ms after acting — re-reading`)
  return 'timeout'
}

async function runSeat(page, label) {
  let actionsTaken = 0
  for (;;) {
    if (await dismissResultsIfShowing(page)) {
      console.log(`[${label}] continued past the round result`)
      await sleep(POLL_MS)
      continue
    }
    const view = await readSeatView(page)
    if (!view) { await sleep(POLL_MS); continue }
    if (view.status === 'finished') {
      /*
        ⚠ FINISHED WITHOUT HAVING PLAYED IS A FAILURE, NOT A FINISH.

        This used to return quietly, and the run then printed "All seats finished" and
        exited 0 — having taken ZERO actions. A robot run against an instance that was
        already played reported success while doing nothing at all, which is exactly the
        shape of every false green in this build: the exit condition was equally true of
        the working case and the broken one.

        It is a real situation, not a hypothetical: two course-ABC instances still held
        FINISHED round documents from an earlier placeholder-era run, so seats arriving
        on them saw `status: 'finished'` on their very first poll. The gate looked like a
        driver bug for an hour, and was stale data.

        So distinguish the two, and fail loudly on the one that proves nothing.
      */
      if (actionsTaken === 0) {
        console.error(
          `[${label}] ✗ THE GAME WAS ALREADY OVER WHEN THIS SEAT ARRIVED — no rounds were ` +
          `played by this robot.\n` +
          `        The instance already holds a FINISHED round document for this group, ` +
          `almost certainly from an earlier run.\n` +
          `        Use a fresh instance. Reporting failure rather than a silent success.`)
        throw new Error(`${label}: game already finished on arrival (0 actions taken)`)
      }
      console.log(`[${label}] game over — ${actionsTaken} action(s) taken`)
      return
    }
    if (!view.owes) { await sleep(POLL_MS); continue }

    await think()
    const action = decide(view, S)
    const before = positionOf(view)
    console.log(`[${label}] round ${view.round} ${view.stage} → ${JSON.stringify(action)}`)
    const clicked = await actInUi(page, action)
    if (!clicked) {
      // The control vanished between deciding and clicking — the screen moved on under
      // us. Do NOT count it as an action and do NOT retry blindly; re-read instead.
      console.log(`[${label}] the control was gone — re-reading rather than retrying`)
      await sleep(POLL_MS)
      continue
    }
    actionsTaken++
    await waitForMove(page, before, label)
  }
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Robot mode: ${SEATS} seat(s) on instance ${INSTANCE} (pace=${PACE}) — ` +
    `${SEATS / GROUP_SIZE} full group(s)`)
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
