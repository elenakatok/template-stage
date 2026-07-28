import { httpsCallable } from 'firebase/functions'
import { FirebaseError } from 'firebase/app'
import { functions } from './firebase'
import type { OutcomeSchema } from './gameConfig'

// ── Helper ────────────────────────────────────────────────────────────────────
// Single wrapper: the Firebase SDK auto-attaches the ID token Bearer when
// auth.currentUser exists, and sends nothing when there is no session —
// covering both bootstrap (getInstructorSession, assignRole) and authed calls.

async function callFn<T>(name: string, data: object = {}): Promise<T> {
  const fn = httpsCallable<object, T>(functions, name)
  const result = await fn(data)
  return result.data
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TestArgs   = { _test: { participant_id: string; game_instance_id: string } }
export type TokenArgs  = { token: string }
export type BearerArgs = Record<string, never>   // empty — auth is in Authorization header
export type CallArgs   = TestArgs | TokenArgs | BearerArgs

export type OutcomeFields = Record<string, unknown>

export type AssignRoleResult = {
  ok:               boolean
  role:             string
  customToken:      string
  participant_id:   string
  game_instance_id: string
}

export const CLASSROOM_URL = import.meta.env.DEV
  ? 'http://localhost:5173'
  : 'https://classroom.mygames.live'

// onCall auth errors arrive as FirebaseError with code 'functions/permission-denied'
// or 'functions/unauthenticated' — not HTTP status strings.
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof FirebaseError)) return false
  return (
    err.code === 'functions/permission-denied' ||
    err.code === 'functions/unauthenticated'
  )
}

// ── Student API ─────────────────────────────────────────────────────────────────

/** Bootstrap — no session yet; classroom JWT or _test bypass travels in data. */
export const assignRole = (args: CallArgs) =>
  callFn<AssignRoleResult>('assignRole', args)

export const completePrep = (args: CallArgs = {} as BearerArgs) =>
  callFn<{ ok: boolean }>('completePrep', args)

export const confirmReady = (args: CallArgs) =>
  callFn<{ ok: boolean }>('confirmReady', args)

export const verifyAttendanceCode = (args: CallArgs, code: string) =>
  callFn<{ ok: boolean }>('verifyAttendanceCode', { ...args, code })

// ── Online mode (Slice O1) ──────────────────────────────────────────────────────
// recordLogin: stamps last_login_at server-side AND returns clock_mode so the UI can
// pick online vs classroom routing (config is server-only-readable; the client cannot
// read the setting directly). Called once on session establishment, both modes.
export const recordLogin = (args: CallArgs = {} as BearerArgs) =>
  callFn<{ ok: boolean; clock_mode: string }>('recordLogin', args)

// ── Online mode (Slice O3): "I can't reach my group" flag ─────────────────────────
// Writes a PASSIVE flag on the student's group (idempotent — first flag stands, no dup write),
// and returns the two mailto facts the client cannot compute: the group's stable number and the
// instructor_email config value for To: (null until Elena sets it in Settings). The mailto body
// itself is built client-side from the live member/arrival data the waiting screen already shows.
export const flagGroup = (args: CallArgs = {} as BearerArgs) =>
  callFn<{ ok: boolean; already_flagged: boolean; group_number: number; instructor_email: string | null }>('flagGroup', args)

// ── Student content callables ─────────────────────────────────────────────────
// The shared @mygames/game-ui components (InfoPage/KnowledgeCheck/PrepQuestions, via
// getInfoUrls) usually invoke these directly through httpsCallable; they are exposed +
// typed here so the game's full callable surface is discoverable.

export type InfoPageLink = { key: string; label: string; url: string }
export type GetInfoUrlsResult = {
  ok:         boolean
  roleLabel:  string
  links:      InfoPageLink[]
  publicLink: { label: string; url: string } | null
}

export const getInfoUrls = () =>
  callFn<GetInfoUrlsResult>('getInfoUrls', {})

export const getStudentPrepQuestions = () =>
  callFn<{ ok: boolean; questions: unknown[] }>('getStudentPrepQuestions', {})

export const getDebriefQuestions = () =>
  callFn<{ ok: boolean; questions: unknown[] }>('getDebriefQuestions', {})

export const submitKnowledgeCheck = (data: object = {}) =>
  callFn<{ ok: boolean }>('submitKnowledgeCheck', data)

export const submitStaticKnowledgeCheckQuestion = (data: object = {}) =>
  callFn<{ ok: boolean; correct?: boolean }>('submitStaticKnowledgeCheckQuestion', data)

