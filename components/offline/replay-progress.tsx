'use client';

import React, { useState, useEffect } from 'react';
import { swManager, QueueStatus, WriteOperation } from '@/lib/offline/service-worker-manager';

interface ReplayProgressProps {
  className?: string;
}

export function ReplayProgress({ className = '' }: ReplayProgressProps) {
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [failedOps, setFailedOps] = useState<WriteOperation[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Get initial queue status
    updateQueueStatus();

    // Listen for SW messages
    const unsubscribeQueued = swManager.onMessage('write-queued', (data) => {
      updateQueueStatus();
      setIsProcessing(true);
    });

    const unsubscribeCompleted = swManager.onMessage('write-completed', (data) => {
      setCompletedCount(prev => prev + 1);
      updateQueueStatus();
    });

    const unsubscribeFailed = swManager.onMessage('write-failed', (data) => {
      setFailedOps(prev => [...prev, data.operation]);
      updateQueueStatus();
    });

    // Update status periodically
    const interval = setInterval(updateQueueStatus, 5000);

    return () => {
      unsubscribeQueued();
      unsubscribeCompleted();
      unsubscribeFailed();
      clearInterval(interval);
    };
  }, []);

  const updateQueueStatus = async () => {
    const status = await swManager.getQueueStatus();
    setQueueStatus(status);
    
    if (status && status.queueLength === 0) {
      setIsProcessing(false);
    }
  };

  const handleSyncNow = async () => {
    setIsProcessing(true);
    await swManager.triggerSync();
  };

  const handleRequeue = (op: WriteOperation) => {
    // Send requeue request to backend
    fetch('/api/offline-queue/requeue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    }).then(() => {
      setFailedOps(prev => prev.filter(o => o.timestamp !== op.timestamp));
      updateQueueStatus();
    });
  };

  const handleDiscard = (op: WriteOperation) => {
    // Remove from failed operations
    setFailedOps(prev => prev.filter(o => o.timestamp !== op.timestamp));
  };

  if (!queueStatus || (queueStatus.queueLength === 0 && failedOps.length === 0)) {
    return null;
  }

  const totalOperations = queueStatus.queueLength + failedOps.length;
  const progress = completedCount > 0 
    ? Math.round((completedCount / (completedCount + totalOperations)) * 100)
    : 0;

  return (
    <div className={`fixed bottom-4 right-4 z-50 ${className}`}>
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 w-96">
        {/* Header */}
        <div 
          className="p-4 border-b border-gray-200 cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isProcessing ? (
                <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
              ) : (
                <div className={`h-5 w-5 rounded-full ${
                  failedOps.length > 0 ? 'bg-red-500' : 'bg-green-500'
                }`} />
              )}
              <div>
                <h3 className="font-semibold text-gray-900">
                  Offline Queue
                </h3>
                <p className="text-sm text-gray-600">
                  {queueStatus.queueLength} pending, {failedOps.length} failed
                </p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${
                expanded ? 'rotate-180' : ''
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          {/* Progress bar */}
          {isProcessing && progress > 0 && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Processing...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Expanded content */}
        {expanded && (
          <>
            {/* Pending operations */}
            {queueStatus.queueLength > 0 && (
              <div className="p-4 border-b border-gray-200">
                <h4 className="font-medium text-gray-700 mb-2">
                  Pending Operations ({queueStatus.queueLength})
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {queueStatus.queue.slice(0, 5).map((op, i) => (
                    <div key={op.timestamp} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">
                          {op.method} {op.url.split('?')[0]}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(op.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      {op.retries > 0 && (
                        <span className="text-xs text-orange-600">
                          Retry {op.retries}
                        </span>
                      )}
                    </div>
                  ))}
                  {queueStatus.queueLength > 5 && (
                    <div className="text-xs text-gray-500 italic">
                      +{queueStatus.queueLength - 5} more...
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Failed operations */}
            {failedOps.length > 0 && (
              <div className="p-4 border-b border-gray-200">
                <h4 className="font-medium text-red-700 mb-2">
                  Failed Operations ({failedOps.length})
                </h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {failedOps.map((op) => (
                    <div key={op.timestamp} className="bg-red-50 p-2 rounded">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-700">
                          {op.method} {op.url.split('?')[0]}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleRequeue(op)}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            Retry
                          </button>
                          <button
                            onClick={() => handleDiscard(op)}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-gray-500">
                        Failed after {op.retries} retries
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="p-4 bg-gray-50">
              <div className="flex gap-2">
                <button
                  onClick={handleSyncNow}
                  disabled={isProcessing || queueStatus.queueLength === 0}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {isProcessing ? 'Processing...' : 'Sync Now'}
                </button>
                {failedOps.length > 0 && (
                  <button
                    onClick={() => setFailedOps([])}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                  >
                    Clear Failed
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}