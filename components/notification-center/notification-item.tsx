'use client';

import * as React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Notification, NotificationSeverity } from '@/lib/notification-center/types';

export interface NotificationItemProps {
  /** The notification to display */
  notification: Notification;

  /** Whether the details are expanded */
  expanded?: boolean;

  /** Toggle expansion */
  onToggleExpand?: () => void;

  /** Mark as read callback */
  onMarkRead?: () => void;

  /** Dismiss callback */
  onDismiss?: () => void;

  /** Additional CSS classes */
  className?: string;
}

const SEVERITY_CONFIG: Record<
  NotificationSeverity,
  {
    icon: React.ElementType;
    iconClass: string;
    bgClass: string;
  }
> = {
  error: {
    icon: AlertCircle,
    iconClass: 'text-destructive',
    bgClass: 'bg-destructive/10',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'text-yellow-600 dark:text-yellow-500',
    bgClass: 'bg-yellow-500/10',
  },
  info: {
    icon: Info,
    iconClass: 'text-blue-600 dark:text-blue-500',
    bgClass: 'bg-blue-500/10',
  },
  success: {
    icon: CheckCircle2,
    iconClass: 'text-green-600 dark:text-green-500',
    bgClass: 'bg-green-500/10',
  },
};

/**
 * Format a timestamp for display.
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
}

/**
 * Individual notification item with severity indicator, timestamp,
 * count badge, and expandable details.
 */
export function NotificationItem({
  notification,
  expanded = false,
  onToggleExpand,
  onMarkRead,
  onDismiss,
  className,
}: NotificationItemProps) {
  const {
    severity,
    title,
    description,
    details,
    count,
    createdAt,
    lastSeenAt,
    readAt,
  } = notification;

  const isUnread = readAt === null;
  const config = SEVERITY_CONFIG[severity];
  const Icon = config.icon;

  const handleClick = () => {
    // Mark as read when clicking
    if (isUnread && onMarkRead) {
      onMarkRead();
    }
    // Toggle expansion
    if (onToggleExpand) {
      onToggleExpand();
    }
  };

  return (
    <div
      className={cn(
        'relative group',
        isUnread && 'bg-accent/50',
        className
      )}
    >
      {/* Unread indicator */}
      {isUnread && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-primary" />
      )}

      {/* Main content */}
      <button
        className={cn(
          'w-full text-left px-4 py-3 cursor-pointer',
          'hover:bg-accent/50 transition-colors',
          isUnread && 'pl-5'
        )}
        onClick={handleClick}
      >
        <div className="flex items-start gap-3">
          {/* Severity icon */}
          <div
            className={cn(
              'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
              config.bgClass
            )}
          >
            <Icon className={cn('h-4 w-4', config.iconClass)} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{title}</span>
              {count > 1 && (
                <span
                  className={cn(
                    'flex-shrink-0 px-1.5 py-0.5 text-[10px] font-bold rounded-full',
                    'bg-muted text-muted-foreground'
                  )}
                >
                  {count}x
                </span>
              )}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[10px] text-muted-foreground">
                {formatTimestamp(count > 1 ? lastSeenAt : createdAt)}
              </span>
              {count > 1 && (
                <span className="text-[10px] text-muted-foreground">
                  (first: {formatTimestamp(createdAt)})
                </span>
              )}
            </div>
          </div>

          {/* Expand/collapse indicator */}
          {details && Object.keys(details).length > 0 && (
            <div className="flex-shrink-0">
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          )}
        </div>

        {/* Expanded details */}
        {expanded && details && Object.keys(details).length > 0 && (
          <div className="mt-3 ml-11 p-3 bg-muted/50 rounded-md text-xs">
            <div className="font-medium mb-2">Details</div>
            <div className="space-y-1">
              {Object.entries(details).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-muted-foreground">{key}:</span>
                  <span className="font-mono break-all">
                    {typeof value === 'object'
                      ? JSON.stringify(value)
                      : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </button>

      {/* Dismiss button (visible on hover) */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'absolute right-2 top-2 h-6 w-6',
          'opacity-0 group-hover:opacity-100 transition-opacity'
        )}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss?.();
        }}
        aria-label="Dismiss notification"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
