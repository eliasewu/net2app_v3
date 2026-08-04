import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryKey: number;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, retryKey: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error.message, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState((prev) => ({ hasError: false, error: null, retryKey: prev.retryKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 my-4">
          <div className="flex items-start gap-4">
            <div className="p-2 bg-red-100 rounded-lg flex-shrink-0">
              <AlertTriangle size={24} className="text-red-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-red-800">Component Error</h3>
              <p className="text-xs text-red-600 mt-1 font-mono break-all">
                {this.state.error?.message || 'Unknown error'}
              </p>
              <button
                onClick={this.handleRetry}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RefreshCw size={12} />
                Retry
              </button>
            </div>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}
