import { useCallback, useEffect, useState } from 'react'
import { colors, typography, spacing } from '@mygames/game-ui'
import { getGameConfig, getGameDashboard, startAllGroups, openRound, type DashboardGroup } from '../api'

// ═══════════════════════════════════════════════════════════════════════════════
// THE INSTRUCTOR'S GAME CONTROL STRIP — the "Start class" button and live status.
//
// ⚠ THIS COMPONENT EXISTS BECAUSE ITS ABSENCE SHIPPED A DEAD GAME.
//
// The shared InstructorDashboard knows nothing about a round loop. It matches groups and
// then stops — there is no start control in it, and there cannot be, because "starting"
// means something different in every family. A stage game must supply its own.
//
// The template shipped without one, on the reasoning that the placeholder game "runs on
// the shared dashboard alone". It does not: `startAllGroups` was exported, deployed and
// IAM-bound, and nothing on any screen invoked it. Students matched, then sat on "This
// group has not started yet" forever, with no control anywhere for the instructor.
//
// A callable that exists and is deployed is not the same as a callable that is REACHABLE.
//
// ── THE TWO MODES ────────────────────────────────────────────────────────────
// CLASSROOM (clock on)  ONE re-pressable "Start class" button. Re-pressable is the point:
//                       a later press starts the groups that became ready in the
//                       meantime — the latecomer case — and leaves running groups alone.
// ONLINE (clock off)    No button. Groups auto-open as their seats arrive, because there
//                       is no instructor watching an online section. Showing a button
//                       that must not be pressed is worse than showing none.
// ═══════════════════════════════════════════════════════════════════════════════

const POLL_MS = 4000

export default function GameControlStrip() {
  const [clockMode, setClockMode] = useState<string | null>(null)
  const [groups, setGroups] = useState<DashboardGroup[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const d = await getGameDashboard()
      setGroups(d.groups ?? [])
      setError(null)
    } catch (e) {
      // A failure here must not blank the strip — the Start button is the thing that
      // matters, and it stays usable while status is unavailable.
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try { setClockMode((await getGameConfig()).clock_mode ?? 'on') } catch { setClockMode('on') }
    })()
    void refresh()
    const t = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const start = async () => {
    setBusy(true); setMsg(null); setError(null)
    try {
      const r = await startAllGroups()
      setMsg(r.started > 0
        ? `Started ${r.started} group${r.started === 1 ? '' : 's'}.`
        : 'No groups were ready to start — match first, or they are already running.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const startOne = async (groupId: string) => {
    setBusy(true); setError(null)
    try { await openRound(groupId); await refresh() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  const online = clockMode === 'off'
  const notStarted = groups.filter((g) => !g.started).length
  const running = groups.filter((g) => g.started && g.status !== 'finished').length
  const finished = groups.filter((g) => g.status === 'finished').length

  return (
    <section
      data-testid="game-control-strip"
      style={{
        margin: `${spacing.gapMd} 0`, padding: spacing.gapMd,
        border: `1px solid ${colors.border ?? '#d0d7de'}`, borderRadius: 6,
        fontFamily: typography.fontFamily,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.gapMd, flexWrap: 'wrap' }}>
        <strong>The game</strong>

        {online ? (
          <span data-testid="online-autostart-note" style={{ color: colors.textSecondary }}>
            Online section — groups start automatically as their seats arrive. No button to press.
          </span>
        ) : (
          <button
            data-testid="start-class"
            onClick={start}
            disabled={busy}
            style={{ padding: '0.4rem 1rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
          >
            {busy ? 'Starting…' : 'Start class'}
          </button>
        )}

        <span data-testid="group-counts" style={{ color: colors.textSecondary }}>
          {groups.length} group{groups.length === 1 ? '' : 's'} · {notStarted} not started ·{' '}
          {running} running · {finished} finished
        </span>
      </div>

      {msg && <p data-testid="start-result" style={{ margin: `${spacing.gapSm} 0 0` }}>{msg}</p>}
      {error && <p role="alert" data-testid="control-error" style={{ color: '#b91c1c', margin: `${spacing.gapSm} 0 0` }}>{error}</p>}

      {groups.length > 0 && (
        <table data-testid="group-status" style={{ marginTop: spacing.gapSm, borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.textSecondary }}>
              <th style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>Group</th>
              <th style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>Round</th>
              <th style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>Stage</th>
              <th style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>Waiting on</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.group_id} data-testid={`group-row-${g.groupNumber}`}>
                <td style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>{g.groupNumber}</td>
                <td style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>
                  {g.started ? `${g.round} of ${g.numRounds ?? '?'}` : '—'}
                </td>
                <td style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>
                  {g.status === 'finished' ? 'finished' : (g.stage ?? '—')}
                </td>
                <td style={{ padding: '0.2rem 0.75rem 0.2rem 0' }}>
                  {g.started && g.status !== 'finished' ? `${g.pending ?? 0} seat(s)` : '—'}
                </td>
                <td>
                  {/*
                    Per-group start, for the one group that did not come up with the rest.
                    Deliberately NOT the main control — "Start class" is. This is the
                    escape hatch, and it is why `openRound` is exported at all.
                  */}
                  {!g.started && !online && (
                    <button
                      data-testid={`start-group-${g.groupNumber}`}
                      onClick={() => startOne(g.group_id)}
                      disabled={busy}
                      style={{ fontSize: '0.8rem', padding: '0.15rem 0.5rem' }}
                    >
                      Start this group
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
