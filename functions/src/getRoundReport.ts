import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'
import { extractInstructorGameId } from '@mygames/game-server'
import { templateGameDef } from './gameDefinition'
import { reviveState, toHistoryRows, roleOfSeat } from './round/machine'
import type { StoredRoundRecord, GameRole } from './round/spec'

// ═══════════════════════════════════════════════════════════════════════════════
// THE PER-ROUND REPORT — the data behind Tier 1b and Tier 3. ⚠ PLACEHOLDER_GAME rows.
//
// Tier 1a (the roster) comes from `getReportData`, which is generic and needs nothing
// game-specific. THIS is the part no shared factory can supply: every game's round has
// a different shape, so every game ships its own per-round report reader.
//
// ── ONE RULE, AND IT IS NOT OBVIOUS ──────────────────────────────────────────
// A round resolved by a CLOCK DEFAULT is reported, and is NOT charted.
//
// A default is a record of absence, not a decision. Charting it means the Tier 3
// series describes what the software did when nobody turned up, mixed in with what
// students chose — and because a sensible default is usually the modal choice, it
// biases the series toward whatever the default is rather than adding noise. Worse, it
// is invisible: the line just looks slightly wrong.
//
// So `defaulted` rides every row, the reports show it (Tier 1b, the timeout report),
// and the chart builder drops those rows AND removes them from that round's n=
// denominator. Excluding from the series but not the denominator is the subtle version
// of the same bug.
// ═══════════════════════════════════════════════════════════════════════════════

/** One student's round, flattened for the reports. */
export interface StudentRoundRow extends StoredRoundRecord {
  group_id: string
  groupNumber: number
  /** The seat's role THIS game — assigned late, so it is not on the participant doc. */
  roleBySeat: Record<number, GameRole | null>
  pidBySeat: Record<number, string>
}

const isEmu = () => process.env.FUNCTIONS_EMULATOR === 'true'
const authHeaderOf = (req: CallableRequest): string | undefined =>
  req.rawRequest.headers.authorization as string | undefined

export const getRoundReport = onCall({ cors: templateGameDef.corsOrigins }, async (request) => {
  const data = request.data as Record<string, unknown>
  const iid = await extractInstructorGameId(data, isEmu(), authHeaderOf(request))

  const snap = await admin.firestore()
    .collection('game_instances').doc(iid).collection('template_round').get()

  const rows: StudentRoundRow[] = []
  snap.docs.forEach((doc, i) => {
    const stored = doc.data() as Record<string, unknown>
    const state = reviveState(stored['state'])
    const pidBySeat: Record<number, string> = {}
    for (const [seat, pid] of Object.entries((stored['pid_by_seat'] ?? {}) as Record<string, string>)) {
      pidBySeat[Number(seat)] = pid
    }
    const roleBySeat: Record<number, GameRole | null> = {}
    for (const seat of state.seats) roleBySeat[seat] = roleOfSeat(state, seat)

    for (const h of toHistoryRows(state)) {
      rows.push({ ...h, group_id: doc.id, groupNumber: i + 1, roleBySeat, pidBySeat })
    }
  })

  return { ok: true as const, rows }
})
