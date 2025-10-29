'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  errorType: 'group-selection' | 'rendering' | 'state-corruption' | 'unknown';
}

export class ConstellationErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorType: 'unknown'
  };

  public static getDerivedStateFromError(error: Error): State {
    // Analyze error to determine type
    let errorType: State['errorType'] = 'unknown';
    
    if (error.message.includes('groupItems') || error.message.includes('group selection')) {
      errorType = 'group-selection';
    } else if (error.message.includes('render') || error.message.includes('SVG')) {
      errorType = 'rendering';
    } else if (error.message.includes('state') || error.message.includes('undefined')) {
      errorType = 'state-corruption';
    }

    return {
      hasError: true,
      errorType
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🌌 ConstellationErrorBoundary caught error:', {
      error: error.message,
      errorType: this.state.errorType,
      componentStack: errorInfo.componentStack
    });

    // Log specific error details for debugging
    if (this.state.errorType === 'group-selection') {
      console.error('📁 Group selection error - possible causes:', {
        'Corrupted ref state': 'groupSelectionRef.current may be invalid',
        'Missing item data': 'allItems array may be incomplete',
        'Invalid item IDs': 'Selected items may no longer exist',
        'Race condition': 'State update timing issue'
      });
    }
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      errorType: 'unknown'
    });
    
    // Call parent reset handler
    this.props.onReset?.();
  };

  private getErrorMessage() {
    switch (this.state.errorType) {
      case 'group-selection':
        return {
          title: 'Group Selection Error',
          description: 'There was an issue with folder/constellation group selection.',
          suggestions: [
            'Try clearing group selection with Escape key',
            'Refresh the page to reset all selections',
            'Check if the selected items still exist'
          ]
        };
      case 'rendering':
        return {
          title: 'Visualization Rendering Error',
          description: 'The constellation visualization failed to render properly.',
          suggestions: [
            'Try zooming out or resetting the view',
            'Check if your browser supports SVG',
            'Refresh the page to reload the visualization'
          ]
        };
      case 'state-corruption':
        return {
          title: 'State Corruption Error',
          description: 'The application state became corrupted.',
          suggestions: [
            'Reset all selections and try again',
            'Refresh the page to start fresh',
            'Check browser console for more details'
          ]
        };
      default:
        return {
          title: 'Constellation Error',
          description: 'An unexpected error occurred in the constellation system.',
          suggestions: [
            'Try refreshing the page',
            'Check browser console for details',
            'Contact support if the issue persists'
          ]
        };
    }
  }

  public render() {
    if (this.state.hasError) {
      const errorInfo = this.getErrorMessage();
      
      return (
        <ErrorBoundary
          fallback={
            <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
              <div className="bg-gray-800 rounded-lg shadow-xl p-6 max-w-lg w-full">
                <div className="flex items-center mb-4">
                  <div className="text-yellow-400 text-3xl mr-3">🌌</div>
                  <h2 className="text-xl font-semibold text-white">
                    {errorInfo.title}
                  </h2>
                </div>
                
                <p className="text-gray-300 mb-4">
                  {errorInfo.description}
                </p>
                
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-200 mb-2">
                    Suggested Solutions:
                  </h3>
                  <ul className="text-sm text-gray-400 space-y-1">
                    {errorInfo.suggestions.map((suggestion, index) => (
                      <li key={index}>• {suggestion}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={this.handleReset}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md transition-colors"
                  >
                    Refresh Page
                  </button>
                </div>

                <div className="mt-4 p-3 bg-gray-900 rounded text-xs text-gray-400">
                  <strong>Error Type:</strong> {this.state.errorType}
                  <br />
                  <strong>Tip:</strong> Press F12 to open developer tools for more details
                </div>
              </div>
            </div>
          }
        >
          {this.props.children}
        </ErrorBoundary>
      );
    }

    return this.props.children;
  }
} 