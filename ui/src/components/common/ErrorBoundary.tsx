import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('OmniBill Uncaught Render Error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetCache = () => {
    if (confirm('Clear local application cache and reload? Stored offline sales will be reset.')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 select-none font-sans">
          <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="p-2.5 bg-rose-500/10 rounded-xl border border-rose-500/20">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-base font-bold text-white">Application Render Exception</h1>
                <p className="text-xs text-slate-400">OmniBill ERP caught an unexpected runtime fault</p>
              </div>
            </div>

            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 font-mono text-xs text-rose-300 break-words">
              {this.state.error?.message || 'An unknown rendering error occurred.'}
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-2 transition shadow-md shadow-blue-600/20"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold transition"
              >
                Reload Window
              </button>

              <button
                type="button"
                onClick={this.handleResetCache}
                className="py-2 px-3 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-500/30 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition"
                title="Clear local storage cache"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset Cache</span>
              </button>
            </div>

            {/* Collapsible Diagnostic Stack */}
            <div className="border-t border-slate-800/80 pt-3">
              <button
                type="button"
                onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center space-x-1 transition"
              >
                <span>Diagnostic Stack Trace</span>
                {this.state.showDetails ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {this.state.showDetails && (
                <pre className="mt-2 p-3 bg-slate-950 rounded-lg text-[10px] text-slate-400 overflow-x-auto max-h-48 border border-slate-800 font-mono">
                  {this.state.error?.stack}
                  {this.state.errorInfo?.componentStack}
                </pre>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
