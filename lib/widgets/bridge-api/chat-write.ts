/**
 * Chat Write Bridge API Handlers
 * Phase 3.3: Permission Gating + Write APIs
 *
 * Write handlers for chat operations (require write:chat permission).
 */

// =============================================================================
// Types
// =============================================================================

/** Params for sendMessage */
export interface SendMessageParams {
  message: string
  /** Optional: metadata to attach to the message */
  metadata?: Record<string, unknown>
}

/** Result for chat write operations */
export interface ChatWriteResult {
  success: boolean
  messageId?: string
  error?: string
}

/** Callbacks for chat write operations */
export interface ChatWriteCallbacks {
  sendMessage?: (params: { message: string; metadata?: Record<string, unknown> }) => Promise<string | null>
}

// =============================================================================
// Handler Functions
// =============================================================================

/**
 * Send a message to the chat
 * Permission: write:chat
 *
 * This allows widgets to programmatically send messages to the chat assistant.
 * Use cases:
 * - Widget wants to trigger an action via natural language
 * - Widget wants to share data with the user through chat
 */
export async function handleSendMessage(
  params: SendMessageParams,
  callbacks: ChatWriteCallbacks
): Promise<ChatWriteResult> {
  if (!params.message) {
    return { success: false, error: 'message is required' }
  }

  // Validate message length (prevent abuse)
  const MAX_MESSAGE_LENGTH = 4000
  if (params.message.length > MAX_MESSAGE_LENGTH) {
    return {
      success: false,
      error: `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
    }
  }

  if (!callbacks.sendMessage) {
    return { success: false, error: 'sendMessage not implemented' }
  }

  try {
    const messageId = await callbacks.sendMessage({
      message: params.message,
      metadata: params.metadata,
    })
    if (messageId) {
      return { success: true, messageId }
    }
    return { success: false, error: 'Failed to send message' }
  } catch (error) {
    console.error('[BridgeAPI] Error sending message:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
