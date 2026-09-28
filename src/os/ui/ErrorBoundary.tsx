import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'

interface ErrorBoundaryProps {
  children: ReactNode
  mode?: 'program' | 'taskbar'
  onClose?: () => void
}

interface ErrorBoundaryState {
  error: Error | null
}

export function errorDetails(error: Error) {
  const stackLines = error.stack?.split('\n').slice(1, 6) ?? []
  return [error.message, ...stackLines].join('\n')
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }
  private loggedError: Error | null = null

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (this.loggedError === error) return
    this.loggedError = error
    console.error('r3tardOS component error', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.mode === 'taskbar') {
      return (
        <footer className="taskbar taskbar-error">
          <button className="start-button raised">Start</button>
        </footer>
      )
    }

    return (
      <div className="program-error" role="alert">
        <div className="program-error-box window">
          <header className="titlebar">
            <Icon name="error" size={20} colour="#C52020" />
            <strong>Application Error</strong>
            <span className="titlebar-spacer" />
          </header>
          <div className="program-error-content">
            <div className="message-body">
              <Icon name="error" size={36} colour="#C52020" />
              <div>
                <p>This program has performed an illegal operation and will be shut down.</p>
                <details>
                  <summary>Details »</summary>
                  <pre>{errorDetails(error)}</pre>
                </details>
              </div>
            </div>
            <div className="dialog-actions">
              <Button primary onClick={this.props.onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
