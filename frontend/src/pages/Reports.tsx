import { useEffect, useMemo, useState } from 'react'
import {
  RosterReport, RosterNameCell, StudentDecisionDetail,
  FreeTextReportSet, RoundSeriesChart, buildRoundSeries,
  col, sub, group,
  typography, colors, spacing, layout,
} from '@mygames/game-ui'
import type { RosterReportRow, SortableColumn, FreeTextAnswer, RoundObservation } from '@mygames/game-ui'
import { getReportData, getRoundReport, type StudentRoundRow, type Role, type ReportRow } from '../api'
import { ALL_QUESTIONS } from '../../../functions/src/kcQuestions'

// ═══════════════════════════════════════════════════════════════════════════════
// THE REPORTS PAGE (Reports Contract v2) — REPLACE_FROM_TEMPLATE.
//
//   Tier 1a  ROSTER          one row per student, summary measures.  RosterReport
//   Tier 1b  PER-STUDENT     that student's decisions, round by round.
//   Tier 2   FREE TEXT       one report per free-text question. MANDATORY, gated.
//   Tier 3   SERIES          per-round class charts.
//
// ⚠ TIER 2 IS NOT OPTIONAL WHEN FREE-TEXT QUESTIONS EXIST. `reports/tier2Gate.test.ts`
// fails the build if one is missing. Adding a question means adding its report and its
// id to reports/reportIds.ts, in the same commit.
//
// ── THE ONE RULE THAT IS EASY TO GET WRONG ───────────────────────────────────
// A round resolved by a CLOCK DEFAULT is shown in Tier 1b and EXCLUDED from Tier 3 —
// from the series AND from that round's n= denominator. `buildRoundSeries` defaults to
// excluding them, so the correct behaviour is the one you get by not thinking about it;
// charting them takes an explicit `excludeDefaulted: false`, which is the right way
// round. A default is a record of absence, not a decision, and because a sensible
// default is usually the modal choice it biases a series rather than just adding noise.
// ═══════════════════════════════════════════════════════════════════════════════

interface Row extends RosterReportRow {
  roundsPlayed: number
  totalProfit: number
}

type ColKey = 'name' | 'group' | 'role' | 'rounds' | 'profit'

