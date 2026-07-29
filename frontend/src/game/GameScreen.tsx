import { useCallback, useEffect, useRef, useState } from 'react'
import {
  RoundResultsScreen, colors, typography, layout, spacing,
} from '@mygames/game-ui'
import type { AdvancePolicy } from '@mygames/game-ui'
import {
  getRoundView, submitSignal, submitRespond, checkRoundClock,
  type RoundViewResult, type DrawnState,
} from '../api'
import HistoryTable from './HistoryTable'
import ClockBar from './ClockBar'

// ═══════════════════════════════════════════════════════════════════════════════
// THE STUDENT GAME SCREEN — ⚠ PLACEHOLDER_GAME.
//
// ⚠ THIS COMPONENT DECIDES NOTHING. It polls `getRoundView`, renders what came back,
// and posts intents. It does not compute a payoff to "show the number sooner", does not
// decide whether a stage is over, and does not know the payoff formulas. Every one of
// those, added to a screen, is a rule a student can read in the bundle and a second
// implementation that will disagree with the server on some edge case.
//
// ── WHY POLLING, AND NOT A FIRESTORE LISTENER ────────────────────────────────
// The round-state document is DENIED to clients (see firestore.rules), because it holds
// the fields the reveal rule is hiding. A listener would need read access to the very
// document whose contents must not reach this browser. Polling a callable that applies
// the reveal is the point, not a limitation.
//
// ── THE TWO ADVANCE BRANCHES ─────────────────────────────────────────────────
// Classroom shows the round result on a timer and advances when the timer expires OR
// when every seat clicks Continue, whichever is first — a mandatory click creates one
// stall point per round, which is the exact failure the clock exists to prevent.
// Online has no clock, so it advances on Continue only, with all seats clicking: online
// groups self-schedule, nobody is watching, and auto-advancing past someone who is
// still reading is worse than waiting. Same screen, one branch — `AdvancePolicy`.
// ═══════════════════════════════════════════════════════════════════════════════

const POLL_MS = 1500

