import { useState } from 'react'
import { InstructorDashboard as SharedDashboard, type DeadlockResolutionProps, type OutcomeFields } from '@mygames/game-ui'
import { auth, functions, rtdb } from '../firebase'
import { submitInstructorOutcome } from '../api'
import GameControlStrip from './GameControlStrip'
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

export default function InstructorDashboard() {
  return (
    <>
      {/*
        ⚠ THE START CONTROL LIVES HERE, NOT IN THE SHARED DASHBOARD.
        The shared dashboard matches groups and then stops — it knows nothing about a
        round loop and cannot, because "starting" differs per family. A stage game MUST
        ship its own start control.

        The template used to ship without one, reasoning that the placeholder game "runs
        on the shared dashboard alone". It does not: the first spawn matched groups and
        dead-ended, students stuck on "This group has not started yet" with no control
        anywhere. `startAllGroups` was exported, deployed and IAM-bound the whole time —
        a callable that exists is not a callable that is REACHABLE.
      */}
      <GameControlStrip />
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
      />
    </>
  )
}
