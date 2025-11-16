import { NextRequest, NextResponse } from "next/server"

import { resolveNoteWorkspaceUserId } from "@/app/api/note-workspaces/user-id"
import {
  deleteNoteWorkspaceRecord,
  getNoteWorkspaceById,
  saveNoteWorkspaceRecord,
} from "@/lib/server/note-workspace-repo"
import type { NoteWorkspacePayload } from "@/lib/types/note-workspace"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = resolveNoteWorkspaceUserId(request)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }
  const workspace = await getNoteWorkspaceById(userId, id)
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
  }
  return NextResponse.json({ workspace })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = resolveNoteWorkspaceUserId(request)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }
  try {
    const body = await request.json()
    const payload = (body?.payload ?? {}) as NoteWorkspacePayload
    const revision = typeof body?.revision === "string" ? body.revision : request.headers.get("if-match")
    const name = typeof body?.name === "string" ? body.name : undefined
    if (!revision) {
      return NextResponse.json({ error: "Missing revision" }, { status: 412 })
    }
    const workspace = await saveNoteWorkspaceRecord({
      userId,
      workspaceId: id,
      payload,
      revision,
      name,
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
      }
      if (error.message === "REVISION_MISMATCH") {
        return NextResponse.json({ error: "Revision mismatch" }, { status: 409 })
      }
    }
    console.error("[note-workspace:update]", error)
    return NextResponse.json({ error: "Failed to save workspace" }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const userId = resolveNoteWorkspaceUserId(request)
  if (userId === "invalid") {
    return NextResponse.json({ error: "Invalid userId" }, { status: 400 })
  }
  try {
    await deleteNoteWorkspaceRecord(userId, id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NOT_FOUND") {
        return NextResponse.json({ error: "Workspace not found" }, { status: 404 })
      }
      if (error.message === "CANNOT_DELETE_DEFAULT") {
        return NextResponse.json({ error: "Cannot delete default workspace" }, { status: 422 })
      }
    }
    console.error("[note-workspace:delete]", error)
    return NextResponse.json(
      {
        error: "Failed to delete workspace",
        reason: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    )
  }
}