export default function GameScreen({
  participantId, gameInstanceId, groupId,
}: { participantId: string; gameInstanceId: string; groupId: string }) {
  const [data, setData] = useState<RoundViewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notStartedYet, setNotStartedYet] = useState(false)
  const [busy, setBusy] = useState(false)
  /** The round whose result screen is showing, or null when playing. */
  const [showingResultFor, setShowingResultFor] = useState<number | null>(null)
  const lastSeenRound = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await getRoundView(groupId)
      setData(r)
      setError(null)
      // A round resolved since the last poll → show its result.
      const completed = r.view.history.length
      if (lastSeenRound.current !== null && completed > lastSeenRound.current) {
        setShowingResultFor(completed)
      }
      lastSeenRound.current = completed
    } catch (e) {
      const code = (e as { code?: string })?.code ?? ''
      setNotStartedYet(code === 'functions/not-found')
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [groupId])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  /**
   * The clock is nudged from the CLIENT but resolved on the SERVER. This call is a
   * prompt, not an authority: it is a no-op before the deadline, and every seat sends
   * it, so a student who closed their laptop cannot freeze the group.
   */
  useEffect(() => {
    if (!data?.clock_enabled) return
    const t = setInterval(() => { void checkRoundClock(groupId).catch(() => {}) }, POLL_MS)
    return () => clearInterval(t)
  }, [data?.clock_enabled, groupId])

  /**
   * THE ROBOT'S READ PATH — exposed on EVERY branch, before any early return.
   *
   * ⚠ It used to be a child component rendered only in the decision branch, which meant
   * `window.__gameState` went stale the moment the round-results screen appeared, and a
   * fully-robot game stalled after round 1. A hook cannot live after a conditional
   * return, so it goes here.
   */
  useEffect(() => {
    if (!data) return
    ;(window as unknown as Record<string, unknown>)['__gameState'] = {
      view: data.view, participantId, gameInstanceId, groupId,
    }
  }, [data, participantId, gameInstanceId, groupId])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      // The server's reason, verbatim. Do not rewrite it here — the message a student
      // reads must be the one the rule actually produced.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  /*
    ⚠ "NOT STARTED YET" IS A NORMAL STATE, NOT AN ERROR.
    A student reaches this screen when they are MATCHED, which is before the instructor
    presses Start — every classroom session has that gap. getRoundView correctly throws
    not-found for a group with no round document, and rendering that as role="alert" made
    the normal wait before every game look like a failure.

    Matched on the CODE, not the message: the sentence is server-authored and will be
    reworded. Anything else still surfaces verbatim — a real failure must never be
    softened into a waiting screen.
  */
  if (error && !data) {
    if (notStartedYet) {
      return (
        <Shell>
          <h1 style={{ marginTop: 0 }}>Waiting to begin</h1>
          <p data-testid="not-started-yet">
            You are in a group. The game will start when your instructor begins the
            session — this screen will move on by itself.
          </p>
        </Shell>
      )
    }
    return <Shell><p role="alert">{error}</p></Shell>
  }
  if (!data) return <Shell><p>Loading…</p></Shell>

  const v = data.view

  // ── the round result screen ──────────────────────────────────────────────────
  if (showingResultFor !== null && v.history.length >= showingResultFor) {
    const row = v.history[showingResultFor - 1]
    const policy: AdvancePolicy = data.clock_enabled
      ? { kind: 'classroom', deadlineMs: data.stage_deadline_ms }
      : { kind: 'online' }
    return (
      <Shell>
        <RoundResultsScreen
          title={`Round ${row.round} result`}
          policy={policy}
          seatsTotal={2}
          seatsContinued={0}
          youContinued={false}
          onContinue={() => setShowingResultFor(null)}
          onAdvance={() => setShowingResultFor(null)}
          history={<HistoryTable history={v.history} viewerRole={v.role} />}
        >
          <p data-testid="result-line">
            Alpha signalled <strong>{row.signal}</strong>; the actual state was{' '}
            <strong>{row.state}</strong>. Beta committed <strong>{row.quantity}</strong> and{' '}
            <strong>{row.sold}</strong> sold.
          </p>
          <p data-testid="result-profits">
            Alpha earned <strong>{row.profits.alpha}</strong>; Beta earned{' '}
            <strong>{row.profits.beta}</strong>.
          </p>
        </RoundResultsScreen>
      </Shell>
    )
  }

  if (v.status === 'finished') {
    return (
      <Shell>
        <h1 style={{ marginTop: 0 }}>Game over</h1>
        <p data-testid="game-over">All rounds are complete. Your instructor will take it from here.</p>
        <HistoryTable history={v.history} viewerRole={v.role} />
      </Shell>
    )
  }

  return (
    <Shell>
      <header style={{ marginBottom: spacing.gapMd }}>
        <h1 style={{ margin: 0 }} data-testid="round-heading">
          Round {v.round}{v.numRounds !== null ? ` of ${v.numRounds}` : ''}
        </h1>
        <p style={{ margin: 0, color: colors.textSecondary }} data-testid="role-line">
          You are <strong>{v.role === 'alpha' ? 'Alpha' : 'Beta'}</strong>.
        </p>
      </header>

      {data.clock_enabled && (
        <ClockBar
          deadlineMs={data.stage_deadline_ms}
          stageKey={`${v.round}:${v.stage ?? ''}`}
          nudge={v.owes !== null}
        />
      )}

      {/*
        ⚠ PRESENCE, NOT NULLISHNESS. `'state' in v` — never `v.state != null` and never
        `v.state ?? 'unknown'`. When the reveal rule withholds the draw the KEY IS
        ABSENT, and a nullish test written the easy way turns "hidden" into a rendered
        value the moment someone changes the server to send null.
      */}
      {'state' in v && (
        <p data-testid="private-state" style={{ padding: spacing.gapSm, background: '#fef3c7', borderRadius: 4 }}>
          Only you can see this: the true state this round is <strong>{v.state}</strong>.
        </p>
      )}

      {v.owes === 'signal' && (
        <Choices
          label="Send your signal to Beta. It does not have to be true."
          testId="signal-choices"
          options={[{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]}
          disabled={busy}
          onPick={(val) => act(() => submitSignal(groupId, val as DrawnState))}
        />
      )}

      {v.owes === 'respond' && (
        <>
          <p data-testid="signal-received">
            Alpha signalled <strong>{v.currentSignal ?? '—'}</strong>.
          </p>
          <Choices
            label="Choose your quantity."
            testId="quantity-choices"
            options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))}
            disabled={busy}
            onPick={(val) => act(() => submitRespond(groupId, Number(val)))}
          />
        </>
      )}

      {v.owes === null && (
        <p data-testid="waiting" style={{ color: colors.textSecondary }}>
          Waiting for the other player… ({v.pendingCount} still to decide)
        </p>
      )}

      {error && <p role="alert" data-testid="action-error" style={{ color: '#b91c1c' }}>{error}</p>}

      <div style={{ marginTop: spacing.gapLg }}>
        <HistoryTable history={v.history} viewerRole={v.role} />
      </div>
    </Shell>
  )
}

/**
 * SEGMENTED BUTTONS, NOT A DROPDOWN OR A NUMBER INPUT.
 *
 * Every option is visible at once, it works on a phone, and it removes an entire
 * validation path — a free number input accepts 7, which then has to be rejected by the
 * server and explained to the student. Do not "improve" this into a text field.
 */
function Choices({
  label, options, onPick, disabled, testId,
}: {
  label: string
  options: { value: string; label: string }[]
  onPick: (value: string) => void
  disabled: boolean
  testId: string
}) {
  return (
    <div data-testid={testId} style={{ margin: `${spacing.gapMd} 0` }}>
      <p style={{ marginBottom: spacing.gapSm }}>{label}</p>
      <div style={{ display: 'flex', gap: spacing.gapSm, flexWrap: 'wrap' }}>
        {options.map((o) => (
          <button
            key={o.value}
            data-testid={`${testId}-${o.value}`}
            disabled={disabled}
            onClick={() => onPick(o.value)}
            style={{ padding: '0.6rem 1.2rem', fontSize: '1rem', cursor: disabled ? 'wait' : 'pointer' }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{
      padding: layout.pagePad, maxWidth: layout.contentWidth,
      margin: '0 auto', fontFamily: typography.fontFamily,
    }}>
      {children}
    </main>
  )
}
