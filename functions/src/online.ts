// ═══════════════════════════════════════════════════════════════════════════════
// ONLINE MODE — wired entirely from the SHARED machinery in @mygames/game-server.
//
// Classroom mode and online mode are the same game with a different matching trigger:
//   classroom  attendance code → matcher → instructor presses Start
//   online     instructor pre-groups the roster → groups start as students arrive
//
// ⚠ THERE IS NO PER-GAME COPY OF ANY OF THIS, AND THERE MUST NOT BE. Seat move,
// ungroup, the No-Group pool, bot fill and swap, the one Start-class button, the
// "I can't reach my group" flag, and the assignment-status report are all shared
// factories. What a game injects is the three things only it can know:
//
//   • what a BOT SEAT's participant document looks like   (`makeBotSeat`)
//   • what STARTING one group means                        (`openGroup`)
//   • what FINISHED means for one group                    (`progressOf`)
//
// The reference stage game grew its own copy of all of this before the shared set
// existed. Do not copy that file into a new game — it is ~640 lines this template
// replaces with ~90, and every fix to it would have to be made twice.
// ═══════════════════════════════════════════════════════════════════════════════

import * as admin from 'firebase-admin'
import {
  makeStageGroupAdapter,
  makeGroupParticipantsOnline,
  makeRecordLogin,
  makeStartAllGroups,
  makeMoveSeat,
  makeTopUpGroupWithBots,
  makeGetOnlineGroups,
  makeFlagGroup,
  makeGetOnlineReport,
  type OnlineContext,
  type OnlineDefinition,
  type GroupProgress,
} from '@mygames/game-server'
import { templateGameDef } from './gameDefinition'
import { openRoundCore, ROUND_COLLECTION } from './templateRound'
import { reviveState } from './round/machine'

const SEAT_COUNT = templateGameDef.composition['player']

const onlineDef: OnlineDefinition = {
  seatCount: SEAT_COUNT,

  /**
   * A bot seat's participant document. `is_bot: true` is what keeps the seat out of
   * the gradebook, out of the roster report and out of every z-score pool — the skip
   * lives in scoreAndRecord.ts and reads exactly this flag.
   */
  makeBotSeat: ({ gameInstanceId, groupId, index }) => {
    const participantId = `bot_${groupId}_${index}`
    return {
      participantId,
      doc: {
        participant_id: participantId,
        game_instance_id: gameInstanceId,
        display_name: `Robot ${index}`,
        role: 'player',
        is_bot: true,
        status: 'active',
      },
    }
  },

  flagMailSubject: 'I cannot reach my group',
}

const ctx: OnlineContext = {
  def: templateGameDef,
  online: onlineDef,
  adapter: makeStageGroupAdapter(),
}

/** Which groups are already running — a round-state document exists for them. */
async function runningGroupIds(iid: string): Promise<Set<string>> {
  const snap = await admin.firestore()
    .collection('game_instances').doc(iid).collection(ROUND_COLLECTION).get()
  return new Set(snap.docs.map((d) => d.id))
}

/**
 * Per-group progress for the assignment-status report.
 *
 * ⚠ A group with NO round document is deliberately ABSENT from this map, not present
 * with zeroes — the shared report distinguishes "never started" from "started and made
 * no progress", and they mean different things to an instructor chasing students.
 */
async function progressOf(iid: string): Promise<Map<string, GroupProgress>> {
  const snap = await admin.firestore()
    .collection('game_instances').doc(iid).collection(ROUND_COLLECTION).get()
  const out = new Map<string, GroupProgress>()
  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>
    const state = reviveState(data['state'])
    const pidBySeat = (data['pid_by_seat'] ?? {}) as Record<string, string>

    // Absences are per PARTICIPANT, not per seat — the report names students, and a
    // seat number means nothing to an instructor chasing one.
    const absencesByParticipant: Record<string, number> = {}
    for (const t of state.timeouts) {
      const pid = pidBySeat[String(t.seat)]
      if (pid) absencesByParticipant[pid] = (absencesByParticipant[pid] ?? 0) + 1
    }

    out.set(doc.id, {
      category: state.status === 'finished' ? 'finished' : 'in_progress',
      // Rounds COMPLETED, not the round in play: a group on round 3 of 3 has finished
      // two. Reporting the in-play round overstates progress by one for every group.
      rounds: state.history.length,
      absencesByParticipant,
    })
  }
  return out
}

export const groupParticipantsOnline = makeGroupParticipantsOnline(ctx, { assignRole: 'player' })
export const recordLogin             = makeRecordLogin(ctx)
export const getOnlineGroups         = makeGetOnlineGroups(ctx)
export const moveSeat                = makeMoveSeat(ctx)
export const topUpGroupWithBots      = makeTopUpGroupWithBots(ctx)
export const flagGroup               = makeFlagGroup(ctx)

/**
 * The ONE "Start class" control, shared. Idempotent and re-pressable: a later press
 * starts the groups that became ready in the meantime (the latecomer case) and leaves
 * running groups untouched.
 */
export const startAllGroups = makeStartAllGroups(ctx, {
  openGroup: async (iid, groupId) => {
    await openRoundCore(iid, groupId, { nowMs: Date.now(), idempotent: true })
  },
  runningGroupIds,
})

export const getOnlineReport = makeGetOnlineReport(ctx, {
  progressOf,
  absenceLabel: 'Missed decisions',
})
