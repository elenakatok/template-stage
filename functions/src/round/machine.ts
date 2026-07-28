// ═══════════════════════════════════════════════════════════════════════════════
// THE STORE LAYER — engine state in, engine state out.
//
// ⚠ READ THIS BEFORE YOU ADD A CONVERSION FUNCTION.
//
// A new game persists `GameState` from @mygames/stage-engine DIRECTLY. There is no
// per-game state shape, no `toEngineState`/`fromEngineState` pair, and no schema
// marker. Everything below is Firestore plumbing: JSON in, JSON out, plus one revival
// step for numeric keys.
//
// The reference game this template was extracted from DOES have such a conversion
// layer. It exists because that game shipped its own stored shape first and acquired
// ~170 readers of it before the engine existed; converting inside one file was how the
// migration avoided touching all of them. That is a MIGRATION artefact, not a design.
// Reproducing it in a fresh game buys a second shape to keep in sync, two more places
// for a field to go missing, and a whole class of round-trip bug — for nothing.
//
// If you find yourself wanting one, what you actually want is a VIEW: build the shape
// a screen or a report needs at read time (see `buildSeatView` and `toHistoryRows`),
// and keep the stored shape the engine's.
//
// ── THE FIRESTORE TRAP THIS FILE EXISTS TO ABSORB ────────────────────────────
// `GameState` keys several maps by SEAT, which is a number. Firestore has no numeric
// map keys — it stores `{0: …}` and returns `{"0": …}`. TypeScript will not notice
// (`Record<number, T>` and `Record<string, T>` index the same way at run time), so the
// failure is not a type error: it is `roleBySeat[0]` returning undefined after a
// round-trip, and a seat silently having no role. `reviveState` fixes it in one place,
// on every read, forever. Do not scatter `Number(seat)` casts through the callables.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  openGame,
  submit as engineSubmit,
  expireStage as engineExpire,
  buildSeatView as engineSeatView,
  requiredSeats as engineRequiredSeats,
  pendingSeats as enginePendingSeats,
  assertValidStageGameSpec,
  type GameState, type Seat,
} from '@mygames/stage-engine'
import { DEFAULT_ROUND_SETTINGS, type RoundSettings } from './settings'
import { makeRng } from './decide'
import type { DrawnState } from './resolver'
import {
  makeGameSpec, seatOfRole,
  FIELD_STATE, STAGE_ORDER, STAGE_SIGNAL, STAGE_RESPOND, GAME_ROLES,
  type SeatAction, type RoundResult, type GameRole, type SeatView,
  type StoredRoundRecord, type StageId, type EngineRecord,
} from './spec'

export type RoundState = GameState<SeatAction, RoundResult>

// ── spec reconstruction ────────────────────────────────────────────────────────

/**
 * The spec is rebuilt per call rather than cached. It is pure and cheap, and a cached
 * spec is a settings change that does not take effect until the next cold start —
 * which is the kind of bug that only reproduces in production.
 */
export function specFor(state: RoundState, settings: RoundSettings = DEFAULT_ROUND_SETTINGS) {
  const horizon = state.horizonBySeat[state.seats[0]]
  return makeGameSpec({ settings, numRounds: horizon ?? 1 })
}

// ── persistence ────────────────────────────────────────────────────────────────

/** Everything the engine holds is already JSON. Stored verbatim. */
export function toStored(state: RoundState): Record<string, unknown> {
  return state as unknown as Record<string, unknown>
}

const numericKeys = <T>(m: unknown): Record<number, T> => {
  const out: Record<number, T> = {}
  for (const [k, v] of Object.entries((m ?? {}) as Record<string, T>)) out[Number(k)] = v
  return out
}

/**
 * Read a stored document back into engine state, restoring numeric map keys.
 *
 * Throws by name on a document that is not round state at all, rather than returning
 * a half-built object that fails three calls later with a null dereference.
 */
export function reviveState(doc: unknown): RoundState {
  const d = doc as Record<string, unknown> | null | undefined
  if (!d || !Array.isArray(d['seats']) || typeof d['round'] !== 'number') {
    throw new Error('[template-stage] not a round-state document (missing seats/round).')
  }
  const s = d as unknown as RoundState
  const submissions: Record<string, Record<Seat, SeatAction>> = {}
  for (const [stageId, bySeat] of Object.entries(s.submissions ?? {})) {
    submissions[stageId] = numericKeys<SeatAction>(bySeat)
  }
  const history = (s.history ?? []).map((h) => {
    const subs: Record<string, Record<Seat, SeatAction>> = {}
    for (const [stageId, bySeat] of Object.entries(h.submissions ?? {})) {
      subs[stageId] = numericKeys<SeatAction>(bySeat)
    }
    return { ...h, submissions: subs }
  })
  return {
    ...s,
    seats: s.seats.map(Number),
    roleBySeat: numericKeys<string>(s.roleBySeat),
    horizonBySeat: numericKeys<number | null>(s.horizonBySeat),
    submissions,
    defaultedThisRound: (s.defaultedThisRound ?? []).map(Number),
    timeouts: (s.timeouts ?? []).map((t) => ({ ...t, seat: Number(t.seat) })),
    history,
  }
}

// ── opening a game ─────────────────────────────────────────────────────────────

/**
 * LATE ROLE ASSIGNMENT — a seeded Fisher–Yates over the seats.
 *
 * Roles are assigned here, immediately before round 1, and not by the matcher. That is
 * what lets the knowledge check use the late-assignment gate ("It can be either — you
 * will find out when the game starts"), and what keeps seat move and bot fill cheap:
 * a group is N interchangeable seats until the moment it starts.
 *
 * Seeded, so the same group always gets the same roles on a replay.
 */
