// ═══════════════════════════════════════════════════════════════════════════════
// THE QUESTION BANK — knowledge check, prep, and debrief. REPLACE_FROM_TEMPLATE.
//
// ⚠ THIS MODULE IMPORTS NOTHING, AND THAT IS DELIBERATE.
//
// Two layers must read this list, and they cannot share a dependency:
//   • functions/  builds the GameDefinition from it and serves + grades it.
//   • frontend/   runs the TIER 2 COVERAGE GATE against it (see
//                 frontend/src/reports/tier2Gate.test.ts).
// The frontend has no `@mygames/game-server` and never will (it is server-only), so
// the moment this file imports a type from there the gate test stops compiling — and
// the usual "fix" is a hand-copied mirror of the question list in the frontend, which
// drifts within a week and makes the gate assert against the copy instead of the
// questions students actually see.
//
// So: plain data, structural types, zero imports. `gameDefinition.ts` asserts it
// satisfies `PrepTextQuestion[]`, which is where the real type check happens.
//
// ── THE FOUR TRAPS THIS FILE IS SHAPED TO AVOID ──────────────────────────────
//
// 1. THE MISSING PER-QUESTION GRADER. A knowledge check needs BOTH
//    `submitKnowledgeCheck` (the whole set) AND `submitStaticKnowledgeCheckQuestion`
//    (one question, graded on the spot). Wire only the first and the KC RENDERS
//    PERFECTLY and then throws "not a valid graded KC question" on submit — after the
//    student has answered. Both are wired in index.ts from the first commit.
//
// 2. THE WRONG FREE-TEXT FORMAT. `format: 'text'`. NOT 'open_response' — that value
//    renders fine and then reports NOTHING, because it is not what the render path
//    expects. A free-text question that produces no report is the exact failure the
//    Tier 2 gate exists to prevent, so getting it wrong here defeats the gate too.
//
// 3. GRADING BY LETTER. `correct_value` names an option's `value`, never 'B' and
//    never a position. Options are SHUFFLED per student, so a position-keyed answer
//    key grades a different question for every student. For the same reason no
//    explanation may say "option B" or "the second choice".
//
// 4. A KC QUESTION MISTAKEN FOR A TIER 2 REPORT. `category: 'knowledge_check'` is
//    excluded from Tier 2 by design — there is no free-text item analysis. Only
//    'preparation' and 'debrief' questions generate reports.
// ═══════════════════════════════════════════════════════════════════════════════

/** Structural mirror of game-server's `PrepTextQuestion`. Kept import-free on purpose. */
export interface Question {
  field: string
  type: 'text' | 'number' | 'mc' | 'likert'
  system: boolean
  prompt: string
  placeholder: string
  order: number
  hidden: boolean
  deletable: boolean
  options?: { value: string; label: string }[]
  category: 'knowledge_check' | 'preparation' | 'debrief'
  format: 'multiple_choice' | 'number' | 'text' | 'likert'
  grading?: 'static' | 'assigned_role'
  correct_value?: string
  role_target: string
  explanation?: string
}

/**
 * Graded multiple-choice helper.
 *
 * Every graded question is built through this rather than hand-written inline: the
 * per-game defaults document has to stay small, and a helper is the only thing that
 * keeps twelve questions from becoming twelve slightly different literals.
 */
const gq = (
  field: string, order: number, correct_value: string,
  prompt: string, options: { value: string; label: string }[], explanation: string,
): Question => ({
  field, type: 'mc', system: false, category: 'knowledge_check', format: 'multiple_choice',
  grading: 'static', correct_value, role_target: 'all', prompt,
  placeholder: '', order, hidden: false, deletable: false, options, explanation,
})

/** Free-text helper. `format: 'text'` — see trap 2 above. */
const freeText = (
  field: string, order: number, category: 'preparation' | 'debrief',
  prompt: string, placeholder = '',
): Question => ({
  field, type: 'text', system: false, category, format: 'text',
  role_target: 'all', prompt, placeholder, order,
  hidden: false, deletable: false,
})

// ── the gate ───────────────────────────────────────────────────────────────────

