import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { auth, functions } from './firebase'
import Play from './pages/Play'
import InstructorDashboard from './pages/InstructorDashboard'
import Configure from './pages/Configure'
import Reports from './pages/Reports'
import { SettingsPage } from '@mygames/game-ui'

// ⚠ REPLACE_FROM_TEMPLATE throughout this file.
//
// The five routes every game in the fleet has. Keep the paths — the classroom app, the
// launcher and the instructor's bookmarks all assume /dashboard, /configure, /reports
// and /settings, and renaming one breaks a link nothing in this repo can see.

/** SINGLE undifferentiated MATCHING role. Seat roles are assigned late. */
const roleLabels: Record<string, string> = { player: 'Player' }

const infoLinks = [
  { roleKey: 'player', links: [{ key: 'player_sheet_url', label: 'Game instructions' }] },
]

/**
 * Instructor-editable settings.
 *
 * ⚠ EVERY KEY HERE MUST ALSO EXIST IN `configFields` IN functions/src/gameDefinition.ts,
 * and adding one means redeploying BOTH getGameConfig AND updateGameConfig — the
 * recognised-field list is baked into the deployed bundle, and the symptom of
 * forgetting is "No recognised fields to update" on code that is entirely correct.
 *
 * `kind` is limited to 'string' | 'positiveInt' | 'url'. There is NO decimal kind, so
 * probabilities and rates are strings, parsed server-side in round/settings.ts.
 */
const configSections = [
  {
    id: 'rounds',
    title: 'Rounds',
    fields: [
      { key: 'round_seconds', label: 'Seconds per decision (round clock)', kind: 'positiveInt' as const, placeholder: '120' },
      { key: 'num_rounds',    label: 'Number of rounds',                   kind: 'positiveInt' as const, placeholder: '3' },
      { key: 'clock_mode',    label: 'Clock: "on" (classroom) or "off" (online play)', kind: 'string' as const, placeholder: 'on' },
    ],
  },
  {
    id: 'payoffs',
    title: 'Payoffs and draws',
    fields: [
      { key: 'pUp',          label: 'Probability the state is "up" (0–1)', kind: 'string' as const, placeholder: '0.5' },
      { key: 'highCapacity', label: 'Capacity when the state is "up"',     kind: 'positiveInt' as const, placeholder: '3' },
      { key: 'lowCapacity',  label: 'Capacity when the state is "down"',   kind: 'positiveInt' as const, placeholder: '1' },
      { key: 'alphaRate',    label: 'Alpha earns per unit sold',           kind: 'positiveInt' as const, placeholder: '1' },
      { key: 'betaRate',     label: 'Beta earns per unit sold',            kind: 'positiveInt' as const, placeholder: '2' },
      { key: 'unitCost',     label: 'Beta pays per unit committed',        kind: 'positiveInt' as const, placeholder: '1' },
    ],
  },
  {
    id: 'contact',
    title: 'Instructor contact',
    fields: [
      { key: 'instructor_email', label: 'Instructor email (for the "cannot reach my group" flag)', kind: 'string' as const, placeholder: 'you@university.edu' },
    ],
  },
]

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Play />} />
        <Route path="/dashboard" element={<InstructorDashboard />} />
        <Route path="/configure" element={<Configure />} />
        <Route path="/reports"   element={<Reports />} />
        <Route path="/settings"  element={
          <SettingsPage
            title="Settings — Template Stage Game"
            functions={functions}
            auth={auth}
            roleLabels={roleLabels}
            roleInfoLinks={infoLinks}
            configSections={configSections}
          />
        } />
      </Routes>
    </BrowserRouter>
  )
}
