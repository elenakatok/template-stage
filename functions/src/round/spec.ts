// ═══════════════════════════════════════════════════════════════════════════════
// THE GAME, DECLARED — ⚠ PLACEHOLDER_GAME.
//
// ── THE TWO MARKERS, AND WHY THERE ARE TWO ───────────────────────────────────
//   REPLACE_FROM_TEMPLATE   unspawned IDENTITY — game_id, domain, secret name, prefix.
//                           A BLOCKER. The Playbook gate asserts this to zero and the
//                           harness fails the build until it is.
//   PLACEHOLDER_GAME        the template's stand-in GAME — payoffs, stages, screens.
//                           SCHEDULED WORK. Counted and reported, never asserted.
//
// They were one marker until the first real spawn, where the two demands collided: the
// gate must be zero before deploying, and a Part-1 spawn deliberately keeps the
// placeholder game. One marker forces a choice between a gate that fails for the whole
// build (and gets ignored) and one silenced by deleting markers off unwritten code —
// which is how a gate stops meaning anything. Keep them separate.
//
// This file DECLARES the game; @mygames/stage-engine RUNS it. Everything
// game-specific — payoffs, draws, the default table, legality — is INJECTED here and
// invoked by the engine, never computed by it. There is no game theory in the engine
// and there must never be any.
//
// ── THE PLACEHOLDER GAME ──────────────────────────────────────────────────────
// Two seats, two stages, one hidden draw, three rounds. It is deliberately the
// smallest game that still exercises every mechanism a real stage game needs, so that
// a spawn can delete it one piece at a time and always have something that runs:
//
//   round open   the engine draws `state_draw` — 'up' or 'down'
//   stage signal  ALPHA sends 'up' or 'down'. Alpha SEES the true draw. The signal
//                 need not match it: cheap talk is the point of the shape.
//   stage respond BETA commits a quantity, having seen the signal and NOT the draw.
//   resolution    payoffs; the draw becomes public and lands in history.
//
// ── THE FOUR MECHANISMS, AND WHERE THEY ARE ──────────────────────────────────
//  1. SEQUENTIAL-WITH-OBSERVATION  `observes: [STAGE_SIGNAL]` on the respond stage.
//     Omit it and the stage sees nothing earlier — opt-in, so a simultaneous stage is
//     sealed by construction rather than by remembering to hide something.
//  2. STAGE-SCOPED FIELD REVEAL    `fields[]` below. `state_draw` is visible to Alpha
//     throughout, to nobody else until `revealAt: 'resolution'`.
//  3. INJECTED DEFAULTS            `defaultFor` on every stage, because `hasClock` is
//     true. The engine has no fallback and will never invent one.
//  4. INJECTED LEGALITY            `validate`. The engine enforces turn order and
//     double-submission itself; everything about the VALUE is the game's business.
//
// ── THE RULE THAT KEEPS PRIVATE STATE PRIVATE ────────────────────────────────
// A key of `roundFields` with NO matching entry in `fields[]` is UNDECLARED, and
// undeclared round state is private at every point in the round — `visibleFields`
// only ever exposes declared fields. So server-side bookkeeping (a counter a default
// needs, a cached total) rides `roundFields` safely by simply not being declared.
// Declaring a field public costs one line; leaking one costs a class.
// ═══════════════════════════════════════════════════════════════════════════════

import type { Seat, StageGameSpec, StageContext, RoundRecord } from '@mygames/stage-engine'
import type { RoundSettings } from './settings'
import { resolveRound, validateQuantity, type DrawnState } from './resolver'

// ── roles ──────────────────────────────────────────────────────────────────────

/**
 * ⚠ GENERIC ON PURPOSE. Rename both of these for your game and the compiler will walk
 * you through every site that has to change. Roles are assigned LATE (immediately
 * before round 1, seeded shuffle), so the MATCHING role in gameDefinition.ts is a
 * single undifferentiated `player` — these two are the SEAT roles and matching never
 * sees them.
 */
export type GameRole = 'alpha' | 'beta'
export const GAME_ROLES: GameRole[] = ['alpha', 'beta']

