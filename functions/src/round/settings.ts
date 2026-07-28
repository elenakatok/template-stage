// ═══════════════════════════════════════════════════════════════════════════════
// ⚠ PLACEHOLDER_GAME round settings.
//
// Every number a payoff, a draw or a legality rule depends on lives HERE, never as a
// literal in spec.ts or resolver.ts. Two reasons, both learned the hard way:
//
//  1. The instructor Settings page edits these at run time (see `configFields` in
//     gameDefinition.ts). A literal buried in a resolver cannot be edited, and the
//     game will be edited — every game in the fleet has been.
//  2. A knowledge-check question whose answer is derived from config can never grade
//     against a stale constant. Hand-entering "0.65" in a KC option and separately in
//     a distribution is how a KC starts grading the wrong answer after a settings
//     change nobody connected to it.
//
// ⚠ Anything added here must ALSO be added to `configFields` in gameDefinition.ts and
// then redeployed on BOTH `getGameConfig` and `updateGameConfig` — the recognised-field
// list is baked into the deployed bundle, and the symptom of forgetting is the
// misleading "No recognised fields to update" on correct code.
// ═══════════════════════════════════════════════════════════════════════════════

export interface RoundSettings {
  /** Capacity when the round's drawn state is 'up'. */
  highCapacity: number
  /** Capacity when the round's drawn state is 'down'. */
  lowCapacity: number
  /** P(state = 'up') each round, drawn independently per group per round. */
  pUp: number
  /** Alpha earns this per unit sold. */
  alphaRate: number
  /** Beta earns this per unit sold… */
  betaRate: number
  /** …and pays this per unit committed, sold or not. */
  unitCost: number
  /** Inclusive legal bounds on Beta's quantity. */
  minQuantity: number
  maxQuantity: number
}

export const DEFAULT_ROUND_SETTINGS: RoundSettings = {
  highCapacity: 3,
  lowCapacity: 1,
  pUp: 0.5,
  alphaRate: 1,
  betaRate: 2,
  unitCost: 1,
  minQuantity: 1,
  maxQuantity: 3,
}

/**
 * Build settings from the instance's stored config, falling back per field.
 *
 * Per-field fallback rather than all-or-nothing: an instance configured before a new
 * setting existed must keep working, and it does so by picking up the new default
 * rather than by refusing to load.
 *
 * ⚠ WHY A STRING IS ACCEPTED WHERE A NUMBER IS EXPECTED.
 * `ConfigFieldDef` in @mygames/game-server offers exactly three kinds — 'string',
 * 'positiveInt' and 'url'. THERE IS NO DECIMAL KIND. (The 'decimal' type that does
 * exist belongs to `OutcomeSchema`, a different thing entirely; do not go looking for
 * it here.) So any setting that is a probability or a rate — `pUp` below, and every
 * distribution a real game will want — must be declared `kind: 'string'` in
 * `configFields` and parsed on the way in.
 *
 * That is a workaround, not a design. It costs the Settings page its numeric
 * validation: an instructor can type "0.65 " or "sixty-five" and the field accepts it,
 * so the parse below must be total — anything unparseable falls back to the default
 * rather than propagating NaN into a payoff.
 */
export function settingsFromConfig(config: Record<string, unknown> | undefined): RoundSettings {
  const num = (key: keyof RoundSettings): number => {
    const v = config?.[key]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number(v.trim())
      if (Number.isFinite(parsed)) return parsed
    }
    return DEFAULT_ROUND_SETTINGS[key]
  }
  return {
    highCapacity: num('highCapacity'),
    lowCapacity: num('lowCapacity'),
    pUp: num('pUp'),
    alphaRate: num('alphaRate'),
    betaRate: num('betaRate'),
    unitCost: num('unitCost'),
    minQuantity: num('minQuantity'),
    maxQuantity: num('maxQuantity'),
  }
}
