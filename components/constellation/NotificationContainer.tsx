'use client';

import React from 'react';
import { Notification } from '@/types/constellation';

interface NotificationContainerProps {
  notifications: Notification[];
  onRemove: (id: string) => void;
}

export default function NotificationContainer({ notifications, onRemove }: NotificationContainerProps) {
  const getNotificationStyles = (type: string) => {
    switch (type) {
      case 'success':
        return 'bg-green-500/90 border-green-400 text-green-100';
      case 'error':
        return 'bg-red-500/90 border-red-400 text-red-100';
      case 'warning':
        return 'bg-yellow-500/90 border-yellow-400 text-yellow-100';
      default:
        return 'bg-blue-500/90 border-blue-400 text-blue-100';
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  };

  return (
    <div className="fixed top-5 right-5 z-50 space-y-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border backdrop-blur-sm shadow-lg transition-all duration-300 transform animate-in slide-in-from-right ${getNotificationStyles(notification.type)}`}
        >
          <span className="text-lg">{getNotificationIcon(notification.type)}</span>
          <span className="text-sm font-medium">{notification.message}</span>
          <button
            onClick={() => onRemove(notification.id)}
            className="ml-2 text-lg opacity-70 hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
} 