export const ROLE_LABEL: Record<GameRole, string> = { alpha: 'Alpha', beta: 'Beta' }

// ── stages ─────────────────────────────────────────────────────────────────────

export const STAGE_SIGNAL = 'signal'
export const STAGE_RESPOND = 'respond'
export const STAGE_ORDER = [STAGE_SIGNAL, STAGE_RESPOND] as const
export type StageId = (typeof STAGE_ORDER)[number]

// ── round-state fields ─────────────────────────────────────────────────────────

/**
 * DECLARED, and therefore subject to the reveal rules below. Drawn at round open, so
 * it exists on the server before Beta decides — the engine is what keeps it off
 * Beta's wire, and the harness asserts the ABSENCE of the key rather than trusting it.
 */
export const FIELD_STATE = 'state_draw'

// ── the action and the result ──────────────────────────────────────────────────

/**
 * One seat's submission. A discriminated union, so a seat cannot submit the wrong
 * stage's action shape and have it silently typecheck.
 */
export type SeatAction =
  | { kind: 'signal'; signal: DrawnState }
  | { kind: 'respond'; quantity: number }

/** What the injected resolver returns; the stored history record is built from it. */
export interface RoundResult {
  signal: DrawnState
  quantity: number
  state: DrawnState
  capacity: number
  sold: number
  profits: { alpha: number; beta: number }
}

export type EngineRecord = RoundRecord<SeatAction, RoundResult>
export type GameStageContext = StageContext<SeatAction>

/**
 * What one seat may see right now — the shape the student UI renders and the ONLY
 * thing `decide()` is handed.
 *
 * ⚠ `state` is OPTIONAL and that is load-bearing. When the reveal rule withholds the
 * draw the key is ABSENT — not null, not undefined-but-present. A leaked-but-blank key
 * still tells Beta that a draw exists and that the server chose to hide it, and it
 * survives a careless `?? 'unknown'` downstream. Consumers must test presence
 * (`'state' in view`) or compare strictly; never `view.state == null`.
 */
export interface SeatView {
  seat: number
  role: GameRole
  status: 'in_progress' | 'finished'
  round: number
  /** null when the round count is hidden and the game is still running. */
  numRounds: number | null
  stage: StageId | null
  owes: StageId | null
  /** Alpha's signal, once the signal stage has closed. */
  currentSignal: DrawnState | null
  /** Present ONLY where the reveal rule allows it. See the warning above. */
  state?: DrawnState
  history: StoredRoundRecord[]
  pendingCount: number
}

/** One completed round, as stored and as the history table renders it. */
export interface StoredRoundRecord {
  round: number
  alphaSeat: number
  betaSeat: number
  signal: DrawnState
  quantity: number
  state: DrawnState
  sold: number
  profits: { alpha: number; beta: number }
  /** Seats whose submission came from a clock default. Reported, never charted. */
  defaulted: { alpha: boolean; beta: boolean }
}

// ── reading the engine's per-round submissions ────────────────────────────────

type Subs = Readonly<Record<string, Readonly<Record<Seat, SeatAction>>>>

export function seatOfRole(roleBySeat: Readonly<Record<Seat, string>>, role: GameRole): Seat {
  const found = Object.keys(roleBySeat).find((s) => roleBySeat[Number(s)] === role)
  return found === undefined ? -1 : Number(found)
}

export function signalOf(subs: Subs, roleBySeat: Readonly<Record<Seat, string>>): DrawnState | null {
  const a = (subs[STAGE_SIGNAL] ?? {})[seatOfRole(roleBySeat, 'alpha')]
  return a && a.kind === 'signal' ? a.signal : null
}

export function quantityOf(subs: Subs, roleBySeat: Readonly<Record<Seat, string>>): number | null {
  const a = (subs[STAGE_RESPOND] ?? {})[seatOfRole(roleBySeat, 'beta')]
  return a && a.kind === 'respond' ? a.quantity : null
}

// ── the spec ───────────────────────────────────────────────────────────────────

export interface SpecOptions {
  settings: RoundSettings
  numRounds: number
}

