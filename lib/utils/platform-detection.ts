export type Platform = 'web' | 'electron'

export function detectPlatform(): Platform {
  if (typeof window !== 'undefined' && (window as any).electronAPI) {
    return 'electron'
  }
  return 'web'
}

export function getPlatformCapabilities() {
  const platform = detectPlatform()
  
  return {
    platform,
    hasServiceWorker: typeof window !== 'undefined' && 'serviceWorker' in navigator,
    hasWebRTC: typeof RTCPeerConnection !== 'undefined',
    hasCompressionStream: typeof window !== 'undefined' && 'CompressionStream' in window,
    hasWebWorkers: typeof Worker !== 'undefined',
    hasIndexedDB: typeof window !== 'undefined' && 'indexedDB' in window,
    hasSQLite: platform === 'electron',
    hasFileSystem: platform === 'electron',
    hasNotifications: typeof window !== 'undefined' && 'Notification' in window,
    hasPersistentStorage: typeof navigator !== 'undefined' && 
                         'storage' in navigator && 
                         'persist' in navigator.storage
  }
} 