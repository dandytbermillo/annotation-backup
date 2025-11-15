import type { NoteWorkspacePayload, NoteWorkspaceRecord } from "@/lib/types/note-workspace"

export type NoteWorkspaceSummary = {
  id: string
  name: string
  isDefault: boolean
  updatedAt: string
  noteCount: number
  revision: string
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch (error) {
    console.error("[NoteWorkspaceAdapter] Failed to parse JSON", error, text)
    throw new Error("INVALID_RESPONSE")
  }
}

export class NoteWorkspaceAdapter {
  private endpoint = "/api/note-workspaces"

  async listWorkspaces(): Promise<NoteWorkspaceSummary[]> {
    const response = await fetch(this.endpoint, { cache: "no-store" })
    if (!response.ok) {
      throw new Error(`Failed to list workspaces: ${response.status}`)
    }
    const data = await parseJson<{ workspaces: NoteWorkspaceRecord[] }>(response)
    return data.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      isDefault: workspace.isDefault,
      updatedAt: workspace.updatedAt,
      noteCount: workspace.noteCount,
      revision: workspace.revision,
    }))
  }

  async createWorkspace(input: { name?: string; payload: NoteWorkspacePayload }): Promise<NoteWorkspaceRecord> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw new Error(`Failed to create workspace: ${response.status}`)
    }
    const data = await parseJson<{ workspace: NoteWorkspaceRecord }>(response)
    return data.workspace
  }

  async loadWorkspace(id: string): Promise<NoteWorkspaceRecord> {
    const response = await fetch(`${this.endpoint}/${id}`, { cache: "no-store" })
    if (!response.ok) {
      throw new Error(`Failed to load workspace: ${response.status}`)
    }
    const data = await parseJson<{ workspace: NoteWorkspaceRecord }>(response)
    return data.workspace
  }

  async saveWorkspace(input: { id: string; payload: NoteWorkspacePayload; revision: string; name?: string }): Promise<NoteWorkspaceRecord> {
    const response = await fetch(`${this.endpoint}/${input.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": input.revision,
      },
      body: JSON.stringify({ payload: input.payload, revision: input.revision, name: input.name }),
    })
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error("REVISION_MISMATCH")
      }
      throw new Error(`Failed to save workspace: ${response.status}`)
    }
    const data = await parseJson<{ workspace: NoteWorkspaceRecord }>(response)
    return data.workspace
  }

  async deleteWorkspace(id: string): Promise<void> {
    const response = await fetch(`${this.endpoint}/${id}`, { method: "DELETE" })
    if (!response.ok && response.status !== 204) {
      throw new Error(`Failed to delete workspace: ${response.status}`)
    }
  }
}
