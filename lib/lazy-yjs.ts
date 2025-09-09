// Guarded Yjs dynamic loaders to avoid bundling in plain mode
import { getCollabMode } from './collab-mode'

export async function loadYjsProvider() {
  if (getCollabMode() === 'plain') {
    console.warn('[lazy-yjs] Refusing to load yjs-provider in plain mode')
    return null as any
  }
  return await import('./yjs-provider')
}

export async function loadEnhancedProvider() {
  if (getCollabMode() === 'plain') {
    console.warn('[lazy-yjs] Refusing to load enhanced-yjs-provider in plain mode')
    return null as any
  }
  return await import('./enhanced-yjs-provider')
}

