/* Collab mode helpers — fail-closed to plain, with runtime lock + warnings */
export type CollabMode = 'plain' | 'yjs'

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function parseMode(value?: string | null): CollabMode | null {
  return value === 'plain' || value === 'yjs' ? value : null
}

function readEnvMode(): CollabMode | null {
  return parseMode(process.env.NEXT_PUBLIC_COLLAB_MODE)
}

function readQueryMode(): CollabMode | null {
  if (!isBrowser()) return null
  try {
    const q = new URLSearchParams(window.location.search).get('mode')
    return parseMode(q)
  } catch {
    return null
  }
}

function readStoredMode(): CollabMode | null {
  if (!isBrowser()) return null
  try {
    return parseMode(window.localStorage?.getItem('collab-mode'))
  } catch {
    return null
  }
}

export function getCollabMode(): CollabMode {
  // Precedence: ?mode=plain → env → stored → default(plain)
  const q = readQueryMode()
  if (q === 'plain') return 'plain'

  const env = readEnvMode()
  if (env) return env

  const stored = readStoredMode()
  if (stored) return stored

  // Fail-closed default
  return 'plain'
}

export function lockPlainMode(reason: 'query' | 'env' | 'default' | 'runtime' = 'runtime'): void {
  if (!isBrowser()) return
  try {
    window.localStorage?.setItem('collab-mode', 'plain')
    ;(window as any).__COLLAB_MODE_LOCK__ = { mode: 'plain', reason, ts: Date.now() }
    console.info(`[collab-mode] Locked to plain (${reason}). Yjs disabled.`)
  } catch {
    /* no-op */
  }
}

export function ensureFailClosed(): void {
  // Lock plain when explicitly selected or when env missing/invalid
  const q = readQueryMode()
  const env = readEnvMode()
  const stored = readStoredMode()

  if (q === 'plain') {
    lockPlainMode('query')
    return
  }
  if (env === 'plain') {
    lockPlainMode('env')
    return
  }
  if (!stored && env === null) {
    // Absent/invalid env — fail-closed to plain
    lockPlainMode('default')
  }
}

export function isPlainModeActive(): boolean {
  return getCollabMode() === 'plain'
}

export function warnIfYjsLoadAttempted(what: string): boolean {
  if (!isPlainModeActive()) return false
  try {
    const key = `__YJS_WARNED__:${what}`
    if (isBrowser() && !(window as any)[key]) {
      console.warn(`[collab-mode] Yjs load blocked in plain mode: ${what}`)
      ;(window as any)[key] = true
    } else {
      console.warn(`[collab-mode] Yjs load blocked in plain mode: ${what}`)
    }
  } catch {
    /* noop */
  }
  return true
}

