'use client'

/**
 * Chat Navigation Root
 *
 * Global instance of the chat navigation panel that renders without a trigger.
 * This is mounted at the app level to ensure a single panel instance across all views.
 */

import { ChatNavigationPanel } from './chat-navigation-panel'

export function ChatNavigationRoot() {
  return <ChatNavigationPanel showTrigger={false} />
}
