export function makePanelKey(noteId: string, panelId: string): string {
  return `${noteId}::${panelId}`
}

export function parsePanelKey(key: string): { noteId: string; panelId: string } {
  const delimiterIndex = key.indexOf("::")
  if (delimiterIndex === -1) {
    return { noteId: "", panelId: key }
  }
  return {
    noteId: key.slice(0, delimiterIndex),
    panelId: key.slice(delimiterIndex + 2),
  }
}

export function ensurePanelKey(noteId: string, panelId: string): string {
  if (!noteId) return panelId
  if (panelId.startsWith(`${noteId}::`)) {
    return panelId
  }
  return makePanelKey(noteId, panelId)
}
