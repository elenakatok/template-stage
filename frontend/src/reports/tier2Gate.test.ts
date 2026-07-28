import { describe, it, expect } from 'vitest'
import { assertTier2Coverage, checkTier2Coverage, selectFreeTextQuestions } from '@mygames/game-ui'
import { ALL_QUESTIONS } from '../../../functions/src/kcQuestions'
import { TIER2_REPORT_IDS } from './reportIds'

// ═══════════════════════════════════════════════════════════════════════════════
// THE TIER 2 SPAWN GATE — a red test, not a checklist line.
//
// Reports Contract v2 §5.3: a game does not pass spawn verification until EVERY
// free-text prep/debrief question has its own Tier 2 report.
//
// This has been asked for in every game and missed in most of them, which is why it
// lives here as an executable check rather than as a line in the playbook. It runs
// from the template's first commit, so a spawned game inherits a failing build the
// moment someone adds a question and forgets the report.
//
// ⚠ IT ASSERTS AGAINST THE REAL QUESTION BANK. The import reaches across into
// functions/src/kcQuestions.ts — the module deliberately kept import-free so that both
// layers can read the SAME list. Do not replace it with a copy of the questions: a gate
// that checks a copy passes while the thing students see is broken.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tier 2 coverage gate', () => {
  it('every free-text prep/debrief question has a report', () => {
    expect(() => assertTier2Coverage(ALL_QUESTIONS, TIER2_REPORT_IDS)).not.toThrow()
  })

  it('no report id is orphaned (a typo, or a report outliving its question)', () => {
    expect(checkTier2Coverage(ALL_QUESTIONS, TIER2_REPORT_IDS).orphaned).toEqual([])
  })

  it('knowledge-check questions do NOT generate reports', () => {
    // §5.3: there is no free-text item analysis of the KC. A graded question appearing
    // in this list would mean the category was set wrong somewhere.
    const required = selectFreeTextQuestions(ALL_QUESTIONS).map((q) => q.field)
    const kcFields = ALL_QUESTIONS.filter((q) => q.category === 'knowledge_check').map((q) => q.field)
    for (const f of kcFields) expect(required).not.toContain(f)
  })

  it('free-text questions use format "text", never "open_response"', () => {
    // 'open_response' is accepted by the gate but NOT by the render path: the question
    // displays and then reports nothing. The gate would pass and the report would be
    // empty, so this is asserted separately from coverage.
    for (const q of ALL_QUESTIONS) {
      if (q.category === 'preparation' || q.category === 'debrief') {
        expect(q.format).toBe('text')
      }
    }
  })

  it('the gate would FAIL if a report were removed — the check has teeth', () => {
    // A gate nobody has seen fail is a gate nobody knows works.
    const oneShort = TIER2_REPORT_IDS.slice(1)
    expect(() => assertTier2Coverage(ALL_QUESTIONS, oneShort)).toThrow(/Tier 2 coverage gate FAILED/)
  })
})
