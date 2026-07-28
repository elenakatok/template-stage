// ═══════════════════════════════════════════════════════════════════════════════
// PLACEHOLDER payoff function — REPLACE_FROM_TEMPLATE.
//
// ⚠ THE ONE RULE OF THIS FILE: it is PURE. No firebase, no admin SDK, no Date, no
// Math.random, no reads of anything outside its arguments. That is what lets the
// round-loop harness import it directly and assert payoffs without an emulator, and
// what lets a unit test cover the whole payoff surface in milliseconds.
//
// The engine INVOKES this. It never computes a payoff, and there must never be a
// second copy of these formulas anywhere — not in the UI "so the student can see the
// number early", not in the report, not in the bot. Every one of those is a drift
// source. If a screen needs a payoff, it renders one this function returned.
// ═══════════════════════════════════════════════════════════════════════════════

import type { RoundSettings } from './settings'

/** The round's drawn state. Generic on purpose — name it for your game. */
export type DrawnState = 'up' | 'down'

export interface RoundInput {
  /** Alpha's message. Free — it need not match `state`. */
  signal: DrawnState
  /** Beta's committed quantity. */
  quantity: number
  /** The truth Alpha saw and Beta did not. */
  state: DrawnState
}

export interface RoundOutcome {
  signal: DrawnState
  quantity: number
  state: DrawnState
  capacity: number
  sold: number
  profits: { alpha: number; beta: number }
}

/** Capacity implied by the drawn state. */
export function capacityOf(state: DrawnState, s: RoundSettings): number {
  return state === 'up' ? s.highCapacity : s.lowCapacity
}

export function resolveRound(input: RoundInput, s: RoundSettings): RoundOutcome {
  const capacity = capacityOf(input.state, s)
  const sold = Math.min(input.quantity, capacity)
  return {
    signal: input.signal,
    quantity: input.quantity,
    state: input.state,
    capacity,
    sold,
    profits: {
      // Alpha is paid on what sells and bears none of the commitment cost — so Alpha
      // always prefers a larger quantity, whatever the true state. That asymmetry is
      // what gives the placeholder game a reason for Alpha to shade the signal, and
      // is the shape most cheap-talk stage games have.
      alpha: s.alphaRate * sold,
      beta: s.betaRate * sold - s.unitCost * input.quantity,
    },
  }
}

/** Legality of a quantity. Returned as a reason string so the engine can reject it. */
export function validateQuantity(quantity: number, s: RoundSettings): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(quantity) || quantity < s.minQuantity || quantity > s.maxQuantity) {
    return { ok: false, reason: `Choose a whole number between ${s.minQuantity} and ${s.maxQuantity}.` }
  }
  return { ok: true }
}
