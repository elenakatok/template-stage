import { useCallback, useEffect, useState } from 'react'
import { colors, typography, spacing } from '@mygames/game-ui'
import {
  getOnlineGroups, groupParticipantsOnline, moveSeat, fillRemainderWithBots,
  topUpGroupWithBots,
  type OnlineGroup, type OnlineOccupant,
} from '../api'

// ═══════════════════════════════════════════════════════════════════════════════
// THE ONLINE INSTRUCTOR CONTROL — the buttons an online session is actually run from.
//
// ⚠ THIS EXISTED ONLY AS API WRAPPERS UNTIL NOW. `groupParticipantsOnline`,
// `getOnlineGroups`, `moveSeat` and `topUpGroupWithBots` were all exported by the
// frontend and CALLED BY NOTHING — while the control strip told the instructor, in
// online mode, to "Press “Group participants” to form groups." There was no such button.
// An online class could not be run at all.
//
// It stayed invisible because the e2e drives those callables DIRECTLY. A harness that
// calls the function under the button passes while the button is dead — the same shape
// that hid triggerMatching never being exported, and the reason the browser gate exists.
//
// ── WHY THIS IS NOT CRISIS'S PORTAL ─────────────────────────────────────────
// Crisis hides the shared "Match Now" and portals its control into the toolbar slot,
// with a MutationObserver and button-text matching, to avoid editing game-ui. Infoshare
// does not need that: its GameControlStrip is already rendered in the dashboard's
// `underHeadline` slot — directly BELOW THE PAGE HEADLINE and ABOVE the roster table —
// which is exactly where this panel belongs. Same shape, none of the DOM archaeology.
//
// ⚠ Two seats, not three. Everything below is sized from GROUP_SIZE; nothing assumes
// crisis's group of three.
// ═══════════════════════════════════════════════════════════════════════════════

const GROUP_SIZE = 2

/** The label the control strip promises. Change both or neither — see the strip. */
export const GROUP_BUTTON_LABEL = 'Group participants'
const REGROUP_BUTTON_LABEL = 'Re-group participants'

const btn: React.CSSProperties = {
  padding: '0.35rem 0.8rem', fontWeight: 700, borderRadius: 4,
  border: `1px solid ${colors.borderMid}`, cursor: 'pointer',
}