/**
 * THE LATE-ASSIGNMENT GATE. Ungraded, and it exists to stop a student answering the
 * knowledge check for a role they do not have.
 *
 * `grading: 'assigned_role'` marks it correct iff the submitted value equals the
 * participant's role. This game assigns SEAT roles late — a group is N
 * interchangeable seats until play begins — so at knowledge-check time the honest
 * answer is the single MATCHING role key, `player`.
 *
 * ⚠ THE WORDING IS FIXED FOR THIS FAMILY: "It can be either — you will find out when
 * the game starts." A game whose roles are known up front uses the single-option
 * gate instead; do not mix the two. The distractors are honest but are NOT role keys,
 * so a wrong pick bounces back for a retry rather than silently passing.
 */
export const GATE_QUESTION: Question = {
  field: 'kc_gate_role', type: 'mc', system: true,
  category: 'knowledge_check', format: 'multiple_choice',
  grading: 'assigned_role', role_target: 'all',
  prompt: 'What is your role in this game?',
  placeholder: '', order: 0, hidden: false, deletable: false,
  options: [
    { value: 'alpha_only', label: 'Alpha' },
    { value: 'beta_only', label: 'Beta' },
    { value: 'player', label: 'It can be either — you will find out when the game starts' },
    { value: 'no_roles', label: 'This game has no roles' },
  ],
  explanation:
    'Roles are assigned right before the first round. Until then you are one of the ' +
    'seats in your group and could end up in either position, so the rules you need ' +
    'to know are the same either way.',
}

// ── graded questions ───────────────────────────────────────────────────────────

/**
 * PLACEHOLDER CONTENT. Replace with the game's real questions.
 *
 * The KC score denominator is COUNTED, not hardcoded: the shared grader counts
 * `grading: 'static'` questions at run time. Adding or removing one below changes the
 * denominator automatically, and no "/8" anywhere needs updating. Do not reintroduce
 * a literal denominator — every game that had one eventually shipped a wrong score.
 */
export const GRADED_QUESTIONS: Question[] = [
  gq('kc_signal_is_free', 1, 'no_requirement',
    'Alpha sees the true state of the round before sending a signal. Must Alpha\'s signal match it?',
    [
      { value: 'must_match', label: 'Yes — the signal is checked against the true state and rejected if it differs' },
      { value: 'no_requirement', label: 'No — Alpha may send either signal, whatever the true state is' },
      { value: 'only_first_round', label: 'Only in the first round; after that the signal is free' },
      { value: 'beta_sees_both', label: 'It does not matter, because Beta sees the true state anyway' },
    ],
    'The signal is unconstrained: Alpha may send either value regardless of the truth. ' +
    'Beta sees only the signal at decision time — the true state becomes public once the ' +
    'round is over, which is why a misleading signal is discovered one round later rather ' +
    'than never.'),

  gq('kc_what_beta_sees', 2, 'signal_and_history',
    'At the moment Beta commits a quantity, what can Beta see?',
    [
      { value: 'state_only', label: 'The true state of this round, but not the signal' },
      { value: 'signal_and_history', label: 'Alpha\'s signal for this round, plus the full history of past rounds' },
      { value: 'everything', label: 'Both the signal and the true state of this round' },
      { value: 'nothing', label: 'Nothing at all until after committing' },
    ],
    'Beta decides on the signal and on the record of what happened before. The current ' +
    'round\'s true state is withheld until the round resolves — that withholding is what ' +
    'makes the signal worth anything, and the history is what makes a pattern of ' +
    'misleading signals visible over time.'),
]

// ── free-text questions (Tier 2 reports are derived from these) ────────────────

/**
 * ⚠ EVERY QUESTION IN THIS LIST MUST HAVE A TIER 2 REPORT, and the test suite refuses
 * to pass otherwise. Adding one here without adding its id to `TIER2_REPORT_IDS`
 * (frontend/src/reports/reportIds.ts) fails the gate by name. That is the point: the
 * gate is a red test in this repo, not a line in a checklist somebody skips.
 */
export const FREE_TEXT_QUESTIONS: Question[] = [
  freeText('prep_expectation', 10, 'preparation',
    'Before you start: if you end up as Beta, how much do you expect Alpha\'s signal to be worth to you — and why?',
    'A sentence or two is plenty.'),

  freeText('debrief_reflection', 20, 'debrief',
    'Looking back over the whole game: when did you tell the truth or believe what you were told, and what changed your mind?',
    'Write as much as you like.'),
]

/** Everything, in the order the platform serves it. */
export const ALL_QUESTIONS: Question[] = [
  GATE_QUESTION,
  ...GRADED_QUESTIONS,
  ...FREE_TEXT_QUESTIONS,
]
