'use client';

import * as React from 'react';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useNotificationUnreadCount } from '@/lib/hooks/use-notification-center';
import { NotificationPanel } from './notification-panel';

export interface NotificationBellProps {
  /** Additional CSS classes */
  className?: string;

  /** Entry ID to scope notifications to */
  entryId?: string;
}

/**
 * Notification bell button with badge and dropdown panel.
 * Place this in the app toolbar.
 */
export function NotificationBell({
  className,
  entryId,
}: NotificationBellProps) {
  const [open, setOpen] = React.useState(false);
  const unreadCount = useNotificationUnreadCount();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative', className)}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex items-center justify-center',
                'min-w-[18px] h-[18px] rounded-full',
                'bg-destructive text-destructive-foreground',
                'text-[10px] font-bold px-1'
              )}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] p-0"
        align="end"
        sideOffset={8}
      >
        <NotificationPanel
          entryId={entryId}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
