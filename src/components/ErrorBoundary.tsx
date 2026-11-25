import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : 'An unexpected error occurred.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0B0F17] p-6 text-slate-200">
          <div className="max-w-md space-y-4 rounded border border-[#1E293B] bg-[#111824] p-6">
            <h1 className="text-lg font-semibold text-slate-50">
              Application Recovery Required
            </h1>
            <p className="text-xs leading-relaxed text-slate-400">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center rounded bg-amber-500 px-4 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              Reload Analyzer
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
