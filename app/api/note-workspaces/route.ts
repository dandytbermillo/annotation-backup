import { NextRequest, NextResponse } from "next/server"

import { resolveNoteWorkspaceUserId } from "@/app/api/note-workspaces/user-id"
import { createNoteWorkspaceRecord, listNoteWorkspaces, listNoteWorkspacesByItemId } from "@/lib/server/note-workspace-repo"
import type { NoteWorkspacePayload } from "@/lib/types/note-workspace"

export async function GET(request: NextRequest) {
  const userId = resolveNoteWorkspaceUserId(request)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }

  // Check for itemId filter (used by Navigator panel)
  const itemId = request.nextUrl.searchParams.get('itemId')

  if (itemId) {
    // Filter workspaces by itemId
    const workspaces = await listNoteWorkspacesByItemId(userId, itemId)
    return NextResponse.json({ workspaces })
  }

  const workspaces = await listNoteWorkspaces(userId)
  return NextResponse.json({ workspaces })
}

export async function POST(request: NextRequest) {
  const userId = resolveNoteWorkspaceUserId(request)
  console.log("[note-workspace:create] userId:", userId)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }
  try {
    const body = await request.json()
    console.log("[note-workspace:create] body:", JSON.stringify(body))
    const payload = (body?.payload ?? {}) as NoteWorkspacePayload
    const name = typeof body?.name === "string" ? body.name : undefined
    const itemId = typeof body?.itemId === "string" ? body.itemId : undefined
    console.log("[note-workspace:create] Creating workspace with name:", name, "itemId:", itemId)
    const workspace = await createNoteWorkspaceRecord(userId, name, payload, itemId)
    console.log("[note-workspace:create] Created workspace:", workspace.id)
    return NextResponse.json({ workspace }, { status: 201 })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error("[note-workspace:create] Error:", errorMessage)
    console.error("[note-workspace:create] Stack:", errorStack)
    return NextResponse.json({ error: "Failed to create workspace", details: errorMessage }, { status: 400 })
  }
}
