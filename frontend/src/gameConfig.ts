import type { RoleConfig, OutcomeSchema } from '@mygames/game-engine'

// ═══════════════════════════════════════════════════════════════════════════════
// The frontend's mirror of the MATCHING role config — REPLACE_FROM_TEMPLATE.
//
// ⚠ ONE undifferentiated matching role. The SEAT roles (Alpha / Beta) are assigned
// late, inside the round loop, and never appear here: the shared roster and matching
// UI would otherwise offer to assign them, which is precisely what late assignment
// exists to avoid.
//
// This mirrors functions/src/gameDefinition.ts. It is a mirror because the frontend
// cannot import from functions/ — keep the two in step, and prefer adding anything
// substantial to the QUESTION BANK pattern (functions/src/kcQuestions.ts) instead,
// which is import-free precisely so both layers can read the same file.
// ═══════════════════════════════════════════════════════════════════════════════

export const templateRoleConfig: RoleConfig = {
  roles: [{ key: 'player', label: 'Player', short: 'P' }],
}

/** Placeholder outcome schema — the real results live in the round history. */
export const templateOutcomeSchema: OutcomeSchema = [
  { key: 'placeholder_result', type: 'decimal', min: 0, max: 1_000_000, step: 1 },
  { key: 'notes', type: 'text' },
]

export type { OutcomeSchema }
