// Provider Switcher - Allows switching between Yjs collaboration and plain offline mode
// This fixes the awareness.getStates error while enabling enhanced features

import { PlainOfflineProvider } from './providers/plain-offline-provider'
import { getCollabMode, ensureFailClosed, warnIfYjsLoadAttempted } from './collab-mode'

// Lazy loading of Yjs providers to avoid loading them in plain mode
let CollaborationProvider: any = null
let EnhancedCollaborationProvider: any = null
let patchApplied = false

// Feature flags for provider selection
const USE_ENHANCED_PROVIDER = process.env.NEXT_PUBLIC_USE_ENHANCED_PROVIDER === 'true' || 
                              typeof window !== 'undefined' && window.localStorage?.getItem('use-enhanced-provider') === 'true'

// Singleton instance for plain provider
let plainProviderInstance: PlainOfflineProvider | null = null

// Function to apply patch to CollaborationProvider when loaded
function applyCollaborationProviderPatch() {
  if (!CollaborationProvider || !CollaborationProvider.prototype) return
  
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
}

// Unified interface that switches between providers
export class UnifiedProvider {
  private static instance: UnifiedProvider
  private provider: any = null
  
  private constructor() {
    // Establish fail-closed plain behavior and set lock as needed
    ensureFailClosed()
    const mode = getCollabMode()

    // Check if we're in plain mode (fail-closed path)
    if (mode === 'plain') {
      console.log('📝 Using Plain Mode (no collaboration) — Yjs disabled')
      // Never initialize Yjs providers in plain mode
      this.provider = null
    } else if (USE_ENHANCED_PROVIDER) {
      // Defensive: if somehow reached while plain, warn and refuse
      if (getCollabMode() === 'plain') {
        warnIfYjsLoadAttempted('UnifiedProvider → enhanced yjs-provider')
        this.provider = null
        return
      }
      console.log('🚀 Using Enhanced YJS Provider with all advanced features')
      // Dynamically import and initialize enhanced provider
      const { EnhancedCollaborationProvider: EnhancedProvider } = require('./enhanced-yjs-provider')
      const { applyEnhancedProviderPatch } = require('./enhanced-yjs-provider-patch')
      
      // Apply patch if not already applied
      if (!patchApplied) {
        applyEnhancedProviderPatch()
        patchApplied = true
      }
      
      EnhancedCollaborationProvider = EnhancedProvider
      this.provider = EnhancedCollaborationProvider.getInstance()
    } else {
      console.log('Using standard YJS Provider (with getStates fix)')
      // Dynamically import and initialize standard provider
      // Defensive: if somehow reached while plain, warn and refuse
      if (getCollabMode() === 'plain') {
        warnIfYjsLoadAttempted('UnifiedProvider → standard yjs-provider')
        this.provider = null
        return
      }
      const { CollaborationProvider: StandardProvider } = require('./yjs-provider')
      CollaborationProvider = StandardProvider
      
      // Apply patch
      applyCollaborationProviderPatch()
      
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
    if (!this.provider) {
      // Return a minimal object for plain mode
      return {
        awareness: {
          getStates: () => new Map(),
          clientID: 1,
          meta: new Map()
        }
      }
    }
    return this.provider.getProvider()
  }
  
  public setCurrentNote(noteId: string) {
    if (this.provider && 'setCurrentNote' in this.provider) {
      this.provider.setCurrentNote(noteId)
    }
  }
  
  public getBranchesMap() {
    if (this.provider && 'getBranchesMap' in this.provider) {
      return this.provider.getBranchesMap()
    }
    return new Map()
  }
  
  public addBranch(parentId: string, branchId: string, branchData: any) {
    if (this.provider && 'addBranch' in this.provider) {
      this.provider.addBranch(parentId, branchId, branchData)
    }
  }
  
  public getBranches(panelId: string) {
    if (this.provider && 'getBranches' in this.provider) {
      return this.provider.getBranches(panelId)
    }
    return []
  }
  
  public getDocumentStructure() {
    if (this.provider && 'getDocumentStructure' in this.provider) {
      return this.provider.getDocumentStructure()
    }
    return null
  }
  
  public initializeDefaultData(noteId: string, data: any) {
    if (!this.provider) return
    
    if ('initializeDefaultData' in this.provider) {
      this.provider.initializeDefaultData(noteId, data)
    } else if ('initializeNote' in this.provider) {
      this.provider.initializeNote(noteId, data)
    }
  }
  
  // Get the underlying provider type
  public getProviderType(): 'standard' | 'enhanced' | 'plain' {
    if (!this.provider) return 'plain'
    // Check by constructor name since we're dynamically loading
    return this.provider.constructor.name === 'EnhancedCollaborationProvider' ? 'enhanced' : 'standard'
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
export function getCurrentProviderType(): 'standard' | 'enhanced' | 'plain' {
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
  const mode = getCollabMode()
  console.log('[getPlainProvider] Called. mode:', mode, 'Instance:', plainProviderInstance)
  if (mode !== 'plain') {
    console.log('[getPlainProvider] Not in plain mode, returning null')
    return null
  }
  
  if (!plainProviderInstance) {
    // Initialize plain provider with appropriate adapter
    // This will be connected to the actual adapter in the app initialization
    console.warn('[getPlainProvider] ⚠️ Plain provider not initialized yet')
  } else {
    console.log('[getPlainProvider] ✅ Returning plain provider instance')
  }
  
  return plainProviderInstance
}

// Initialize plain provider with adapter
export function initializePlainProvider(adapter: any): void {
  if (getCollabMode() === 'plain' && !plainProviderInstance) {
    plainProviderInstance = new PlainOfflineProvider(adapter)
    console.log('[initializePlainProvider] Plain provider initialized')
  }
}
