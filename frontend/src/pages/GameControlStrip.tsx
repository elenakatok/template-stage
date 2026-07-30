import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SEATS_PER_GROUP } from '../groupSize'
import { GroupsPanel, colors, typography, spacing, type GroupsPanelRow } from '@mygames/game-ui'
import OnlineMatchControl, { GROUP_BUTTON_LABEL } from './OnlineMatchControl'
import { setClockMode, getOnlineGroups, moveSeat, topUpGroupWithBots, type OnlineGroup, type OnlineOccupant } from '../api'
import PanelBoundary from './PanelBoundary'
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

/** ⚠ PLACEHOLDER_GAME — a spawned game replaces these with its own roles. */
const ROLE_LABEL: Record<string, string> = { alpha: 'Alpha', beta: 'Beta' }

/**
 * Crisis's wording, verbatim in shape: one sentence per group.
 *
 * ⚠ WAITING ON WHOM, NOT HOW MANY. This used to read "waiting on 1 seat", which tells an
 * instructor a group is stuck and nothing about what to do next. Crisis has always named
 * the roles. Falls back to the count only if the server is older than the `waitingOnRoles`
 * field — a deployed frontend can outrun a deployed function by a few minutes.
 */
function statusLine(g: DashboardGroup): string {
  if (!g.started) return 'not started'
  if (g.status === 'finished') return `finished — ${g.numRounds} rounds`
  const roles = g.waitingOnRoles ?? []
  const waiting = roles.length > 0
    ? ` · waiting on ${roles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}`
    : (g.pending ?? 0) > 0 ? ` · waiting on ${g.pending} seat${g.pending === 1 ? '' : 's'}` : ''
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
  const [clockMode, setClockMode_] = useState<string | null>(null)
  const [modeSaving, setModeSaving] = useState(false)
  const [groups, setGroups] = useState<DashboardGroup[]>([])
  const [error, setError] = useState<string | null>(null)
  /**
   * ⚠ HAS THIS PANEL EVER LOADED? "Missing token" is a NORMAL state, not a fault.
   *
   * The panel mounts and polls immediately, before the instructor's Firebase session has
   * been established, so the first call or two throw `invalid-argument: Missing token`.
   * Rendering that verbatim put a RED ERROR on the production dashboard every time Elena
   * opened it, on a page that was working — it then vanished a second later. Same class
   * as the pre-Start "This group has not started yet" alert: a normal state shown as a
   * fault.
   *
   * ⚠ KEYED ON THE CONDITION, NOT THE MESSAGE. Matching the string "Missing token" would
   * break the moment it is reworded, and would also swallow a genuinely broken session
   * that happens to say the same thing. The condition is: we have NEVER successfully
   * loaded, and only briefly. Before the first success, a few failures are the session
   * still coming up; past that, whatever is failing is real and is shown verbatim.
   */
  const [everLoaded, setEverLoaded] = useState(false)
  const failures = useRef(0)
  /*
    ⚠ THE SEAT PICTURE COMES FROM A SECOND CALL, IN BOTH MODES. `getGameDashboard` knows
    the ROUND LOOP (round, stage, who owes) and nothing about seats; `getOnlineGroups`
    knows the SEATS (occupants, bots, the no-group pool) and nothing about the round. One
    row needs both, so the panel merges them by group_id — which is exactly what crisis
    does with a poll plus a Firestore snapshot.

    ⚠ "Online" IS A MISNOMER IN THAT CALLABLE'S NAME. `makeGetOnlineGroups` reads the group
    and participant docs and is mode-agnostic; classroom groups are group docs too. It was
    called only in online mode, which is why the classroom dashboard could never show a
    seat count.
  */
  const [seats, setSeats] = useState<OnlineGroup[]>([])
  const [pool, setPool] = useState<OnlineOccupant[]>([])

  /** Failures tolerated before the first success — about six seconds at POLL_MS. */
  const STARTUP_GRACE = 4

  const refresh = useCallback(async () => {
    try {
      // ⚠ SETTLED, NOT all() — the seat call failing must not blank the round status.
      // The panel degrades to crisis's classroom look (no seat picture) instead of
      // reporting the whole dashboard as broken.
      const [dash, online] = await Promise.allSettled([getGameDashboard(), getOnlineGroups()])
      if (dash.status === 'rejected') throw dash.reason
      setGroups(dash.value.groups ?? [])
      if (online.status === 'fulfilled') {
        setSeats(online.value.groups ?? [])
        setPool(online.value.no_group ?? [])
      }
      setError(null)
      setEverLoaded(true)
      failures.current = 0
    } catch (e) {
      failures.current += 1
      const msg = e instanceof Error ? e.message : String(e)
      // Still starting up: stay quiet. Persistent, or after a good load: it is real.
      if (everLoaded || failures.current > STARTUP_GRACE) setError(msg)
    }
  }, [everLoaded])

  useEffect(() => {
    void (async () => {
      try { setClockMode_((await getGameConfig()).clock_mode ?? 'on') } catch { setClockMode_('on') }
    })()
    void refresh()
    const t = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const online = clockMode === 'off'
  const notStarted = groups.filter((g) => !g.started).length
  const neverStartedStudents = notStarted * SEATS_PER_GROUP

  const anyStarted = groups.some((g) => g.started)

  const seatsById = useMemo(() => new Map(seats.map((s) => [s.group_id, s])), [seats])

  /*
    ⚠ DESTINATIONS INCLUDE FULL-WITH-A-BOT GROUPS — crisis's §O2.5B rule. A group at 2/2
    where one seat is a robot is the BEST destination for a stranded student: the move
    evicts the bot and gives them a human partner. Excluding it (the obvious reading of
    "free seats") leaves a latecomer unplaceable in a class where every group is nominally
    full, which at two seats per group is most of them.
  */
  const destinations = useMemo(
    () => seats
      .filter((s) => !s.started && (s.free_seats > 0 || s.occupants.some((o) => o.is_bot)))
      .map((s) => ({
        id: s.group_id,
        number: s.group_number ?? null,
        replacesBot: s.free_seats === 0,
      })),
    [seats],
  )

  const place = async (participantId: string, dest: string) => {
    setError(null)
    try { await moveSeat(participantId, dest === 'new' ? 'new' : dest); await refresh() }
    catch (e) { setError(`Place: ${e instanceof Error ? e.message : 'failed'}`) }
  }

  const rows: GroupsPanelRow[] = groups.map((g) => {
    const s = seatsById.get(g.group_id)
    const bots = s?.occupants.filter((o) => o.is_bot).length ?? 0
    return {
      key: g.group_id,
      number: g.groupNumber,
      status: statusLine(g),
      live: g.started && g.status !== 'finished',
      filled: s ? s.occupants.length : undefined,
      seatCount: s ? (s.seat_count ?? SEATS_PER_GROUP) : undefined,
      bots,
      // Started == seats locked. There is no separate lock in this game: opening round 1
      // is what freezes membership, so one flag serves both.
      locked: g.started,
      actions: s && !g.started && s.free_seats > 0
        ? <TopUp groupId={g.group_id} seats={s.free_seats} onDone={refresh} onError={setError} />
        : undefined,
    }
  })

  /*
    ── SESSION MODE — THE CONTROL THAT SWITCHES THE WHOLE SESSION ──
    ⚠ THIS IS WHAT WAS MISSING, AND IT IS WHY ONLINE WAS UNREACHABLE. `clock_mode` is
    registered as a config field, but the Settings page does not render it and is not
    supposed to: crisis puts the mode where the instructor makes the decision — at the
    top of the dashboard, above Groups, before anyone has arrived. Infoshare had no such
    control, so an instructor could not put the game into online mode at all, the online
    panel never appeared, and Elena's 9/21 online class had no path to run.

    ⚠ LOCKED ONCE ANY GROUP HAS STARTED. Switching mid-session would change the rules
    under students already playing — the clock either defaults their stage or it does
    not, and a group cannot be half of each.
  */
  const chooseMode = async (m: 'on' | 'off') => {
    if (m === clockMode || modeSaving || anyStarted) return
    setModeSaving(true); setError(null)
    try {
      const c = await setClockMode(m)
      setClockMode_(c.clock_mode === 'off' ? 'off' : 'on')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change mode.') }
    setModeSaving(false)
  }
  const modeBtn = (active: boolean): React.CSSProperties => ({
    padding: '0.4rem 0.9rem', fontWeight: 600, cursor: anyStarted ? 'not-allowed' : 'pointer',
    borderRadius: 4, border: `1px solid ${active ? colors.text : colors.borderLight}`,
    background: active ? colors.text : colors.white,
    color: active ? colors.white : colors.textSecondary,
    opacity: anyStarted && !active ? 0.5 : 1,
  })

  return (
    <>
    <div
      data-testid="session-mode-switch"
      style={{ margin: '0 0 1rem', padding: '0.6rem 1rem', border: `1px solid ${colors.borderMid}`,
               borderRadius: 8, background: colors.surfaceSubtle, fontFamily: typography.fontFamily }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.gapMd, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700 }}>Session mode:</span>
        <div style={{ display: 'flex', gap: spacing.gapSm }}
             title={anyStarted ? 'A group has started — mode is locked for this session.' : ''}>
          <button data-testid="mode-classroom" style={modeBtn(clockMode === 'on')}
            disabled={modeSaving || clockMode === null || anyStarted}
            onClick={() => chooseMode('on')}>Classroom — round clock</button>
          <button data-testid="mode-online" style={modeBtn(clockMode === 'off')}
            disabled={modeSaving || clockMode === null || anyStarted}
            onClick={() => chooseMode('off')}>Online — no clock</button>
        </div>
        {clockMode && (
          <span style={{ fontSize: typography.sizeXs, color: colors.textSecondary }}>
            {clockMode === 'on'
              ? 'Stages time out after the round clock; a timeout plays the default action.'
              : 'No clock — pre-grouped, students self-schedule, stages wait for every seat.'}
          </span>
        )}
        {anyStarted && <span style={{ fontSize: typography.sizeXs, color: colors.textMuted }}>Locked — a group has started.</span>}
      </div>
    </div>

    {/*
      ⚠ THE PANEL'S PROPORTIONS ARE game-ui's, NOT THIS FILE'S. Every padding, gap, font
      size and row rule lives in GroupsPanel, copied from crisis. This file used to declare
      them itself — and they were RIGHT, which is why "restyle this game" was the wrong
      diagnosis: the row was crisis's height while carrying a third of crisis's
      information, and in online mode a SECOND group list rendered underneath it. Density
      is what a row carries times how many rows there are.

      ⚠ NO PER-GROUP START BUTTON, AND DO NOT ADD ONE BACK. It looks like the obvious
      escape hatch for the group that was not ready when the class began — but "Start
      class" already IS that escape hatch. It is re-pressable by design:
      `makeStartAllGroups` skips every group already running and every group still short a
      seat, and opens only the ones that have become ready since. A second control that
      opens ONE group is a second path into the same state with none of those guards.
    */}
    <GroupsPanel
      testId="game-control-strip"
      rows={rows}
      noGroup={pool.map((p) => ({ participantId: p.participant_id, name: p.display_name }))}
      destinations={destinations}
      onPlace={place}
      headerActions={
        <>
          {!online && groups.length > 0 && <StartClass readyCount={notStarted} onDone={refresh} />}
          {online && (
            <span data-testid="online-autostart-note" style={{ fontSize: typography.sizeXs, color: colors.textSecondary }}>
              Online — groups start automatically as their seats arrive.
            </span>
          )}
        </>
      }
      emptyMessage={
        !everLoaded && !error
          ? <span data-testid="control-strip-loading">Connecting…</span>
          /* ⚠ The label is IMPORTED, not retyped — this sentence told instructors to
             press a button that did not exist for the whole of slices 1–3. */
          : online ? `Press “${GROUP_BUTTON_LABEL}” to form groups.`
          : 'Match students into groups to begin.'
      }
      footer={
        <>
          {/*
            ⚠ THE GRADING CONSEQUENCE, SHOWN BEFORE IT IS LOCKED IN. Group membership means
            participation: a student in a group that never started is still scored as a
            participant. That is the instructor's rule — ungrouping is how a no-show is
            declared — but a forgotten ungroup is silent, so it is said here and on finalize.
          */}
          {neverStartedStudents > 0 && groups.length > 0 && (
            <p data-testid="never-started-warning"
              style={{ margin: `${spacing.gapMd} 0 0`, padding: spacing.gapSm, borderRadius: 4, fontSize: typography.sizeSm,
                       background: '#fef3c7', border: '1px solid #f59e0b' }}>
              <strong>{notStarted} group{notStarted === 1 ? '' : 's'} not started</strong> — {neverStartedStudents} student
              {neverStartedStudents === 1 ? '' : 's'}. They will be scored as <strong>participants</strong> unless you
              ungroup them first. Ungrouped students score −2 and are left out of the class average.
            </p>
          )}
          {error && <p role="alert" data-testid="control-error" style={{ color: '#b91c1c', fontSize: typography.sizeXs, margin: `${spacing.gapSm} 0 0` }}>{error}</p>}
        </>
      }
    >
      {/* ⚠ ONLINE HAS NO "Match Now" — it pre-groups the roster instead. These are the
          controls that make an online session runnable at all. The panel now renders the
          group list and the no-group pool, so this is BUTTONS ONLY — it used to repeat
          both, which is where the extra height came from.
          ⚠ BOUNDED. This panel blanked the whole production dashboard once; a panel
          that crashes must degrade to a reportable message, not take the page with it. */}
      {online && (
        <PanelBoundary name="Online grouping">
          <OnlineMatchControl onChanged={refresh} />
        </PanelBoundary>
      )}
    </GroupsPanel>
    </>
  )
}

/**
 * Fill this group's empty seats with robots. crisis's per-group action, at two seats.
 * ⚠ Styling is the panel's — this is a plain button in a slot, deliberately carrying no
 * padding or font size of its own beyond the sizeXs every control on these rows uses.
 */
function TopUp({
  groupId, seats, onDone, onError,
}: { groupId: string; seats: number; onDone: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      data-testid={`strip-fill-${groupId}`}
      disabled={busy}
      style={{ fontSize: typography.sizeXs }}
      onClick={async () => {
        setBusy(true)
        try { await topUpGroupWithBots(groupId); onDone() }
        catch (e) { onError(`Fill: ${e instanceof Error ? e.message : 'failed'}`) }
        setBusy(false)
      }}
    >Fill {seats} seat{seats === 1 ? '' : 's'} with bots</button>
  )
}