export default function Reports() {
  const [rows, setRows] = useState<Row[]>([])
  const [roundRows, setRoundRows] = useState<StudentRoundRow[]>([])
  const [answers, setAnswers] = useState<Record<string, FreeTextAnswer[]>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [base, rounds] = await Promise.all([getReportData(), getRoundReport()])
        setRoundRows(rounds.rows)

        // Per-student totals, derived from the round data rather than stored twice.
        const byPid = new Map<string, { rounds: number; profit: number; role: Role | null; groupNumber: number }>()
        for (const r of rounds.rows) {
          for (const seat of [r.alphaSeat, r.betaSeat]) {
            const pid = r.pidBySeat[seat]
            if (!pid || pid.startsWith('bot_')) continue
            const role = r.roleBySeat[seat] ?? null
            const profit = role === 'alpha' ? r.profits.alpha : r.profits.beta
            const cur = byPid.get(pid) ?? { rounds: 0, profit: 0, role, groupNumber: r.groupNumber }
            byPid.set(pid, { rounds: cur.rounds + 1, profit: cur.profit + profit, role, groupNumber: r.groupNumber })
          }
        }

        setRows((base.rows ?? []).map((p: ReportRow): Row => {
          const agg = byPid.get(p.participant_id)
          return {
            participantId: p.participant_id,
            name: p.display_name,
            groupNumber: agg?.groupNumber ?? null,
            role: agg?.role ?? null,
            rawScore: p.raw_score,
            absent: !agg,
            roundsPlayed: agg?.rounds ?? 0,
            totalProfit: agg?.profit ?? 0,
          }
        }))

        // Tier 2 answers, keyed by question field.
        const byQuestion: Record<string, FreeTextAnswer[]> = {}
        for (const q of base.questions ?? []) byQuestion[q.field] = []
        for (const p of base.rows ?? []) {
          for (const q of base.questions ?? []) {
            byQuestion[q.field]?.push({
              participantId: p.participant_id,
              name: p.display_name,
              role: byPid.get(p.participant_id)?.role ?? null,
              answer: p.text_answers?.[q.field] ?? null,
            })
          }
        }
        setAnswers(byQuestion)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [])

  const columns: SortableColumn<Row, ColKey>[] = useMemo(() => [
    { key: 'name', label: 'Student', render: (r) => <RosterNameCell row={r} />, compare: (a, b) => a.name.localeCompare(b.name) },
    { key: 'group', label: 'Group', render: (r) => r.groupNumber ?? '—', compare: (a, b) => (a.groupNumber ?? -1) - (b.groupNumber ?? -1) },
    { key: 'role', label: 'Role', render: (r) => r.role ?? '—', compare: (a, b) => (a.role ?? '').localeCompare(b.role ?? '') },
    { key: 'rounds', label: 'Rounds', render: (r) => r.roundsPlayed, compare: (a, b) => a.roundsPlayed - b.roundsPlayed },
    {
      key: 'profit', label: 'Total profit',
      render: (r) => (r.absent ? '—' : r.totalProfit),
      compare: (a, b) => a.totalProfit - b.totalProfit,
      // A no-show has no profit, and a floor value is not a low value: sorting them to
      // the bottom in BOTH directions keeps "worst performers" honest.
      nullsLast: true,
      isNull: (r) => !!r.absent,
    },
  ], [])

  // ── Tier 3: average quantity by round, defaults excluded (the default) ───────
  const quantitySeries = useMemo(() => {
    const obs: RoundObservation[] = roundRows.map((r) => ({
      round: r.round,
      subject: `${r.group_id}:beta`,
      value: r.quantity,
      defaulted: r.defaulted.beta,
    }))
    return buildRoundSeries(obs)
  }, [roundRows])

  const detailRows = useMemo(
    () => (selected ? roundRows.filter((r) => Object.values(r.pidBySeat).includes(selected)) : []),
    [roundRows, selected],
  )

  if (error) return <main style={{ padding: layout.pagePad }}><p role="alert">{error}</p></main>

  return (
    <main style={{
      padding: layout.pagePad, maxWidth: layout.maxWidth,
      margin: '0 auto', fontFamily: typography.fontFamily,
    }}>
      <h1>Reports</h1>

      <Section title="Tier 1a — roster">
        <RosterReport<Row, ColKey>
          rows={rows}
          columns={columns}
          initialSortKey="group"
          testIds={{
            root: 'roster-root',
            table: 'roster-table',
            row: (r) => `student-row-${r.participantId}`,
          }}
        />
        <p style={{ fontSize: typography.sizeXs, color: colors.textSecondary }}>
          Click a student below to see their round-by-round detail.
        </p>
        <select
          data-testid="student-picker"
          value={selected ?? ''}
          onChange={(e) => setSelected(e.target.value || null)}
        >
          <option value="">— choose a student —</option>
          {rows.map((r) => <option key={r.participantId} value={r.participantId}>{r.name}</option>)}
        </select>
      </Section>

      {selected && (
        <Section title="Tier 1b — one student, round by round">
          <StudentDecisionDetail<StudentRoundRow>
            studentName={rows.find((r) => r.participantId === selected)?.name ?? selected}
            rounds={detailRows}
            // Defaulted rounds ARE shown here. Excluded from the charts, visible here —
            // this is the "somewhere" they must remain visible.
            isDefaulted={(r) => r.defaulted.alpha || r.defaulted.beta}
            sections={[
              col<StudentRoundRow>('round', 'Round', (r) => r.round, { align: 'left' }),
              group<StudentRoundRow>('play', 'This round', [
                sub('signal', 'Signal', (r) => r.signal),
                sub('quantity', 'Quantity', (r) => r.quantity),
                sub('state', 'Actual', (r) => r.state),
              ]),
              col<StudentRoundRow>('sold', 'Sold', (r) => r.sold),
            ]}
          />
        </Section>
      )}

      <Section title="Tier 2 — free-text answers">
        {/*
          The set of reports IS the set of free-text questions — derived, never declared,
          so a new question cannot be silently unreported. The gate test enforces it.
        */}
        <FreeTextReportSet
          questions={ALL_QUESTIONS}
          answersByQuestion={answers}
          roleLabels={{ alpha: 'Alpha', beta: 'Beta' }}
        />
      </Section>

      <Section title="Tier 3 — average quantity by round">
        <RoundSeriesChart
          series={[{ key: 'quantity', label: 'Average quantity', color: '#D38626', points: quantitySeries }]}
          yDomain={[0, 3]}
          formatValue={(v) => v.toFixed(2)}
          ariaLabel="Average committed quantity by round"
          testIdPrefix="tier3-quantity"
          caption="Rounds resolved by a clock default are excluded, from the line and from the n= counts."
        />
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: spacing.gapXl }}>
      <h2 style={{ fontSize: '1.05rem' }}>{title}</h2>
      {children}
    </section>
  )
}
