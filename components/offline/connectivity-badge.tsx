'use client';

import React, { useEffect, useState } from 'react';
import { NetworkStatus, networkService } from '@/lib/offline/network-service';

interface ConnectivityBadgeProps {
  className?: string;
  showDetails?: boolean;
}

export function ConnectivityBadge({ className = '', showDetails = true }: ConnectivityBadgeProps) {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Get initial status
    const currentStatus = networkService.getStatus();
    setStatus(currentStatus);

    // Subscribe to status changes
    const unsubscribe = networkService.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });

    // Start network service
    networkService.start();

    return () => {
      unsubscribe();
    };
  }, []);

  if (!status) return null;

  const getQualityColor = () => {
    switch (status.quality) {
      case 'good':
        return 'bg-green-500';
      case 'degraded':
        return 'bg-yellow-500';
      case 'offline':
        return 'bg-red-500';
    }
  };

  const getQualityText = () => {
    switch (status.quality) {
      case 'good':
        return 'Online';
      case 'degraded':
        return 'Degraded';
      case 'offline':
        return 'Offline';
    }
  };

  const getCircuitStateIcon = () => {
    switch (status.circuitState) {
      case 'closed':
        return '✓';
      case 'half-open':
        return '⚡';
      case 'open':
        return '✕';
    }
  };

  const formatTime = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className={`relative ${className}`}>
      {/* Main Badge */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-full text-white text-sm font-medium
          transition-all duration-200 hover:opacity-90 cursor-pointer
          ${getQualityColor()}
        `}
      >
        {/* Status Indicator */}
        <div className="relative">
          <div className={`w-2 h-2 rounded-full bg-white ${status.quality === 'good' ? 'animate-pulse' : ''}`} />
        </div>
        
        {/* Status Text */}
        <span>{getQualityText()}</span>
        
        {/* Queue Badge */}
        {status.queueDepth > 0 && (
          <span className="bg-black/20 px-2 py-0.5 rounded-full text-xs">
            {status.queueDepth}
          </span>
        )}
        
        {showDetails && (
          <svg
            className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Expanded Details */}
      {showDetails && expanded && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
          <div className="p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Network Status</h3>
            
            {/* Quality */}
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">Quality</span>
              <span className={`text-sm font-medium ${
                status.quality === 'good' ? 'text-green-600' :
                status.quality === 'degraded' ? 'text-yellow-600' :
                'text-red-600'
              }`}>
                {getQualityText()}
              </span>
            </div>
            
            {/* RTT */}
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">Latency</span>
              <span className="text-sm font-medium text-gray-900">
                {status.rtt > 0 ? `${Math.round(status.rtt)}ms` : 'N/A'}
              </span>
            </div>
            
            {/* Circuit State */}
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">Circuit</span>
              <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
                <span>{getCircuitStateIcon()}</span>
                <span className="capitalize">{status.circuitState}</span>
              </span>
            </div>
            
            {/* Queue Depth */}
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">Queue Depth</span>
              <span className={`text-sm font-medium ${
                status.queueDepth > 10 ? 'text-orange-600' :
                status.queueDepth > 0 ? 'text-yellow-600' :
                'text-green-600'
              }`}>
                {status.queueDepth}
              </span>
            </div>
            
            {/* Last Sync */}
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm text-gray-600">Last Sync</span>
              <span className="text-sm font-medium text-gray-900">
                {formatTime(status.lastSyncTime)}
              </span>
            </div>
            
            {/* Last Probe */}
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Last Probe</span>
              <span className="text-sm font-medium text-gray-900">
                {status.lastProbeTime > 0 ? formatTime(status.lastProbeTime) : 'Never'}
              </span>
            </div>
          </div>
          
          {/* Actions */}
          <div className="border-t border-gray-200 p-3 bg-gray-50 rounded-b-lg">
            <button
              onClick={() => networkService.probe()}
              className="w-full text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Force Probe Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}