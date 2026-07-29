import { useCallback, useEffect, useState } from 'react'
import { SEATS_PER_GROUP } from '../groupSize'
import { colors, typography, spacing } from '@mygames/game-ui'
import { getGameConfig, getGameDashboard, startAllGroups, type DashboardGroup } from '../api'

// ═══════════════════════════════════════════════════════════════════════════════
// THE INSTRUCTOR'S GAME STRIP — "Start class" and live per-group status.
//
// ⚠ DELIBERATELY IDENTICAL TO CRISIS. Same heading, same green Start button, same
// confirm, same result summary, same one-line-per-group status wording. An instructor
// runs several of these games in a term; a control that looks different in each is a
// control they have to re-learn. Where this file differs from crisis it is because the
// feature does not exist here, and each such place says so.
//
// ⚠ THIS COMPONENT EXISTS BECAUSE ITS ABSENCE SHIPPED A DEAD GAME. The shared dashboard
// matches groups and stops — it knows nothing about a round loop. A callable that exists
// and is deployed is not the same as a callable that is REACHABLE.
//
// ── THE TWO MODES ────────────────────────────────────────────────────────────
// CLASSROOM (clock on)  ONE re-pressable "Start class" button. Re-pressable is the point:
//                       a later press starts groups that became ready since.
// ONLINE (clock off)    No button. Groups auto-open as their seats arrive; there is no
//                       instructor watching. A button that must not be pressed is worse
//                       than no button.
// ═══════════════════════════════════════════════════════════════════════════════

const POLL_MS = 4000
/** Seats per group. */

/** Crisis's wording, verbatim in shape: one sentence per group. */
function statusLine(g: DashboardGroup): string {
  if (!g.started) return 'not started'
  if (g.status === 'finished') return `finished — ${g.numRounds} rounds`
  const waiting = (g.pending ?? 0) > 0 ? ` · waiting on ${g.pending} seat${g.pending === 1 ? '' : 's'}` : ''
  return `Round ${g.round} of ${g.numRounds} · ${STAGE_LABEL[g.stage ?? ''] ?? g.stage}${waiting}`
}

const STAGE_LABEL: Record<string, string> = {
  signal: 'Signalling',
  respond: 'Responding',
}

function StartClass({ readyCount, onDone }: { readyCount: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    if (readyCount === 0 || busy) return
    if (!window.confirm(`Start the game for all ${readyCount} ready group${readyCount === 1 ? '' : 's'}?`)) return
    setBusy(true); setErr(null)
    try {
      const r = await startAllGroups()
      setSummary(`${r.started} started`)
      onDone()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not start the class.') }
    setBusy(false)
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: spacing.gapSm }}>
      <button
        data-testid="start-class"
        onClick={go}
        disabled={busy || readyCount === 0}
        title={readyCount === 0 ? 'No full groups are ready to start.' : `Start ${readyCount} ready group${readyCount === 1 ? '' : 's'}.`}
        style={{ padding: '0.35rem 0.8rem', fontWeight: 700, cursor: busy || readyCount === 0 ? 'not-allowed' : 'pointer', borderRadius: 4, border: `1px solid ${colors.borderMid}`, background: readyCount === 0 ? colors.white : '#15803d', color: readyCount === 0 ? colors.textMuted : colors.white, opacity: readyCount === 0 ? 0.6 : 1 }}
      >
        {busy ? 'Starting…' : 'Start class'}
      </button>
      {summary && <span data-testid="start-class-summary" style={{ fontSize: typography.sizeXs, color: colors.textSecondary }}>{summary}</span>}
      {err && <span data-testid="start-class-error" role="alert" style={{ fontSize: typography.sizeXs, color: '#b91c1c' }}>{err}</span>}
    </span>
  )
}

