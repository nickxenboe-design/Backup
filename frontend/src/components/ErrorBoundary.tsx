import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren<{}>) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log to console or monitoring service
    console.error('Unhandled UI error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow p-6 text-center">
            <h1 className="text-2xl font-bold text-red-700 dark:text-red-300">Something went wrong</h1>
            <p className="mt-2 text-gray-700 dark:text-gray-300">An unexpected error occurred. Please try the following:</p>
            <ul className="mt-3 text-left list-disc list-inside text-sm text-gray-600 dark:text-gray-400">
              <li>Refresh the page</li>
              <li>Start a new search</li>
            </ul>
            <div className="mt-5 flex gap-3 justify-center">
              <button onClick={() => window.location.reload()} className="px-4 py-2 bg-[#652D8E] dark:bg-purple-600 text-white font-bold rounded-lg hover:opacity-90">Reload</button>
              <button onClick={() => window.location.assign('/')} className="px-4 py-2 border-2 border-[#652D8E] text-[#652D8E] dark:text-purple-300 dark:border-purple-300 font-bold rounded-lg hover:bg-[#652D8E]/10">Home</button>
            </div>
            {this.state.error && (
              <details className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                <summary>Technical details</summary>
                <pre className="mt-2 whitespace-pre-wrap">{this.state.error.message}</pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
