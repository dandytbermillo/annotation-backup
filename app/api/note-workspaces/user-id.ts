import type { NextRequest } from "next/server"

import { parseUserId } from "@/app/api/overlay/layout/shared"

export const DEFAULT_NOTE_WORKSPACE_USER_ID =
  process.env.DEFAULT_NOTE_WORKSPACE_USER_ID ?? "00000000-0000-0000-0000-000000000000"

export function resolveNoteWorkspaceUserId(request: NextRequest): string | "invalid" {
  const parsed = parseUserId(request.nextUrl.searchParams.get("userId"))
  if (parsed === "invalid") {
    return "invalid"
  }
  return parsed ?? DEFAULT_NOTE_WORKSPACE_USER_ID
}
