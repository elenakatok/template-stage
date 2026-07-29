import { Component, type ErrorInfo, type ReactNode } from 'react'

// ═══════════════════════════════════════════════════════════════════════════════
// AN ERROR BOUNDARY AROUND ONE PANEL.
//
// ⚠ A CRASHING PANEL MUST NOT BLANK THE PAGE. React unmounts the WHOLE TREE when a
// render throws and nothing catches it, so one bad field reference in one panel took the
// entire instructor dashboard to white — mid-session, with no message. That is what
// `can't access property "length", t.members is undefined` did on production: the
// dashboard did not degrade, it disappeared.
//
// ⚠ AND THE INSTRUCTOR NEEDS SOMETHING TO REPORT. A blank page tells Elena nothing she
// can pass on; the error text and the panel name are the difference between "the
// dashboard broke" and a one-line bug report. So the message is SHOWN, not just logged
// to a console nobody has open during a class.
//
// Neither crisis nor game-ui has one of these — infoshare is the first. If it earns its
// keep here it belongs in game-ui, wrapping every dashboard panel.
// ═══════════════════════════════════════════════════════════════════════════════

type Props = { name: string; children: ReactNode }
type State = { error: Error | null }

export default class PanelBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept for the browser console too — the visible message is deliberately short.
    console.error(`[infoshare] panel "${this.props.name}" crashed`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        data-testid={`panel-error-${this.props.name}`}
        role="alert"
        style={{ margin: '0 0 1rem', padding: '0.6rem 1rem', border: '1px solid #fca5a5',
                 borderRadius: 8, background: '#fef2f2', fontSize: '0.85rem' }}
      >
        <strong>The “{this.props.name}” panel could not be shown.</strong>
        {' '}The rest of this page still works.
        <div style={{ marginTop: '0.3rem', fontFamily: 'monospace', fontSize: '0.75rem', color: '#7f1d1d' }}>
          {this.state.error.message}
        </div>
      </div>
    )
  }
}
