'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🚨 ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({
      error,
      errorInfo
    });

    // Call optional error handler
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
          <div className="bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full">
            <div className="flex items-center mb-4">
              <div className="text-red-400 text-2xl mr-3">⚠️</div>
              <h2 className="text-xl font-semibold text-white">
                Something went wrong
              </h2>
            </div>
            
            <p className="text-gray-300 mb-4">
              The constellation visualization encountered an error. This might be due to:
            </p>
            
            <ul className="text-sm text-gray-400 mb-6 space-y-1">
              <li>• Invalid node data or positions</li>
              <li>• Group selection state corruption</li>
              <li>• Memory issues with large datasets</li>
              <li>• Browser compatibility problems</li>
            </ul>

            <div className="flex space-x-3">
              <button
                onClick={this.handleReset}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md transition-colors"
              >
                Reload Page
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4">
                <summary className="text-sm text-gray-400 cursor-pointer hover:text-gray-300">
                  Show Error Details
                </summary>
                <div className="mt-2 p-3 bg-gray-900 rounded text-xs text-red-300 font-mono overflow-auto max-h-40">
                  <div className="mb-2 font-semibold">Error:</div>
                  <div className="mb-2">{this.state.error.message}</div>
                  <div className="mb-2 font-semibold">Stack:</div>
                  <div className="whitespace-pre-wrap">{this.state.error.stack}</div>
                  {this.state.errorInfo && (
                    <>
                      <div className="mt-2 font-semibold">Component Stack:</div>
                      <div className="whitespace-pre-wrap">{this.state.errorInfo.componentStack}</div>
                    </>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
} 