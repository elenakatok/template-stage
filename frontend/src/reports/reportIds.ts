// ═══════════════════════════════════════════════════════════════════════════════
// THE TIER 2 REPORT REGISTRY — one entry per free-text question.
//
// This list is the OTHER half of the spawn gate. `tier2Gate.test.ts` compares it
// against the question bank and fails by name if a free-text question has no report
// here, or if an id here matches no question (a typo, or a report left behind after
// its question was deleted).
//
// ⚠ DO NOT "FIX" A FAILING GATE BY ADDING AN ID HERE WITHOUT A REPORT. The id is a
// claim that the report exists and renders; adding it to silence the test converts a
// red build into a silently missing report, which is exactly the failure the gate was
// written to catch. Render the report in Reports.tsx, then add the id.
// ═══════════════════════════════════════════════════════════════════════════════

export const TIER2_REPORT_IDS: string[] = [
  'prep_expectation',
  'debrief_reflection',
]
