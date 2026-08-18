import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches a render error so one broken screen does not blank the board.
 *
 * A white page is the worst possible failure for this product: it looks like
 * "nothing is wrong" rather than "the display stopped". A clinician has no way
 * to tell those apart, so the boundary says plainly that the screen failed and
 * that the data behind it is unaffected.
 *
 * Class component because React has no hook equivalent.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : 'the screen failed to render' }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('screen failed to render', error, info.componentStack)
  }

  render() {
    if (this.state.message === null) return this.props.children
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-10">
        <p className="text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
          This screen failed to render
        </p>
        <p className="mt-2 max-w-[70ch] text-xs leading-relaxed text-ink-700">
          No assessment was lost — the failure is in the display, not the data. Reload to try
          again.
        </p>
        <p className="mt-2 font-mono text-xs text-ink-400">{this.state.message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-[2px] border border-rule-strong bg-surface px-3 py-2 text-2xs text-ink-950 transition-colors hover:border-ink-950"
        >
          Reload
        </button>
      </div>
    )
  }
}
