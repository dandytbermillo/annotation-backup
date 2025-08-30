import crypto from 'crypto'

export interface ConflictInfo {
  type: 'version_mismatch' | 'content_drift' | 'deleted_remotely' | 'concurrent_edit'
  severity: 'minor' | 'major' | 'critical'
  localVersion?: number
  remoteVersion?: number
  localHash?: string
  remoteHash?: string
  localContent?: any
  remoteContent?: any
  suggestion: 'use_local' | 'use_remote' | 'merge' | 'manual'
  message: string
  canAutoResolve: boolean
}

export interface ConflictDetectionOptions {
  baseVersion?: number
  baseHash?: string
  localContent: any
  noteId: string
  panelId: string
}

export interface ConflictResolution {
  strategy: 'local' | 'remote' | 'merge' | 'manual'
  mergedContent?: any
  version?: number
  hash?: string
}

export class ConflictDetector {
  private static instance: ConflictDetector
  
  static getInstance(): ConflictDetector {
    if (!ConflictDetector.instance) {
      ConflictDetector.instance = new ConflictDetector()
    }
    return ConflictDetector.instance
  }
  
  /**
   * Calculate SHA-256 hash of content
   */
  calculateHash(content: any): string {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex')
  }
  
  /**
   * Detect conflicts by comparing with remote version
   */
  async detectConflict(options: ConflictDetectionOptions): Promise<ConflictInfo | null> {
    const { baseVersion, baseHash, localContent, noteId, panelId } = options
    
    try {
      // Fetch current remote version
      const response = await fetch(`/api/versions/${noteId}/${panelId}`)
      
      if (!response.ok) {
        if (response.status === 404) {
          // Document doesn't exist remotely - no conflict
          return null
        }
        throw new Error('Failed to fetch remote version')
      }
      
      const data = await response.json()
      const remoteVersion = data.current
      
      // No remote version - new document
      if (!remoteVersion) {
        return null
      }
      
      // Calculate local hash
      const localHash = this.calculateHash(localContent)
      
      // Case 1: Version mismatch
      if (baseVersion !== undefined && remoteVersion.version !== baseVersion) {
        return {
          type: 'version_mismatch',
          severity: this.calculateSeverity(baseVersion, remoteVersion.version),
          localVersion: baseVersion,
          remoteVersion: remoteVersion.version,
          localHash,
          remoteHash: remoteVersion.hash,
          localContent,
          suggestion: this.suggestResolution(baseVersion, remoteVersion.version),
          message: `Document has been modified. Your version: ${baseVersion}, Current version: ${remoteVersion.version}`,
          canAutoResolve: false
        }
      }
      
      // Case 2: Content drift (hash mismatch with same version)
      if (baseHash && remoteVersion.hash !== baseHash) {
        return {
          type: 'content_drift',
          severity: 'major',
          localVersion: baseVersion,
          remoteVersion: remoteVersion.version,
          localHash,
          remoteHash: remoteVersion.hash,
          localContent,
          message: 'Content has drifted from the expected state',
          suggestion: 'use_remote',
          canAutoResolve: false
        }
      }
      
      // No conflict detected
      return null
    } catch (error) {
      console.error('Conflict detection failed:', error)
      // On error, return a cautious conflict warning
      return {
        type: 'concurrent_edit',
        severity: 'minor',
        localContent,
        message: 'Unable to verify document state. Proceed with caution.',
        suggestion: 'manual',
        canAutoResolve: false
      }
    }
  }
  
  /**
   * Calculate conflict severity based on version difference
   */
  private calculateSeverity(localVersion: number, remoteVersion: number): 'minor' | 'major' | 'critical' {
    const versionDiff = Math.abs(remoteVersion - localVersion)
    
    if (versionDiff === 1) return 'minor'
    if (versionDiff <= 3) return 'major'
    return 'critical'
  }
  
  /**
   * Suggest resolution strategy based on conflict type
   */
  private suggestResolution(localVersion: number, remoteVersion: number): 'use_local' | 'use_remote' | 'merge' | 'manual' {
    const versionDiff = remoteVersion - localVersion
    
    // If local is ahead, suggest keeping local
    if (versionDiff < 0) return 'use_local'
    
    // If only 1 version behind, suggest merge
    if (versionDiff === 1) return 'merge'
    
    // If far behind, suggest using remote
    if (versionDiff > 3) return 'use_remote'
    
    // Otherwise, manual resolution
    return 'manual'
  }
  
