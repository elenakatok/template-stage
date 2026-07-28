import { useState } from 'react'
import { InstructorDashboard as SharedDashboard, type DeadlockResolutionProps, type OutcomeFields } from '@mygames/game-ui'
import { auth, functions, rtdb } from '../firebase'
import { submitInstructorOutcome } from '../api'
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
        ⚠ PLACEHOLDER_GAME. A real game usually portals a live control strip above
        the shared dashboard (group status, the Start-class button, the online grouping
        panel). The template ships without one so the placeholder game runs on the
        shared dashboard alone and there is nothing game-specific to delete first.
      */}
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
