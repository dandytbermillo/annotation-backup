/**
 * Chat User ID Resolution
 *
 * For v1 (single-user), always use server-side constant.
 * Never accept user_id from client requests.
 */

export const CHAT_USER_ID =
  process.env.DEFAULT_NOTE_WORKSPACE_USER_ID ?? '00000000-0000-0000-0000-000000000000'

/**
 * Get the user ID for chat operations.
 * Always returns the server-side constant (single-user v1).
 */
export function getChatUserId(): string {
  return CHAT_USER_ID
}