/**
 * ── ON DRAWS AND SEEDS ────────────────────────────────────────────────────────
 * `openRound` below draws from the ENGINE's seeded stream (the `rng` argument),
 * derived from the group's seed in state. That is the right default: reproducible,
 * JSON-serialisable, and nothing extra to thread through.
 *
 * The one reason to do otherwise is PARITY WITH AN EXISTING GAME — if a game already
 * shipped with its own `makeRng(seed + round * k)` stream, adopting the engine's would
 * silently change which rounds drew what for every existing seed, taking every
 * seed-pinned harness assertion with it. Such a game closes over its own `seed` in
 * `SpecOptions` instead. A NEW game has no such history and should not invent one.
 */
export function makeGameSpec({ settings: s, numRounds }: SpecOptions): StageGameSpec<SeatAction, RoundResult> {
  return {
    // THE DECLARED ROLE UNIVERSE. Every role key used in `actingRoles` or `visibleTo`
    // must appear here, so a mistyped key is caught at spec validation — before any
    // group exists — rather than silently skipping a stage at run time.
    roles: GAME_ROLES,

    stages: [
      {
        id: STAGE_SIGNAL,
        actingRoles: ['alpha'],
        validate: (_seat, action) => {
          if (action.kind !== 'signal') return 'Only Alpha sends a signal.'
          return action.signal === 'up' || action.signal === 'down' ? null : 'Choose up or down.'
        },
        /**
         * The clock default. It must be a COMPETENT move, so the present partner's
         * game stays intact — a default that plays badly punishes the student who DID
         * turn up. It is recorded against the absent seat in `timeouts` and surfaces
         * in the timeout report; it never touches anyone's score automatically.
         */
        defaultFor: () => ({ kind: 'signal', signal: 'up' }),
      },
      {
        id: STAGE_RESPOND,
        actingRoles: ['beta'],
        // Beta may see the signal. Beta may NOT see `state_draw` — that is the
        // `fields[]` rule below, not this one. `observes` governs SUBMISSIONS.
        observes: [STAGE_SIGNAL],
        validate: (_seat, action) => {
          if (action.kind !== 'respond') return 'Only Beta commits a quantity.'
          const check = validateQuantity(action.quantity, s)
          return check.ok ? null : check.reason
        },
        defaultFor: () => ({ kind: 'respond', quantity: Math.round((s.minQuantity + s.maxQuantity) / 2) }),
      },
    ],

    fields: [
      /**
       * THE REVEAL. Alpha sees the draw from the moment the round opens (that is what
       * makes Alpha the informed side); nobody else sees it until the round resolves.
       *
       * `revealAt: 'resolution'` is the terminal reveal. To reveal MID-round instead —
       * at the moment a later stage opens, so the acting seats can decide on it — name
       * that stage id here; the reveal is INCLUSIVE of the named stage and permanent
       * for the rest of the round.
       */
      { name: FIELD_STATE, visibleTo: ['alpha'], revealAt: 'resolution' },
    ],

    roundCount: { mode: 'fixed', n: numRounds, display: 'shown', drawScope: 'group' },
    endCondition: { kind: 'fixedRounds' },
    groupSize: { n: 2 },

    /**
     * A GAME-LEVEL declaration, not a mode. The engine knows nothing about
     * classroom-versus-online and must not learn: mode lives in the game and the
     * shared platform. `hasClock: false` removes the timeout path entirely —
     * `expireStage` throws rather than quietly doing nothing, so a clockless game
     * cannot grow a clock by accident.
     *
     * A game that runs BOTH modes (classroom on a clock, online without one) declares
     * `true` here and simply never calls the clock callable in online instances.
     */
    hasClock: true,

    openRound: (_ctx, rng) => ({
      [FIELD_STATE]: (rng() < s.pUp ? 'up' : 'down') satisfies DrawnState,
    }),

    resolveRound: (input) => {
      const signal = signalOf(input.submissions, input.roleBySeat) ?? 'up'
      const quantity = quantityOf(input.submissions, input.roleBySeat) ?? s.minQuantity
      const state = (input.roundFields[FIELD_STATE] as DrawnState | undefined) ?? 'up'
      // INVOKED, never computed here.
      return resolveRound({ signal, quantity, state }, s)
    },
  }
}
