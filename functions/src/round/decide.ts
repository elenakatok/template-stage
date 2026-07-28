// ═══════════════════════════════════════════════════════════════════════════════
// THE BOT BRAIN — ONE `decide()`, CANONICALLY HERE, INSIDE functions/.
//
// ⚠ THIS IS A SLOT, NOT A BOT. `decide()` throws until the spawning game writes it.
// That is deliberate: per Extraction Spec §2.2 what generalises across stage games is
// the DRIVER SHELL — windows, tiling, drive-to-ready, the read→decide→act→wait loop,
// the launcher button. What never generalises is the strategy and the read/act wiring.
// Scaffolding a working bot here would mean shipping a strategy for a game that does
// not exist yet, and a plausible-looking wrong bot is worse than an absent one.
//
// ── WHY THIS FILE LIVES IN functions/src/round/ ───────────────────────────────
// Because TWO RUNNERS SHARE ONE BRAIN:
//
//   • the SERVER runner — fills a bot seat in a real class (functions/src/botRunner.ts)
//   • the BROWSER runner — robot mode, headed Playwright (bot/robot-driver.mjs)
//
// The server runner is deployed code, so the brain must be inside functions/ to be
// packaged at all. The browser runner then imports the COMPILED output
// (functions/lib/round/decide.js) rather than keeping its own copy.
//
// An earlier game in this fleet ended up with a mirrored strategy file and a drift
// test holding the two copies together. That was an accident of file placement, not a
// real constraint, and it must not be reproduced: a drift test is a confession that
// two copies exist. There is ONE copy, here.
//
// ── WHAT decide() MAY AND MAY NOT SEE ────────────────────────────────────────
// It is handed a SEAT VIEW — exactly what a human in that seat can see, and nothing
// more. Never the full round state, never another seat's pending submission, never a
// round field the reveal rule is withholding. A bot that peeks is not a bot, it is a
// bug that wins, and the leak assertions in the harness will not catch it because the
// bot runs server-side where nothing is on the wire.
// ═══════════════════════════════════════════════════════════════════════════════

import type { RoundSettings } from './settings'
import type { SeatView, SeatAction } from './spec'

/**
 * Choose this seat's action for the stage it currently owes.
 *
 * PURE. Same view + same settings ⇒ same action, always. Any randomness must be drawn
 * from a seeded stream derived from the view (round, seat), never from Math.random —
 * otherwise a replay of a class diverges and no harness assertion about a bot can be
 * pinned.
 *
 * @throws until the spawning game implements it.
 */
export function decide(_view: SeatView, _settings: RoundSettings): SeatAction {
  throw new Error(
    '[template-stage] decide() is not implemented. This is the bot-strategy SLOT — ' +
    'the template ships the driver shell and the wiring, never a strategy. Implement ' +
    'it in functions/src/round/decide.ts (the canonical location: the server bot ' +
    'runner and the browser robot driver both read THIS function, and there must ' +
    'never be a second copy). See Spawn_A_New_Game_Playbook §6 and the game spec\'s ' +
    'bot-strategy section for the behaviour to write.',
  )
}

/**
 * Has a strategy been written yet? Lets the server runner and the robot driver fail
 * with one clear sentence instead of an unhandled throw in the middle of a class.
 *
 * REMOVE THIS once `decide()` is implemented — a permanent capability check invites
 * a silent "bots are off today" path, and a bot seat that quietly does nothing is
 * indistinguishable from a student who did not turn up.
 */
export function isStrategyImplemented(): boolean {
  return false
}

// ── seeded randomness, for a strategy that needs it ───────────────────────────

/**
 * Mulberry32. Deterministic, dependency-free, and identical to the stream the engine
 * uses — so a bot's draws are reproducible in a replay.
 */
export function makeRng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