  /**
   * Attempt to merge content automatically
   */
  async mergeContent(
    localContent: any,
    remoteContent: any,
    conflictType: ConflictInfo['type']
  ): Promise<ConflictResolution | null> {
    // For ProseMirror content, we need careful merging
    if (this.isProseMirrorContent(localContent) && this.isProseMirrorContent(remoteContent)) {
      return this.mergeProseMirrorContent(localContent, remoteContent, conflictType)
    }
    
    // For simple text content
    if (typeof localContent === 'string' && typeof remoteContent === 'string') {
      return this.mergeTextContent(localContent, remoteContent)
    }
    
    // Cannot auto-merge
    return null
  }
  
  /**
   * Check if content is ProseMirror JSON
   */
  private isProseMirrorContent(content: any): boolean {
    return content && 
           typeof content === 'object' && 
           'type' in content && 
           ('content' in content || 'text' in content)
  }
  
  /**
   * Merge ProseMirror content
   */
  private mergeProseMirrorContent(
    localContent: any,
    remoteContent: any,
    conflictType: ConflictInfo['type']
  ): ConflictResolution {
    // For minor conflicts, prefer local changes
    if (conflictType === 'version_mismatch') {
      // Simple strategy: keep local content but update version
      return {
        strategy: 'merge',
        mergedContent: localContent,
        hash: this.calculateHash(localContent)
      }
    }
    
    // For content drift, prefer remote
    if (conflictType === 'content_drift') {
      return {
        strategy: 'remote',
        mergedContent: remoteContent,
        hash: this.calculateHash(remoteContent)
      }
    }
    
    // Default to manual resolution for complex cases
    return {
      strategy: 'manual'
    }
  }
  
  /**
   * Merge text content using simple line-based merging
   */
  private mergeTextContent(localText: string, remoteText: string): ConflictResolution {
    const localLines = localText.split('\n')
    const remoteLines = remoteText.split('\n')
    
    // Simple merge: if they're mostly the same, keep local
    const similarity = this.calculateSimilarity(localText, remoteText)
    
    if (similarity > 0.8) {
      return {
        strategy: 'merge',
        mergedContent: localText,
        hash: this.calculateHash(localText)
      }
    }
    
    // Too different, need manual resolution
    return {
      strategy: 'manual'
    }
  }
  
  /**
   * Calculate similarity between two strings (0-1)
   */
  calculateSimilarity(s1: string, s2: string): number {
    if (s1 === s2) return 1.0
    
    const longer = s1.length > s2.length ? s1 : s2
    const shorter = s1.length > s2.length ? s2 : s1
    
    if (longer.length === 0) return 1.0
    
    const distance = this.levenshteinDistance(longer, shorter)
    return (longer.length - distance) / longer.length
  }
  
  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(s1: string, s2: string): number {
    const matrix: number[][] = []
    
    // Initialize matrix
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i]
    }
    
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j
    }
    
    // Calculate distances
    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          )
        }
      }
    }
    
    return matrix[s2.length][s1.length]
  }
  
  /**
   * Resolve a conflict with a specific strategy
   */
  async resolveConflict(
    conflict: ConflictInfo,
    resolution: 'local' | 'remote' | 'merge' | 'force',
    noteId: string,
    panelId: string
  ): Promise<{ success: boolean; version?: number; error?: string }> {
    try {
      let contentToSave = conflict.localContent
      let force = false
      
      switch (resolution) {
        case 'remote':
          // Fetch and use remote content
          const response = await fetch(`/api/versions/${noteId}/${panelId}?version=${conflict.remoteVersion}`)
          if (!response.ok) throw new Error('Failed to fetch remote version')
          const data = await response.json()
          contentToSave = data.content
          break
          
        case 'merge':
          // Attempt automatic merge
          const merged = await this.mergeContent(
            conflict.localContent,
            conflict.remoteContent,
            conflict.type
          )
          if (!merged || merged.strategy === 'manual') {
            return { success: false, error: 'Automatic merge failed' }
          }
          contentToSave = merged.mergedContent
          break
          
        case 'force':
          // Force save local content
          force = true
          break
          
        case 'local':
        default:
          // Use local content
          break
      }
      
      // Save the resolved content
      const saveResponse = await fetch(`/api/versions/${noteId}/${panelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          content: contentToSave,
          base_version: conflict.remoteVersion,
          base_hash: conflict.remoteHash,
          force
        })
      })
      
      if (!saveResponse.ok) {
        const error = await saveResponse.json()
        return { success: false, error: error.message || 'Failed to save' }
      }
      
      const result = await saveResponse.json()
      return { success: true, version: result.version }
      
    } catch (error) {
      console.error('Conflict resolution failed:', error)
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Resolution failed' 
      }
    }
  }
}

// Export singleton instance
export const conflictDetector = ConflictDetector.getInstance()