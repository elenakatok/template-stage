import { useCallback, useEffect, useState } from 'react'
import { colors, typography, spacing } from '@mygames/game-ui'
import {
  getOnlineGroups, groupParticipantsOnline, fillRemainderWithBots,
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
// ⚠ Two seats, not three — and the seat count is now read from the SERVER's response by
// the Groups panel, not declared here. This file no longer renders anything per-group, so
// it no longer needs to know how big a group is.
// ═══════════════════════════════════════════════════════════════════════════════

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

      {/*
        ── WHAT USED TO BE HERE, AND WHY IT IS GONE ─────────────────────────────
        ⚠ THIS PANEL RENDERED A SECOND GROUP LIST AND A SECOND NO-GROUP POOL, directly
        below the ones in the Groups panel above it. That duplication is what made
        the first spawned game's dashboard taller and sparser than crisis's for less
        information: two
        lists of the same groups, the upper one carrying the round and the lower one
        carrying the seats, and neither carrying both.

        The Groups panel now owns BOTH — it merges this callable's seat picture with the
        round-loop status onto ONE row per group, and renders the no-group pool as crisis
        does: one row of name + "place in…" dropdowns instead of a list of names with
        nowhere to put them. Per-group bot top-up moved there too, onto the row it acts on.

        ⚠ DO NOT RE-ADD A LIST HERE. If something about a group needs showing, it belongs
        on that group's row. This section is the two ROSTER-WIDE buttons that have no row
        to live on, and nothing else.

        The one thing genuinely lost is the per-student × ungroup button. Placing a student
        into a group is now the panel's job; removing them is the shared roster table's
        (Ungroup), which is where every other game does it and which the finalize
        pre-flight already warns about.
      */}
      <p style={{ margin: `${spacing.gapSm} 0 0`, fontSize: typography.sizeXs, color: colors.textSecondary }}>
        {grouped} student(s) grouped
        {short.length > 0 && ` · ${short.length} group(s) still short a seat`}
        {pool.length > 0 && ` · ${pool.length} in no group`}
      </p>
    </section>
  )
}