// ── Round-loop API — ⚠ PLACEHOLDER_GAME shapes ────────────────────────────────
//
// ⚠ THESE TYPES DESCRIBE A PAYLOAD, THEY DO NOT ENFORCE IT. The server decides what a
// seat may see; this file only says what to expect. Widening a type here does not make
// a field arrive, and — more dangerously — it does not make a leak safe.

export type StageId = 'signal' | 'respond'
export type Role = 'alpha' | 'beta'
export type DrawnState = 'up' | 'down'

/** One completed round. Identical for both seats — history has no secrets. */
export type RoundRecord = {
  round: number
  alphaSeat: number
  betaSeat: number
  signal: DrawnState
  quantity: number
  state: DrawnState
  sold: number
  profits: { alpha: number; beta: number }
  defaulted: { alpha: boolean; beta: boolean }
}

/**
 * The per-seat view. This is ALSO the exact object exposed to the page for the robot
 * driver (`window.__gameState`) — one shape, so the bot can never see more than the
 * student whose seat it is playing.
 *
 * ⚠ `state` IS OPTIONAL, AND THAT IS THE WHOLE MECHANISM. When the reveal rule
 * withholds the round's hidden draw, THE KEY IS ABSENT — not null. Test presence
 * (`'state' in view`) or compare strictly; `view.state == null` and `view.state ?? x`
 * both quietly turn "hidden" into a value and are how a reveal bug ships.
 */
export type SeatView = {
  seat: number
  role: Role
  status: 'in_progress' | 'finished'
  round: number
  numRounds: number | null
  stage: StageId | null
  owes: StageId | null
  currentSignal: DrawnState | null
  state?: DrawnState
  history: RoundRecord[]
  pendingCount: number
}

export type RoundViewResult = {
  ok: boolean
  view: SeatView
  clock_enabled: boolean
  /** ms epoch of the current stage deadline; null when the clock is off (online). */
  stage_deadline_ms: number | null
  server_now_ms: number
}

export const getRoundView = (groupId: string) =>
  callFn<RoundViewResult>('getRoundView', { group_id: groupId })

export const submitSignal = (groupId: string, signal: DrawnState) =>
  callFn<{ ok: boolean; reason?: string }>('submitSignal', { group_id: groupId, signal })

export const submitRespond = (groupId: string, quantity: number) =>
  callFn<{ ok: boolean; reason?: string }>('submitRespond', { group_id: groupId, quantity })

export const checkRoundClock = (groupId: string) =>
  callFn<{ ok: boolean; expired?: boolean }>('checkRoundClock', { group_id: groupId })

// ── Instructor round-loop API ─────────────────────────────────────────────────

export type DashboardGroup = {
  group_id: string
  groupNumber: number
  started: boolean
  status?: 'in_progress' | 'finished'
  round?: number
  numRounds?: number | null
  stage?: StageId | null
  pending?: number
  stage_deadline_ms?: number | null
  // ⚠ NO HIDDEN ROUND FIELD HERE. The dashboard is projected in a classroom and
  // students read it; anything withheld from a student must be withheld from it too.
}

export const getGameDashboard = () =>
  callFn<{ ok: boolean; groups: DashboardGroup[] }>('getGameDashboard', {})

/** Launcher action: start the round loop for ONE group. */
export const openRound = (groupId: string) =>
  callFn<{ ok: boolean; round: number; stage: StageId | null; clockEnabled: boolean }>(
    'openRound', { group_id: groupId })

/** The ONE "Start class" control — shared factory, idempotent, re-pressable. */
export const startAllGroups = () =>
  callFn<{ ok: boolean; started: number }>('startAllGroups', {})

// ── Reports — read-only, from the finished state; bots excluded ────────────────

export type StudentRoundRow = RoundRecord & {
  group_id: string
  groupNumber: number
  roleBySeat: Record<number, Role | null>
  pidBySeat: Record<number, string>
}

/** The generic roster + free-text report. Shape mirrors functions/src/getReportData.ts. */
export type ReportRow = {
  participant_id: string
  display_name: string
  group_number: number | null
  group_id: string | null
  role: string
  raw_score: number | null
  knowledge_check_score: number | null
  text_answers: Record<string, string>
}
export type ReportTextQuestion = { field: string; prompt: string; role_target: string }

export const getReportData = () =>
  callFn<{ ok: boolean; rows: ReportRow[]; questions: ReportTextQuestion[] }>('getReportData', {})

export const getRoundReport = () =>
  callFn<{ ok: boolean; rows: StudentRoundRow[] }>('getRoundReport', {})