export function assignRoles(seats: number[], seed: number): Record<Seat, GameRole> {
  if (seats.length !== GAME_ROLES.length) {
    throw new Error(`[template-stage] a group is exactly ${GAME_ROLES.length} seats (got ${seats.length}).`)
  }
  const rng = makeRng(seed | 0)
  const shuffled = [...seats]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const out: Record<Seat, GameRole> = {}
  shuffled.forEach((seat, i) => { out[seat] = GAME_ROLES[i] })
  return out
}

export function openRoundState(
  seats: number[], seed: number, numRounds: number,
  settings: RoundSettings = DEFAULT_ROUND_SETTINGS,
): RoundState {
  const spec = makeGameSpec({ settings, numRounds })
  // Validate ONCE, at the only moment a spec error is cheap to diagnose. After this
  // the spec is rebuilt from the same inputs on every call, so it cannot go bad later.
  assertValidStageGameSpec(spec)
  return openGame(spec, { seats, roleBySeat: assignRoles(seats, seed), seed })
}

// ── seat helpers ───────────────────────────────────────────────────────────────

export function roleOfSeat(state: RoundState, seat: number): GameRole | null {
  const r = state.roleBySeat[seat]
  return (GAME_ROLES as string[]).includes(r) ? (r as GameRole) : null
}

export function requiredSeats(state: RoundState, settings?: RoundSettings): number[] {
  return engineRequiredSeats(specFor(state, settings), state)
}

export function pendingSeats(state: RoundState, settings?: RoundSettings): number[] {
  return enginePendingSeats(specFor(state, settings), state)
}

export const stageIdOf = (state: RoundState): StageId | null =>
  state.status === 'finished' ? null : (STAGE_ORDER[state.stageIndex] ?? null)

// ── actions ────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  ok: boolean
  reason?: string
  stageClosed: boolean
  roundResolved: boolean
  finished: boolean
  state: RoundState
}

/**
 * Apply ONE seat's action.
 *
 * ⚠ LEGALITY COMES FROM THE ENGINE'S INJECTED `validate` HOOK, NEVER FROM A SECOND
 * COPY IN THE CALLABLE. A callable that re-checks bounds "to give a friendlier error"
 * is two rule sets that drift, and the one the student is actually judged by is the
 * one they cannot see. Call this, and surface `reason` verbatim.
 */
export function applyAction(
  state: RoundState, seat: number, action: SeatAction, settings?: RoundSettings,
): ApplyResult {
  const r = engineSubmit(specFor(state, settings), state, seat, action)
  return {
    ok: r.ok, reason: r.reason,
    stageClosed: r.stageClosed, roundResolved: r.roundResolved, finished: r.finished,
    state: r.state,
  }
}

/** The CLOCK path. A no-op once the game is finished, so a late tick is harmless. */
export function expireStage(state: RoundState, settings?: RoundSettings): ApplyResult {
  if (state.status !== 'in_progress') {
    return { ok: true, stageClosed: false, roundResolved: false, finished: true, state }
  }
  const r = engineExpire(specFor(state, settings), state)
  return {
    ok: true,
    stageClosed: r.stageClosed, roundResolved: r.roundResolved, finished: r.finished,
    state: r.state,
  }
}

// ── views ──────────────────────────────────────────────────────────────────────

/** Completed rounds, in the flat shape the history table and the reports read. */
export function toHistoryRows(state: RoundState): StoredRoundRecord[] {
  const alphaSeat = seatOfRole(state.roleBySeat, 'alpha')
  const betaSeat = seatOfRole(state.roleBySeat, 'beta')
  return (state.history as EngineRecord[]).map((h) => {
    const d = new Set(h.defaulted)
    return {
      round: h.round,
      alphaSeat, betaSeat,
      signal: h.result.signal,
      quantity: h.result.quantity,
      state: h.result.state,
      sold: h.result.sold,
      profits: h.result.profits,
      defaulted: { alpha: d.has(alphaSeat), beta: d.has(betaSeat) },
    }
  })
}

/**
 * What ONE seat may see. The single source of truth for the student payload — the
 * callable returns this and nothing else, so there is one place to audit for leaks.
 *
 * ⚠ `state` is set ONLY when the engine's reveal rule allows it. Absence, not
 * emptiness: `out.state = undefined` would put the key on the wire and defeat the
 * whole mechanism, so the assignment is guarded by a presence test.
 */
export function buildSeatView(state: RoundState, seat: number, settings?: RoundSettings): SeatView {
  const role = roleOfSeat(state, seat)
  if (role === null) throw new Error('[template-stage] buildSeatView: seat is not in this group.')

  const spec = specFor(state, settings)
  const view = engineSeatView(spec, state, seat)
  const stage = stageIdOf(state)

  // The signal becomes visible when a stage that OBSERVES it is open — which is the
  // engine's answer, not ours. Before that the key is not in `observed` at all, so a
  // seat cannot read it early even by asking.
  const signalSub = (view.observed[STAGE_SIGNAL] ?? {})[seatOfRole(state.roleBySeat, 'alpha')]

  const out: SeatView = {
    seat,
    role,
    status: state.status,
    round: state.round,
    numRounds: view.roundCount,
    stage,
    owes: view.owes ? stage : null,
    currentSignal: signalSub?.kind === 'signal' ? signalSub.signal : null,
    history: toHistoryRows(state),
    pendingCount: enginePendingSeats(spec, state).length,
  }
  if (FIELD_STATE in view.fields) out.state = view.fields[FIELD_STATE] as DrawnState
  return out
}

export { STAGE_SIGNAL, STAGE_RESPOND, FIELD_STATE }
