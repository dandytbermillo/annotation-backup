import { useEffect, useState } from 'react'

const CAMERA_SCOPE = (process.env.NEXT_PUBLIC_CANVAS_CAMERA_SCOPE || 'shared').toLowerCase()
const STORAGE_KEY = 'canvas:camera-user-id'

const isBrowser = typeof window !== 'undefined'

export function isPerUserCameraScope(): boolean {
  return CAMERA_SCOPE === 'per-user'
}

function generateUuid(): string {
  if (isBrowser && typeof window.crypto?.randomUUID === 'function') {
    return window.crypto.randomUUID()
  }
  // Lightweight fallback (not cryptographically strong, but stable enough for client-only IDs)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8
    return value.toString(16)
  })
}

export function resolveCameraUserId(): string | null {
  if (!isPerUserCameraScope() || !isBrowser) {
    return null
  }

  try {
    const fromStorage = window.localStorage.getItem(STORAGE_KEY)
    if (fromStorage && fromStorage.length > 0) {
      return fromStorage
    }

    const potentialSources: Array<string | undefined> = [
      (window as any).__CONTEXT_OS_USER__?.id,
      (window as any).__contextOsUser?.id,
      window.localStorage.getItem('context-os:user-id') || undefined,
      window.sessionStorage?.getItem?.('context-os:user-id') || undefined,
    ]

    const resolved = potentialSources.find((candidate) => typeof candidate === 'string' && candidate.length > 0)
    const finalId = resolved || generateUuid()

    window.localStorage.setItem(STORAGE_KEY, finalId)
    return finalId
  } catch {
    return null
  }
}

export function useCameraUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(() => {
    if (!isBrowser || !isPerUserCameraScope()) {
      return null
    }
    return resolveCameraUserId()
  })

  useEffect(() => {
    if (!isPerUserCameraScope()) {
      setUserId(null)
      return
    }

    const id = resolveCameraUserId()
    if (id !== userId) {
      setUserId(id)
    }
  }, [userId])

  return userId
}
