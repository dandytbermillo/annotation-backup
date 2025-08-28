// Provider Switcher - Allows switching between Yjs collaboration and plain offline mode
// This fixes the awareness.getStates error while enabling enhanced features

import { CollaborationProvider } from './yjs-provider'
import { EnhancedCollaborationProvider } from './enhanced-yjs-provider'
import './enhanced-yjs-provider-patch' // Apply the patch
import { applyEnhancedProviderPatch } from './enhanced-yjs-provider-patch'
import { PlainOfflineProvider } from './providers/plain-offline-provider'

// Apply patch on module load
applyEnhancedProviderPatch()

// Feature flags for provider selection
const USE_ENHANCED_PROVIDER = process.env.NEXT_PUBLIC_USE_ENHANCED_PROVIDER === 'true' || 
                              typeof window !== 'undefined' && window.localStorage?.getItem('use-enhanced-provider') === 'true'

const COLLAB_MODE = process.env.NEXT_PUBLIC_COLLAB_MODE || 
                    (typeof window !== 'undefined' && window.localStorage?.getItem('collab-mode')) || 
                    'yjs' // default to yjs mode

// Singleton instance for plain provider
let plainProviderInstance: PlainOfflineProvider | null = null

// Quick fix for old provider - add missing getStates method
const originalGetProvider = CollaborationProvider.prototype.getProvider
CollaborationProvider.prototype.getProvider = function() {
  const provider = originalGetProvider.call(this)
  
  // Fix the awareness.getStates error
  if (provider.awareness && !provider.awareness.getStates) {
    provider.awareness.getStates = () => provider.awareness.states || new Map()
    provider.awareness.clientID = provider.awareness.clientID || 1
    provider.awareness.meta = provider.awareness.meta || new Map()
  }
  
  return provider
}

// Unified interface that switches between providers
export class UnifiedProvider {
  private static instance: UnifiedProvider
  private provider: CollaborationProvider | EnhancedCollaborationProvider
  
  private constructor() {
    if (USE_ENHANCED_PROVIDER) {
      console.log('🚀 Using Enhanced YJS Provider with all advanced features')
      this.provider = EnhancedCollaborationProvider.getInstance()
    } else {
      console.log('Using standard YJS Provider (with getStates fix)')
      this.provider = CollaborationProvider.getInstance()
    }
  }
  
  public static getInstance(): UnifiedProvider {
    if (!UnifiedProvider.instance) {
      UnifiedProvider.instance = new UnifiedProvider()
    }
    return UnifiedProvider.instance
  }
  
  // Delegate all methods to the underlying provider
  public getProvider() {
    return this.provider.getProvider()
  }
  
  public setCurrentNote(noteId: string) {
    if ('setCurrentNote' in this.provider) {
      this.provider.setCurrentNote(noteId)
    }
  }
  
  public getBranchesMap() {
    if ('getBranchesMap' in this.provider) {
      return this.provider.getBranchesMap()
    }
    return new Map()
  }
  
  public addBranch(parentId: string, branchId: string, branchData: any) {
    if ('addBranch' in this.provider) {
      this.provider.addBranch(parentId, branchId, branchData)
    }
  }
  
  public getBranches(panelId: string) {
    if ('getBranches' in this.provider) {
      return this.provider.getBranches(panelId)
    }
    return []
  }
  
  public initializeDefaultData(noteId: string, data: any) {
    if ('initializeDefaultData' in this.provider) {
      this.provider.initializeDefaultData(noteId, data)
    } else if ('initializeNote' in this.provider) {
      ;(this.provider as EnhancedCollaborationProvider).initializeNote(noteId, data)
    }
  }
  
  // Get the underlying provider type
  public getProviderType(): 'standard' | 'enhanced' {
    return this.provider instanceof EnhancedCollaborationProvider ? 'enhanced' : 'standard'
  }
  
  // Enable enhanced provider at runtime
  public static enableEnhancedProvider() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('use-enhanced-provider', 'true')
      window.location.reload()
    }
  }
  
  // Disable enhanced provider at runtime
  public static disableEnhancedProvider() {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('use-enhanced-provider')
      window.location.reload()
    }
  }
}

// Export helper to check current provider
export function getCurrentProviderType(): 'standard' | 'enhanced' {
  return UnifiedProvider.getInstance().getProviderType()
}

// Export helper to toggle provider
export function toggleProvider() {
  const current = getCurrentProviderType()
  if (current === 'standard') {
    UnifiedProvider.enableEnhancedProvider()
  } else {
    UnifiedProvider.disableEnhancedProvider()
  }
}

// Get plain provider instance (for Option A mode)
export function getPlainProvider(): PlainOfflineProvider | null {
  if (COLLAB_MODE !== 'plain') {
    return null
  }
  
  if (!plainProviderInstance) {
    // Initialize plain provider with appropriate adapter
    // This will be connected to the actual adapter in the app initialization
    console.warn('[getPlainProvider] Plain provider not initialized yet')
  }
  
  return plainProviderInstance
}

// Initialize plain provider with adapter
export function initializePlainProvider(adapter: any): void {
  if (COLLAB_MODE === 'plain' && !plainProviderInstance) {
    plainProviderInstance = new PlainOfflineProvider(adapter)
    console.log('[initializePlainProvider] Plain provider initialized')
  }
} 