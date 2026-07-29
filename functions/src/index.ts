import { onRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import {
  makeGetInstructorSession,
  makeAssignRole,
  makeCompletePrep,
  makeConfirmReady,
  makeGenerateAttendanceCode,
  makeVerifyAttendanceCode,
  makeGetRoster,
  makeTriggerMatching,
  makeSubmitInstructorOutcome,
  makeFinalizeInstance,
  makePushResultsToClassroom,
  makeGetGameConfig,
  makeUpdateGameConfig,
  makeGetStudentPrepQuestions,
  makeGetDebriefQuestions,
  makeSubmitKnowledgeCheck,
  makeSubmitStaticKnowledgeCheckQuestion,
  makeGetInfoUrls,
} from '@mygames/game-server'
import { templateGameDef } from './gameDefinition'

admin.initializeApp()

// ═══════════════════════════════════════════════════════════════════════════════
// EVERY DEPLOYED FUNCTION, IN ONE PLACE — REPLACE_FROM_TEMPLATE.
//
// ⚠ THIS LIST IS ALSO THE DEPLOY LIST. Deploy BY NAME, never blanket
// `--only functions`: a blanket deploy redeploys everything, mints a Cloud Run
// revision per function, and eventually trips "Quota exceeded for total allowable
// CPU", which blocks every deploy in the project until old revisions are swept.
//
// ⚠ EVERY NEW CALLABLE NEEDS AN IAM `roles/run.invoker` BINDING FOR allUsers, added
// immediately after its first deploy. Gen-2 service names are LOWERCASE — the binding
// for `getRoundView` is on `getroundview`. IAM persists across redeploys, so this is
// once per function, but a missing binding presents as a generic auth failure in the
// browser and costs an hour to find.
// ═══════════════════════════════════════════════════════════════════════════════

// ── session, roster, matching, config ──────────────────────────────────────────
export const getInstructorSession   = makeGetInstructorSession(templateGameDef)
export const assignRole             = makeAssignRole(templateGameDef)
export const completePrep           = makeCompletePrep(templateGameDef)
export const confirmReady           = makeConfirmReady(templateGameDef)
export const generateAttendanceCode = makeGenerateAttendanceCode(templateGameDef)
export const verifyAttendanceCode   = makeVerifyAttendanceCode(templateGameDef)
export const getRoster              = makeGetRoster(templateGameDef)

/**
 * THE CLASSROOM MATCHER — the callable behind the dashboard's "Match Now" button.
 *
 * ⚠ IT IS NOT OPTIONAL, AND ITS ABSENCE IS INVISIBLE UNTIL AN INSTRUCTOR CLICKS.
 * game-ui's shared InstructorDashboard invokes `triggerMatching` BY NAME
 * (InstructorDashboard.tsx). A game that does not export it deploys cleanly, passes every
 * build and every emulator round-loop test, and then fails the very first instructor
 * action in production with a bare "internal" — because the callable SDK gets a 404 that
 * is not a callable envelope and has nothing better to say. There are no server logs to
 * find, because no function ran.
 *
 * That is exactly how it reached production once. Do not remove it, and do not assume a
 * deploy list generated from this file's exports proves completeness — it proves only
 * that the list agrees with itself.
 */
export const triggerMatching        = makeTriggerMatching(templateGameDef)
export const getGameConfig          = makeGetGameConfig(templateGameDef)
export const updateGameConfig       = makeUpdateGameConfig(templateGameDef)
export const getInfoUrls            = makeGetInfoUrls(templateGameDef)

/** A WRAPPER, not the shared factory directly — see ./syncRoster for why. */
export { syncRoster } from './syncRoster'

// ── outcome + finalize + gradebook ─────────────────────────────────────────────
/**
 * ⚠ THE NEGOTIATION-FAMILY CALLABLES ARE DELIBERATELY NOT EXPORTED.
 *
 * `makeStartNegotiation`, `makeSubmitLeadOutcome` and `makeSubmitConfirmation` exist in
 * @mygames/game-server for the NEGOTIATION family — a lead proposes a contract, the
 * others ratify it. A stage game has no lead, no contract and no ratification: its flow
 * is openRound → per-stage submissions → resolve.
 *
 * They were inherited here simply because the shared flow module exports them, and they
 * are NOT inert — all three take STUDENT auth and would succeed against a real group
 * doc, because a stage group is also `status: 'matched'` with a `lead_participant_id`.
 * Deploying them means `roles/run.invoker` for `allUsers` on three outcome-writing
 * endpoints the game never calls, and IAM persists across redeploys.
 *
 * No grade could change — scoring is participation-only and ignores the outcome — but
 * "harmless" is not a reason to publish an endpoint with no caller.
 *
 * `submitInstructorOutcome` IS exported and IS required: the shared InstructorDashboard's
 * deadlock-resolution control calls it, and it is what sets a group to `status:
 * 'completed'` — which `finalizeInstance` guards on.
 *
 * ⚠ If a later slice adopts game-ui's shared `GroupReveal`, that component calls
 * `startNegotiation` directly and this export must come back. This game uses its own
 * local OnlineGroupReveal precisely to avoid that.
 */
export const submitInstructorOutcome = makeSubmitInstructorOutcome(templateGameDef)
export const finalizeInstance        = makeFinalizeInstance(templateGameDef)
export const pushResultsToClassroom  = makePushResultsToClassroom(templateGameDef)
export { scoreAndRecord } from './scoreAndRecord'

// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ THE KNOWLEDGE CHECK NEEDS ALL FOUR OF THESE. WIRE THEM TOGETHER OR NOT AT ALL.
//
//   getStudentPrepQuestions            serves the questions
//   getDebriefQuestions                serves the debrief questions
//   submitKnowledgeCheck               grades and records the whole set
//   submitStaticKnowledgeCheckQuestion grades ONE question, on the spot
//
// The trap, which this platform has hit before: wire the first three and skip the
// fourth, and the knowledge check RENDERS PERFECTLY. Every question appears, options
// shuffle, the student answers — and the per-question submit throws "not a valid
// graded KC question", after they have already done the work. It looks like a content
// bug and it is a missing function.
//
// The same class of failure appears at deploy time: a content change often spans more
// functions than the obvious one, and "renders fine but submit fails" almost always
// means a STALE BUNDLE on the grader or the token function rather than wrong content.
// ═══════════════════════════════════════════════════════════════════════════════
export const getStudentPrepQuestions            = makeGetStudentPrepQuestions(templateGameDef)
export const getDebriefQuestions                = makeGetDebriefQuestions(templateGameDef)
export const submitKnowledgeCheck               = makeSubmitKnowledgeCheck(templateGameDef)
export const submitStaticKnowledgeCheckQuestion = makeSubmitStaticKnowledgeCheckQuestion(templateGameDef)

// ── reports ────────────────────────────────────────────────────────────────────
export { getReportData } from './getReportData'
export { getRoundReport } from './getRoundReport'

// ── the round loop ─────────────────────────────────────────────────────────────
export {
  openRound,
  submitSignal,
  submitRespond,
  checkRoundClock,
  getRoundView,
  getInstructorRoundView,
  getGameDashboard,
} from './templateRound'

/**
 * ── ONLINE MODE, ENTIRELY FROM SHARED FACTORIES ───────────────────────────────
 * Seat move, ungroup, the No-Group pool, bot fill, the flag, the one Start-class
 * button and the assignment-status report. `startAllGroups` lives HERE, not in the
 * round-loop module: it is the same control in both modes, and one control cannot be
 * allowed to become two. See ./online.ts for the three things the game injects.
 */
export {
  groupParticipantsOnline,
  recordLogin,
  getOnlineGroups,
  moveSeat,
  topUpGroupWithBots,
  flagGroup,
  startAllGroups,
  getOnlineReport,
} from './online'

// ── health ─────────────────────────────────────────────────────────────────────

const CORS_ORIGINS = new Set(templateGameDef.corsOrigins)

export const health = onRequest((req, res) => {
  const origin = req.headers.origin ?? ''
  if (CORS_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') { res.status(204).send(''); return }
  res.json({ ok: true, game: templateGameDef.game_id })
})

/**
 * Emulator-only dev seeds. LOCKED — 404 unless FUNCTIONS_EMULATOR==='true', and
 * deliberately given NO run.invoker binding in production. Do not bind them "just to
 * test something quickly": a reachable seed endpoint can fabricate groups in a live
 * class, and nothing in the UI would show that it happened.
 */
export { seedGroupForTest, seedRosterForTest } from './seedFunctions'