export default function GameControlStrip() {
  const [clockMode, setClockMode] = useState<string | null>(null)
  const [groups, setGroups] = useState<DashboardGroup[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try { setGroups((await getGameDashboard()).groups ?? []); setError(null) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])

  useEffect(() => {
    void (async () => {
      try { setClockMode((await getGameConfig()).clock_mode ?? 'on') } catch { setClockMode('on') }
    })()
    void refresh()
    const t = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const online = clockMode === 'off'
  const notStarted = groups.filter((g) => !g.started).length
  const neverStartedStudents = notStarted * SEATS_PER_GROUP

  return (
    <div data-testid="game-control-strip"
      style={{ margin: '0 0 1.5rem', padding: '0.75rem 1rem', border: `1px solid ${colors.borderMid}`, borderRadius: 8, background: colors.surfaceSubtle, fontFamily: typography.fontFamily }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: spacing.gapMd, marginBottom: spacing.gapSm, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>Groups</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: spacing.gapMd }}>
          {!online && groups.length > 0 && <StartClass readyCount={notStarted} onDone={refresh} />}
          {online && (
            <span data-testid="online-autostart-note" style={{ fontSize: typography.sizeXs, color: colors.textSecondary }}>
              Online — groups start automatically as their seats arrive.
            </span>
          )}
        </div>
      </div>

      {/*
        ⚠ THE GRADING CONSEQUENCE, SHOWN BEFORE IT IS LOCKED IN. Group membership means
        participation: a student in a group that never started is still scored as a
        participant. That is the instructor's rule — ungrouping is how a no-show is
        declared — but a forgotten ungroup is silent, so it is said here and on finalize.
      */}
      {neverStartedStudents > 0 && groups.length > 0 && (
        <p data-testid="never-started-warning"
          style={{ margin: `0 0 ${spacing.gapSm}`, padding: spacing.gapSm, borderRadius: 4, fontSize: typography.sizeSm,
                   background: '#fef3c7', border: '1px solid #f59e0b' }}>
          <strong>{notStarted} group{notStarted === 1 ? '' : 's'} not started</strong> — {neverStartedStudents} student
          {neverStartedStudents === 1 ? '' : 's'}. They will be scored as <strong>participants</strong> unless you
          ungroup them first. Ungrouped students score −2 and are left out of the class average.
        </p>
      )}

      {groups.length === 0 ? (
        <div style={{ fontSize: typography.sizeSm, color: colors.textSecondary }}>
          {online ? 'Press “Group participants” to form groups.' : 'Match students into groups to begin.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.gapSm }}>
          {groups.map((g) => (
            <div key={g.group_id} data-testid={`group-row-${g.groupNumber}`}
              style={{ display: 'flex', alignItems: 'center', gap: spacing.gapMd, paddingBottom: '0.4rem', borderBottom: `1px solid ${colors.borderFaint}`, flexWrap: 'wrap' }}>
              <span style={{ minWidth: 70, fontWeight: 600 }}>Group {g.groupNumber}</span>
              <span style={{ fontSize: typography.sizeSm, color: g.started && g.status !== 'finished' ? colors.successText : colors.textSecondary }}>
                {g.started && g.status !== 'finished' && '● '}{statusLine(g)}
              </span>
              {/*
                ⚠ NO PER-GROUP START BUTTON, AND DO NOT ADD ONE BACK.
                It looks like the obvious escape hatch for the group that was not ready
                when the class began — but "Start class" already IS that escape hatch.
                It is re-pressable by design: `makeStartAllGroups` skips every group that
                is already running (`already_running`) and every group still short a seat
                (`skipped_short`), and opens only the ones that have become ready since.
                Pressing it again after a latecomer arrives starts exactly that group and
                touches nothing else. A second control that opens ONE group is a second
                path into the same state with none of those guards.
              */}
            </div>
          ))}
        </div>
      )}

      {error && <p role="alert" data-testid="control-error" style={{ color: '#b91c1c', fontSize: typography.sizeXs, margin: `${spacing.gapSm} 0 0` }}>{error}</p>}
    </div>
  )
}
