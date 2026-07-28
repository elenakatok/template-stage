import { HistoryTable as SharedHistoryTable, col, group, sub, num, colors } from '@mygames/game-ui'
import type { RoundRecord, Role } from '../api'

// ═══════════════════════════════════════════════════════════════════════════════
// THE HISTORY TABLE — columns as DATA on the shared widget. ⚠ PLACEHOLDER_GAME columns.
//
// `col` / `group` / `sub` describe the columns; the widget owns the grouped headers,
// the shading, the overflow wrapper and the empty state. Do not hand-write a <table>
// here — three games did, and the third one's horizontal-scroll bug had already been
// fixed twice elsewhere.
//
// ── WHY HISTORY IS IDENTICAL FOR EVERY SEAT ──────────────────────────────────
// The privacy in a stage game is WITHIN a round, not across the game. Once a round
// resolves, the hidden draw becomes public and lands here for everyone — which is
// exactly what makes a misleading signal discoverable one round later, and therefore
// what makes reputation possible. If your game needs a column one role cannot see,
// stop: that is a different design, and it needs the reveal rule, not a filtered
// column list.
//
// ── THE REVEAL CONTRACT (Extraction Spec §3.5.2) ─────────────────────────────
// game-ui takes NO runtime dependency on the stage engine — nine live games resolve
// this package, and giving it an engine dependency changes what all nine install. So
// this widget renders faithfully WHATEVER IT IS HANDED. It cannot protect you.
// The reveal is discharged SERVER-SIDE: `history` arrives from getRoundView, built
// through the engine's `buildSeatView`, so the in-flight round is not in the array at
// all. The harness asserts that on the wire rather than trusting this comment.
// ═══════════════════════════════════════════════════════════════════════════════

const money = (n: number) => num(n)
const arrow = (s: string) => (s === 'up' ? 'Up' : 'Down')

/** The viewer's own block is marked `mine` and lightly shaded. */
function sections(viewerRole?: Role) {
  return [
    col<RoundRecord>('round', 'Round', (h) => h.round, { align: 'left' }),
    group<RoundRecord>('alpha', 'Alpha', [
      sub('signal', 'Signal', (h) => arrow(h.signal)),
      sub('profitA', 'Profit', (h) => money(h.profits.alpha), {
        testId: (h) => `alpha-profit-${h.round}`,
      }),
    ], { mine: viewerRole === 'alpha' }),
    group<RoundRecord>('beta', 'Beta', [
      sub('quantity', 'Quantity', (h) => h.quantity),
      sub('profitB', 'Profit', (h) => money(h.profits.beta), {
        testId: (h) => `beta-profit-${h.round}`,
      }),
    ], { mine: viewerRole === 'beta' }),
    // The truth, revealed. Deliberately the LAST column: a student reads left to right
    // and should meet what was claimed before what was true.
    col<RoundRecord>('state', 'Actual', (h) => arrow(h.state)),
    col<RoundRecord>('sold', 'Sold', (h) => h.sold),
  ]
}

export default function HistoryTable({ history, viewerRole }: { history: RoundRecord[]; viewerRole?: Role }) {
  return (
    <SharedHistoryTable<RoundRecord>
      rows={history}
      sections={sections(viewerRole)}
      testId="game-history"
      rowKey={(h) => h.round}
      rowTestId={(h) => `game-history-row-${h.round}`}
      emptyMessage="No completed rounds yet."
      caption={
        <span style={{ color: colors.textSecondary }}>
          “Actual” is what really happened that round — it becomes visible to both
          players once the round is over.
          {viewerRole ? ' Your block is highlighted.' : ''}
        </span>
      }
    />
  )
}
