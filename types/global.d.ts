interface Window {
  app?: {
    resetView(): void
    zoomIn(): void
    zoomOut(): void
    selectBranchType(type: string): void
    toggleEraser(): void
    togglePan(): void
    getSelectedBranchType(): string
    toggleDebug(): void
    toggleMinimap(): void
    requestAnnotationRefresh(): void
  }
  electronAPI?: {
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>
    persistence: {
      persist: (docName: string, updateArray: Uint8Array) => Promise<void>
      load: (docName: string) => Promise<Uint8Array | null>
      getAllUpdates: (docName: string) => Promise<Uint8Array[]>
      clearUpdates: (docName: string) => Promise<void>
      saveSnapshot: (docName: string, snapshotArray: Uint8Array) => Promise<void>
      loadSnapshot: (docName: string) => Promise<Uint8Array | null>
      compact: (docName: string) => Promise<void>
      getStatus: () => Promise<{ mode: string; remoteHealthy: boolean; localHealthy: boolean }>
      forceMode: (mode: string) => Promise<void>
    }
  }
}