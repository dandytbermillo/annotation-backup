import { NextRequest, NextResponse } from "next/server"

import { resolveNoteWorkspaceUserId } from "@/app/api/note-workspaces/user-id"
import { createNoteWorkspaceRecord, listNoteWorkspaces } from "@/lib/server/note-workspace-repo"
import type { NoteWorkspacePayload } from "@/lib/types/note-workspace"

export async function GET(request: NextRequest) {
  const userId = resolveNoteWorkspaceUserId(request)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }
  const workspaces = await listNoteWorkspaces(userId)
  return NextResponse.json({ workspaces })
}

export async function POST(request: NextRequest) {
  const userId = resolveNoteWorkspaceUserId(request)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }
  try {
    const body = await request.json()
    const payload = (body?.payload ?? {}) as NoteWorkspacePayload
    const name = typeof body?.name === "string" ? body.name : undefined
    const workspace = await createNoteWorkspaceRecord(userId, name, payload)
    return NextResponse.json({ workspace }, { status: 201 })
  } catch (error) {
    console.error("[note-workspace:create]", error)
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 400 })
  }
}
