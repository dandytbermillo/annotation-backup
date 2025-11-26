const NOTE_WORKSPACE_FLAG = (process.env.NEXT_PUBLIC_NOTE_WORKSPACES ?? "disabled").toLowerCase()
const NOTE_WORKSPACE_V2_FLAG = (process.env.NEXT_PUBLIC_NOTE_WORKSPACES_V2 ?? "enabled").toLowerCase()
const NOTE_WORKSPACE_LIVE_STATE_FLAG = (process.env.NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE ?? "disabled").toLowerCase()
const ENABLED_VALUES = new Set(["enabled", "true", "1", "on"])

export function isNoteWorkspaceEnabled(): boolean {
  let flag = NOTE_WORKSPACE_FLAG
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_NOTE_WORKSPACES")
      if (stored) {
        flag = stored.toLowerCase()
      }
    } catch {
      // ignore storage issues
    }
  }
  return ENABLED_VALUES.has(flag)
}

export function isNoteWorkspaceV2Enabled(): boolean {
  let flag = NOTE_WORKSPACE_V2_FLAG
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_NOTE_WORKSPACES_V2")
      if (stored) {
        flag = stored.toLowerCase()
      }
    } catch {
      // ignore storage access issues
    }
  }
  return ENABLED_VALUES.has(flag)
}

export function isNoteWorkspaceLiveStateEnabled(): boolean {
  let flag = NOTE_WORKSPACE_LIVE_STATE_FLAG
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem("NEXT_PUBLIC_NOTE_WORKSPACES_LIVE_STATE")
      if (stored) {
        flag = stored.toLowerCase()
      }
    } catch {
      // ignore storage access issues
    }
  }
  return ENABLED_VALUES.has(flag)
}
