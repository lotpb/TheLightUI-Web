import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Optional label shown in the error UI to identify which area crashed. */
  label?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep this as the single console.error — it's a genuine unexpected crash,
    // not routine error handling.
    console.error('[ErrorBoundary]', this.props.label ?? 'App', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-950">
        <div className="w-full max-w-md card p-6 text-center space-y-4">
          <div className="text-4xl">⚠️</div>
          <h1 className="text-lg font-semibold text-gray-100">Something went wrong</h1>
          <p className="text-sm text-gray-400">
            {this.props.label
              ? `The ${this.props.label} section crashed unexpectedly.`
              : 'A part of the app crashed unexpectedly.'}
          </p>
          <details className="text-left">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
              Error details
            </summary>
            <pre className="mt-2 text-xs text-red-400 bg-gray-900 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all">
              {error.message}
            </pre>
          </details>
          <div className="flex gap-3 justify-center pt-2">
            <button onClick={this.reset} className="btn-primary text-sm px-4 py-2">
              Try again
            </button>
            <button
              onClick={() => window.location.assign('/dashboard')}
              className="btn-secondary text-sm px-4 py-2"
            >
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }
}
