'use client';

import * as React from 'react';
import { CheckCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useNotificationCenter } from '@/lib/hooks/use-notification-center';
import type { NotificationFilter } from '@/lib/notification-center/types';
import { NotificationItem } from './notification-item';

export interface NotificationPanelProps {
  /** Entry ID to scope notifications to */
  entryId?: string;

  /** Callback when panel should close */
  onClose?: () => void;

  /** Additional CSS classes */
  className?: string;
}

const FILTERS: { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'error', label: 'Errors' },
  { value: 'warning', label: 'Warnings' },
  { value: 'info', label: 'Info' },
  { value: 'success', label: 'Success' },
];

/**
 * Notification panel with filters, list, and actions.
 * Used inside the NotificationBell popover.
 */
export function NotificationPanel({
  entryId: _entryId,
  onClose: _onClose,
  className,
}: NotificationPanelProps) {
  const [filter, setFilter] = React.useState<NotificationFilter>('all');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [clearing, setClearing] = React.useState(false);

  const {
    notifications,
    unreadCount,
    markRead,
    markAllRead,
    dismiss,
    clearAll,
  } = useNotificationCenter({ filter });

  const handleMarkAllRead = async () => {
    await markAllRead();
  };

  const handleClearAll = async () => {
    if (clearing) return;

    // Confirm before clearing
    const confirmed = window.confirm(
      'Are you sure you want to clear all notifications? This cannot be undone.'
    );

    if (confirmed) {
      setClearing(true);
      try {
        await clearAll();
      } finally {
        setClearing(false);
      }
    }
  };

  const handleDismiss = async (id: string) => {
    await dismiss(id);
    if (expandedId === id) {
      setExpandedId(null);
    }
  };

  const handleToggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="font-semibold">Notifications</h3>
        {unreadCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {unreadCount} unread
          </span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b px-2 py-2">
        {FILTERS.map(({ value, label }) => (
          <Button
            key={value}
            variant={filter === value ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {/* Notification list */}
      <ScrollArea className="h-[320px]">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-12 text-muted-foreground">
            <p className="text-sm">No notifications</p>
            {filter !== 'all' && (
              <p className="text-xs mt-1">
                Try selecting a different filter
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                expanded={expandedId === notification.id}
                onToggleExpand={() => handleToggleExpand(notification.id)}
                onMarkRead={() => markRead(notification.id)}
                onDismiss={() => handleDismiss(notification.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer with actions */}
      {notifications.length > 0 && (
        <div className="flex items-center justify-between border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark all read
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={handleClearAll}
            disabled={clearing}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
