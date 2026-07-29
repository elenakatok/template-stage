import { useState } from 'react'
import { InstructorDashboard as SharedDashboard, type DeadlockResolutionProps, type OutcomeFields } from '@mygames/game-ui'
import { auth, functions, rtdb } from '../firebase'
import { submitInstructorOutcome } from '../api'
import GameControlStrip from './GameControlStrip'
import { getGameDashboard } from '../api'
import { templateRoleConfig } from '../gameConfig'

// ── Role labels from game config (SINGLE matching role — `player`) ─────────────

const roleLabels = Object.fromEntries(
  templateRoleConfig.roles.map(r => [r.key, r.label])
)

// ── Manual outcome control (PLACEHOLDER) ───────────────────────────────────────
//
// Grading is participation-only, so what an instructor types here never affects a
// score — it exists so the shared finalize path can close out a group that got stuck.
// A stage game's real results come from the round loop, not from this form.

function ManualOutcomeControl({ submitting, error, onSubmit }: DeadlockResolutionProps) {
  const [result, setResult] = useState('')
  const [notes,  setNotes]  = useState('')
  const [noDeal, setNoDeal] = useState(false)

  const handleSubmit = () => {
    if (noDeal) { onSubmit({ no_deal: true }); return }
    const n = Number(result)
    if (result === '' || !Number.isFinite(n)) return
    const outcome: OutcomeFields = { placeholder_result: n, notes }
    onSubmit(outcome)
  }

  const inputStyle: React.CSSProperties = {
    fontSize: '0.875rem', padding: '0.3rem 0.5rem', borderRadius: 3, border: '1px solid #ccc',
  }
  const fieldStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {!noDeal && (
        <>
          <div style={fieldStyle}>
            <label style={{ fontSize: '0.875rem', minWidth: '8rem' }}>Placeholder result</label>
            <input type="text" inputMode="decimal" placeholder="e.g. 0" value={result}
              onChange={e => setResult(e.target.value)} style={{ ...inputStyle, width: '9rem' }} disabled={submitting} />
          </div>
          <div style={fieldStyle}>
            <label style={{ fontSize: '0.875rem', minWidth: '8rem' }}>Notes</label>
            <input type="text" placeholder="optional" value={notes}
              onChange={e => setNotes(e.target.value)} style={{ ...inputStyle, width: '14rem' }} disabled={submitting} />
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.25rem' }}>
        <button onClick={handleSubmit} disabled={submitting || (!noDeal && !result)}>
          {submitting ? '…' : noDeal ? 'Confirm No Deal' : 'Lock Result'}
        </button>
        <button onClick={() => setNoDeal(v => !v)} disabled={submitting} style={{ background: 'none', border: '1px solid #ccc' }}>
          {noDeal ? 'Enter result instead' : 'No deal'}
        </button>
      </div>
      {error && <p style={{ color: '#c00', fontSize: '0.8rem', margin: 0 }}>{error}</p>}
    </div>
  )
}

// ── Page component ────────────────────────────────────────────────────────────

/**
 * The finalize pre-flight.
 *
 * ⚠ IT DOES NOT BLOCK. The rule is the instructor's: anyone in a group at finalize
 * participated, and ungrouping is how a no-show is declared. What this prevents is the
 * SILENT version — forgetting to ungroup and discovering it in the gradebook. It reads
 * live state at the moment of the decision rather than trusting whatever the strip last
 * polled, and it fails OPEN: if the count cannot be read, finalize proceeds.
 */
async function confirmFinalize(): Promise<boolean> {
  let inGroups = 0, neverStartedStudents = 0, neverStarted = 0
  try {
    const d = await getGameDashboard()
    const groups = d.groups ?? []
    inGroups = groups.length * 2
    neverStarted = groups.filter((g) => !g.started).length
    neverStartedStudents = neverStarted * 2
  } catch {
    return true
  }
  if (neverStarted === 0) {
    return window.confirm(
      `Finalize and push scores?\n\n${inGroups} students in groups, all of which played.\n\n` +
      'This is irreversible.',
    )
  }
  return window.confirm(
    `Finalize and push scores?\n\n` +
    `${inGroups} students in groups, ${neverStartedStudents} in ${neverStarted} group` +
    `${neverStarted === 1 ? '' : 's'} that never started.\n\n` +
    `Those ${neverStartedStudents} will be scored as PARTICIPANTS. If they did not take ` +
    'part, cancel and ungroup them first — ungrouped students score \u22122 and are left ' +
    'out of the class average.\n\nThis is irreversible. Continue?',
  )
}

export default function InstructorDashboard() {
  return (
    <>
      <SharedDashboard
        title="Instructor Dashboard — Template Stage Game"
        roleLabels={roleLabels}
        DeadlockResolutionControl={ManualOutcomeControl}
        submitInstructorOutcome={async (groupId, outcome) => { await submitInstructorOutcome(groupId, outcome) }}
        functions={functions}
        auth={auth}
        rtdb={rtdb}
        settingsRoute="/settings"
        reportsRoute="/reports"
        scoreAndRecord={{ callableName: 'scoreAndRecord', label: 'Score & Record' }}
        beforeFinalize={confirmFinalize}
        /*
          BELOW the roster, via the shared slot — not portaled above it.
          The roster is the headline an instructor reads first; the game's own controls
          and per-group status belong under it. Games written before `belowRoster`
          existed portal to `main.firstChild` because that was the only anchor a portal
          could reach, which is how "above" became the default by accident.
        */
        belowRoster={<GameControlStrip />}
      />
    </>
  )
}