// ── End-of-assignment operational report (Slice O3) — "who do I email / how do I grade" ──
export type GroupCategory = 'finished' | 'in_progress' | 'never_started'
export type OnlineReportGroup = {
  groupId: string
  groupNumber: number
  category: GroupCategory
  humanCount: number
  botCount: number
  flagged: boolean
  flagStale: boolean
  reporterName: string | null
  rounds: number
}
export type OnlineReportStudent = {
  participantId: string
  name: string
  groupNumber: number | null
  category: GroupCategory | 'no_group'
  arrived: boolean
  lastLoginMs: number | null
  flagged: boolean
  playedWithBots: boolean
  timeouts: number
  rounds: number | null
}
export type OnlineReport = {
  ok: boolean
  clock_mode: string
  counts: { finished: number; inProgress: number; neverStarted: number; flagged: number }
  groups: OnlineReportGroup[]
  students: OnlineReportStudent[]
}
export const getOnlineReport = () => callFn<OnlineReport>('getOnlineReport', {})

// ── Clock-mode control (per-instance setting; instructor sets before starting) ──
export type GameConfig = { ok: boolean; clock_mode?: string; round_seconds?: number; num_rounds?: number }
export const getGameConfig = () => callFn<GameConfig>('getGameConfig', {})
export const setClockMode = (mode: 'on' | 'off') => callFn<GameConfig>('updateGameConfig', { clock_mode: mode })

// ── Instructor API ────────────────────────────────────────────────────────────

export type InstructorSessionArgs =
  | { token: string }
  | { _dev: { game_instance_id: string } }

export type RosterParticipant = {
  participant_id: string
  display_name:   string
  role:           string | null
  role_label:     string | null
  group_id:       string | null
  is_lead:        boolean | null
  attended:       boolean
  finalized:      boolean
}

export type RosterGroup = {
  group_id:             string
  status:               string
  lead_participant_id:  string
  participants_by_role: Record<string, string[]>
  agreement_reached:    boolean | null
  outcome:              Record<string, unknown> | null
}

export type PushSummary = {
  total:     number
  succeeded: number
  failed:    { participant_id: string; reason: string }[]
}

/** Bootstrap — no session yet; JWT travels in data; SDK attaches nothing. */
export const getInstructorSession = (args: InstructorSessionArgs) =>
  callFn<{ ok: boolean; customToken: string }>('getInstructorSession', args)

/** Remaining instructor calls: SDK auto-attaches Firebase Bearer when session exists. */
export const syncRoster = () =>
  callFn<{ ok: boolean; synced: number; skipped: number }>('syncRoster', {})

export const generateAttendanceCode = () =>
  callFn<{ ok: boolean; code: string }>('generateAttendanceCode', {})

export const getRoster = () =>
  callFn<{ ok: boolean; participants: RosterParticipant[]; groups: RosterGroup[] }>('getRoster', {})

// The classroom matcher: human-only groups, then bot-fill of the remainder.
export const triggerMatching = () =>
  callFn<{ ok: boolean; groups: unknown[]; alreadyMatched?: boolean }>('triggerMatching', {})

export const submitInstructorOutcome = (groupId: string, outcome: OutcomeFields | null) =>
  callFn<{ ok: boolean }>('submitInstructorOutcome', { group_id: groupId, outcome })

// ── Online-mode instructor grouping (Slice O1) ──────────────────────────────────
export type OnlineMember = { participant_id: string; display_name: string; email: string | null }
export type OnlineGroup  = { group_id: string; members: OnlineMember[]; size: number; locked: boolean }

/** Pre-form random groups from the roster (online mode; re-runnable until the first lock). */
export const groupParticipantsOnline = () =>
  callFn<{ ok: boolean; groups: number; full_groups: number; short_group_size: number | null; total_humans: number }>(
    'groupParticipantsOnline', {})

/** clock_mode + the online groups (with members) for the grouping panel. */
export const getOnlineGroups = () =>
  callFn<{ ok: boolean; clock_mode: string; groups: OnlineGroup[] }>('getOnlineGroups', {})

/** Move a human into another group (both modes; rejected once a group locks). If the destination is
 *  full but has a bot seat, the move EVICTS one bot (§O2.5B) — evicted_bot names it. */
export const moveSeat = (participantId: string, targetGroupId: string) =>
  callFn<{ ok: boolean; moved: boolean; evicted_bot?: string | null }>('moveSeat', { participant_id: participantId, target_group_id: targetGroupId })

/** Fill a group's empty seats with bot seat-fillers so a short group can play (online). */
export const topUpGroupWithBots = (groupId: string) =>
  callFn<{ ok: boolean; added: number }>('topUpGroupWithBots', { group_id: groupId })

// Type re-export so pages can annotate outcome payloads without a second import.
export type { OutcomeSchema }