export default function OnlineMatchControl({ onChanged }: { onChanged?: () => void }) {
  const [groups, setGroups] = useState<OnlineGroup[]>([])
  const [pool, setPool] = useState<OnlineOccupant[]>([])
  const [seatCount, setSeatCount] = useState(GROUP_SIZE)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      /*
        ⚠ THE SERVER ALREADY COMPUTES THE NO-GROUP POOL AND THE SEAT COUNT. An earlier
        version derived the pool by subtracting grouped students from the roster — a
        second implementation of something the response already carries in `no_group`,
        which would drift the moment the server's notion of "eligible" changed. It also
        hardcoded a seat count the response supplies.
      */
      const r = await getOnlineGroups()
      setGroups(r.groups ?? [])
      setPool(r.no_group ?? [])
      if (typeof r.seat_count === 'number') setSeatCount(r.seat_count)
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { void refresh() }, 3000)
    return () => clearInterval(t)
  }, [refresh])

  /** Every action goes through here so one failure cannot leave the panel stuck busy. */
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setError(null); setNote(null)
    try {
      const r = await fn() as Record<string, unknown>
      await refresh()
      onChanged?.()
      return r
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`)
      return null
    } finally { setBusy(false) }
  }

  const anyStarted = groups.some((g) => g.started)
  const grouped = groups.reduce((n, g) => n + g.occupants.length, 0)
  const short = groups.filter((g) => g.free_seats > 0)

  return (
    <section data-testid="online-match-control" style={{ marginTop: spacing.gapSm }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.gapSm, flexWrap: 'wrap' }}>
        {/*
          ⚠ PRE-GROUPS THE WHOLE ROSTER, BEFORE ANYONE LOGS IN. That is the online flow:
          the instructor groups everyone in advance, then students arrive into a group
          that already exists. It is not the classroom matcher, which keys on presence.
        */}
        <button
          data-testid="online-group-participants"
          style={{ ...btn, background: anyStarted ? colors.white : '#15803d',
                   color: anyStarted ? colors.textMuted : colors.white,
                   opacity: anyStarted ? 0.6 : 1,
                   cursor: busy || anyStarted ? 'not-allowed' : 'pointer' }}
          disabled={busy || anyStarted}
          onClick={() => act('Grouping', async () => {
            const r = await groupParticipantsOnline()
            setNote(`${r.groups} group(s) formed from ${r.total_humans} student(s)` +
              (r.short_group_size ? ` — one group of ${r.short_group_size}` : ''))
            return r
          })}
        >
          {busy ? 'Working…' : groups.length === 0 ? GROUP_BUTTON_LABEL : REGROUP_BUTTON_LABEL}
        </button>

        {/*
          ⚠ THE ODD SEAT IS THE NORM AT TWO SEATS, NOT AN EXCEPTION. Every odd class
          leaves exactly one student, and without a partner they have no game. This is
          the button that gives them a robot.
        */}
        <button
          data-testid="online-fill-remainder"
          style={{ ...btn, background: colors.white, cursor: busy ? 'not-allowed' : 'pointer' }}
          disabled={busy || anyStarted}
          onClick={() => act('Bot-fill', async () => {
            const r = await fillRemainderWithBots()
            setNote(r.created
              ? `Robot partner added for ${r.humans} leftover student(s)`
              : (r.reason ?? 'Nothing to fill'))
            return r
          })}
        >
          Give the leftover student a robot
        </button>

        {anyStarted && (
          <span data-testid="online-locked-note" style={{ fontSize: typography.sizeXs, color: colors.textMuted }}>
            A group has started — regrouping is locked.
          </span>
        )}
      </div>

      {note && <p data-testid="online-note" style={{ margin: `${spacing.gapSm} 0 0`, fontSize: typography.sizeXs, color: colors.textSecondary }}>{note}</p>}
      {error && <p role="alert" data-testid="online-error" style={{ margin: `${spacing.gapSm} 0 0`, fontSize: typography.sizeXs, color: '#b91c1c' }}>{error}</p>}

      {groups.length > 0 && (
        <div style={{ marginTop: spacing.gapMd, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
          {groups.map((g, i) => (
            <div key={g.group_id} data-testid={`online-group-${g.group_number ?? i + 1}`}
              style={{ display: 'flex', alignItems: 'center', gap: spacing.gapSm, flexWrap: 'wrap',
                       paddingBottom: '0.3rem', borderBottom: `1px solid ${colors.borderFaint}` }}>
              <span style={{ minWidth: 70, fontWeight: 600 }}>Group {g.group_number ?? i + 1}</span>
              <span style={{ fontSize: typography.sizeSm,
                             color: g.free_seats > 0 ? '#b45309' : colors.textSecondary }}>
                {g.occupants.length}/{g.seat_count ?? seatCount} seats
                {g.occupants.some((o) => o.is_bot) &&
                  ` · ${g.occupants.filter((o) => o.is_bot).length} robot`}
                {g.started ? ' · started' : ''}
              </span>
              {/* A SHORT group can be topped up on its own — the remainder button only
                  helps students who are in NO group. Both cases occur in a real class. */}
              {!g.started && g.free_seats > 0 && (
                <button
                  data-testid={`online-topup-${g.group_number ?? i + 1}`}
                  disabled={busy}
                  style={{ fontSize: typography.sizeXs, padding: '0.1rem 0.4rem', cursor: 'pointer' }}
                  onClick={() => act('Top up', async () => {
                    const r = await topUpGroupWithBots(g.group_id)
                    setNote(r.added ? `Added ${r.added} robot seat(s) to Group ${g.group_number ?? i + 1}` : 'Group already full')
                    return r
                  })}
                >Add a robot</button>
              )}
              {g.occupants.map((m) => (
                <span key={m.participant_id} style={{ fontSize: typography.sizeSm, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {m.display_name}{m.is_bot ? ' 🤖' : ''}
                  {/*
                    UNGROUP — the instructor's way of declaring a no-show. It matters for
                    grading, not tidiness: a student left in a group is scored as a
                    participant even if the group never started.
                  */}
                  {!m.is_bot && !g.started && (
                    <button
                      data-testid={`online-ungroup-${m.participant_id}`}
                      title="Remove from the group (declares a no-show)"
                      disabled={busy}
                      style={{ fontSize: typography.sizeXs, padding: '0 0.3rem', cursor: 'pointer' }}
                      onClick={() => act('Ungroup', () => moveSeat(m.participant_id, ''))}
                    >×</button>
                  )}
                </span>
              ))}
            </div>
          ))}
          <p style={{ margin: `${spacing.gapSm} 0 0`, fontSize: typography.sizeXs, color: colors.textSecondary }}>
            {grouped} student(s) grouped
            {short.length > 0 && ` · ${short.length} group(s) still short a seat`}
          </p>
        </div>
      )}

      {/*
        THE NO-GROUP POOL. Ungrouped students are not visible in the group list by
        definition, so without this they vanish from the instructor's view entirely —
        and an invisible ungrouped student is one who silently does not play.
      */}
      {pool.length > 0 && (
        <div data-testid="online-no-group-pool" style={{ marginTop: spacing.gapMd }}>
          <span style={{ fontSize: typography.sizeXs, fontWeight: 700 }}>
            No group — will not play ({pool.length})
          </span>
          <div style={{ display: 'flex', gap: spacing.gapSm, flexWrap: 'wrap', marginTop: 2 }}>
            {pool.map((p) => (
              <span key={p.participant_id} data-testid={`online-pool-${p.participant_id}`}
                style={{ fontSize: typography.sizeSm, color: colors.textSecondary }}>
                {p.display_name}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
