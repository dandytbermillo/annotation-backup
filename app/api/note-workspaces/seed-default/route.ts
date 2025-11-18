import { NextRequest, NextResponse } from "next/server"

import { resolveNoteWorkspaceUserId } from "@/app/api/note-workspaces/user-id"
import { ensureDefaultWorkspaceRecord } from "@/lib/server/note-workspace-repo"

export async function POST(request: NextRequest) {
  const userId = resolveNoteWorkspaceUserId(request)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }
  try {
    const workspace = await ensureDefaultWorkspaceRecord(userId)
    if (!workspace) {
      return NextResponse.json({ error: "Failed to ensure default workspace" }, { status: 500 })
    }
    return NextResponse.json({ workspace })
  } catch (error) {
    console.error("[note-workspace:seed-default]", error)
    return NextResponse.json({ error: "Failed to ensure default workspace" }, { status: 500 })
  }
}
