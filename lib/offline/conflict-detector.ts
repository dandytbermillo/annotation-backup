/**
 * Conflict Detection Integration
 * 
 * Intercepts 409 responses and manages conflict resolution flow
 * Part of Phase 3 - Conflict Resolution UI
 */

import { getFeatureFlag } from './feature-flags';
import { telemetry } from './telemetry';
import { calculateHash } from './prosemirror-diff-merge';

export interface ConflictEnvelope {
  noteId: string;
  panelId: string;
  baseVersion: string;
  baseHash: string;
  currentVersion: string;
  currentHash: string;
  userContent: any;
  serverContent?: any;
  baseContent?: any;
  timestamp: number;
}

export interface ConflictResolution {
  action: 'keep-mine' | 'use-latest' | 'merge' | 'force';
  resolvedContent: any;
  newVersion: string;
  newHash: string;
}

class ConflictDetectorService {
  private activeConflicts = new Map<string, ConflictEnvelope>();
  private resolutionCallbacks = new Map<string, (resolution: ConflictResolution) => void>();
  private conflictListeners: ((conflict: ConflictEnvelope) => void)[] = [];

  /**
   * Intercept and handle 409 responses
   */
  async interceptResponse(
    response: Response,
    request: Request,
    requestBody: any
  ): Promise<Response> {
    // Only handle if conflict UI feature is enabled
    if (!getFeatureFlag('offline.conflictUI')) {
      return response;
    }

    if (response.status === 409) {
      try {
        const errorData = await response.json();
        const url = new URL(request.url);
        const pathParts = url.pathname.split('/');
        
        // Extract noteId and panelId from URL
        let noteId = '';
        let panelId = '';
        
        if (url.pathname.includes('/versions/')) {
          // /api/versions/[noteId]/[panelId]
          const versionIndex = pathParts.indexOf('versions');
          noteId = pathParts[versionIndex + 1];
          panelId = pathParts[versionIndex + 2];
        } else if (url.pathname.includes('/documents/')) {
          // /api/postgres-offline/documents/[id]
          const docId = pathParts[pathParts.length - 1];
          // Parse composite ID if needed
          [noteId, panelId] = docId.split('-');
        }

        // Create conflict envelope
        const conflict: ConflictEnvelope = {
          noteId,
          panelId,
          baseVersion: requestBody.base_version || '',
          baseHash: requestBody.base_hash || calculateHash(requestBody.content || {}),
          currentVersion: errorData.current_version || '',
          currentHash: errorData.current_hash || '',
          userContent: requestBody.content || requestBody,
          timestamp: Date.now()
        };

        // Fetch current and base versions
        await this.fetchVersionData(conflict);

        // Store conflict
        const conflictKey = `${noteId}-${panelId}`;
        this.activeConflicts.set(conflictKey, conflict);

        // Track in telemetry
        telemetry.trackConflict('detected', {
          noteId,
          panelId,
          baseVersion: conflict.baseVersion,
          currentVersion: conflict.currentVersion
        });

        // Notify listeners (UI will handle)
        this.notifyConflictListeners(conflict);

        // Return original response for now
        // UI will handle resolution
        return response;
      } catch (error) {
        console.error('Failed to process conflict:', error);
        telemetry.trackError('conflict-detection', error as Error);
        return response;
      }
    }

    return response;
  }

  /**
   * Fetch version data from server
   */
  private async fetchVersionData(conflict: ConflictEnvelope): Promise<void> {
    try {
      // Fetch current version from server
      const currentResponse = await fetch(
        `/api/versions/${conflict.noteId}/${conflict.panelId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (currentResponse.ok) {
        const currentData = await currentResponse.json();
        conflict.serverContent = currentData.content;
        conflict.currentVersion = currentData.version || conflict.currentVersion;
        conflict.currentHash = currentData.hash || calculateHash(currentData.content);
      }

      // Fetch base version for three-way merge
      if (conflict.baseVersion) {
        const compareResponse = await fetch('/api/versions/compare', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            noteId: conflict.noteId,
            panelId: conflict.panelId,
            version1: conflict.baseVersion,
            version2: conflict.currentVersion
          })
        });

        if (compareResponse.ok) {
          const compareData = await compareResponse.json();
          conflict.baseContent = compareData.version1Content;
        }
      }
    } catch (error) {
      console.error('Failed to fetch version data:', error);
      telemetry.trackError('version-fetch', error as Error);
    }
  }

  /**
   * Register a conflict listener
   */
  onConflict(callback: (conflict: ConflictEnvelope) => void): () => void {
    this.conflictListeners.push(callback);
    
    // Return unsubscribe function
    return () => {
      const index = this.conflictListeners.indexOf(callback);
      if (index > -1) {
        this.conflictListeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all conflict listeners
   */
  private notifyConflictListeners(conflict: ConflictEnvelope): void {
    this.conflictListeners.forEach(listener => {
      try {
        listener(conflict);
      } catch (error) {
        console.error('Conflict listener error:', error);
      }
    });
  }

  /**
   * Get active conflict for a document
   */
  getActiveConflict(noteId: string, panelId: string): ConflictEnvelope | undefined {
    return this.activeConflicts.get(`${noteId}-${panelId}`);
  }

  /**
   * Resolve a conflict
   */
  async resolveConflict(
    noteId: string,
    panelId: string,
    resolution: ConflictResolution
  ): Promise<boolean> {
    const conflictKey = `${noteId}-${panelId}`;
    const conflict = this.activeConflicts.get(conflictKey);
    
    if (!conflict) {
      console.warn('No active conflict found for:', conflictKey);
      return false;
    }

    try {
      // Track resolution in telemetry
      telemetry.trackConflict('resolved', {
        noteId,
        panelId,
        action: resolution.action,
        success: true
      });

      // Prepare save request based on action
      let saveBody: any = {
        content: resolution.resolvedContent,
        version: resolution.newVersion,
        hash: resolution.newHash,
        base_version: conflict.currentVersion,
        base_hash: conflict.currentHash
      };

      // Add force flag if needed
      if (resolution.action === 'force') {
        saveBody.force = true;
      }

      // Attempt to save
      const saveResponse = await fetch(
        `/api/versions/${noteId}/${panelId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(saveBody)
        }
      );

      if (saveResponse.ok) {
        // Clear conflict
        this.activeConflicts.delete(conflictKey);
        
        // Call resolution callback if any
        const callback = this.resolutionCallbacks.get(conflictKey);
        if (callback) {
          callback(resolution);
          this.resolutionCallbacks.delete(conflictKey);
        }

        return true;
      } else if (saveResponse.status === 409) {
        // Another conflict occurred
        console.warn('New conflict detected during resolution');
        // Re-trigger conflict detection
        await this.interceptResponse(saveResponse, new Request(''), saveBody);
        return false;
      } else {
        throw new Error(`Save failed with status: ${saveResponse.status}`);
      }
    } catch (error) {
      console.error('Failed to resolve conflict:', error);
      telemetry.trackError('conflict-resolution', error as Error);
      telemetry.trackConflict('resolved', {
        noteId,
        panelId,
        action: resolution.action,
        success: false
      });
      return false;
    }
  }

  /**
   * Register a resolution callback
   */
  onResolution(
    noteId: string,
    panelId: string,
    callback: (resolution: ConflictResolution) => void
  ): void {
    const key = `${noteId}-${panelId}`;
    this.resolutionCallbacks.set(key, callback);
  }

  /**
   * Clear a conflict without resolving
   */
  clearConflict(noteId: string, panelId: string): void {
    const key = `${noteId}-${panelId}`;
    this.activeConflicts.delete(key);
    this.resolutionCallbacks.delete(key);
  }

  /**
   * Get conflict statistics
   */
  getConflictStats(): {
    activeCount: number;
    conflicts: Array<{ noteId: string; panelId: string; timestamp: number }>;
  } {
    const conflicts = Array.from(this.activeConflicts.entries()).map(([key, conflict]) => ({
      noteId: conflict.noteId,
      panelId: conflict.panelId,
      timestamp: conflict.timestamp
    }));

    return {
      activeCount: this.activeConflicts.size,
      conflicts
    };
  }
}

// Export singleton instance
export const conflictDetector = new ConflictDetectorService();

/**
 * Wrap fetch to intercept 409 responses
 */
export function wrapFetchForConflicts(originalFetch: typeof fetch): typeof fetch {
  return async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    // Clone request body if present
    let requestBody: any = null;
    if (init?.body) {
      try {
        if (typeof init.body === 'string') {
          requestBody = JSON.parse(init.body);
        } else if (init.body instanceof FormData) {
          // Handle FormData if needed
          requestBody = Object.fromEntries(init.body);
        }
      } catch (e) {
        // Body is not JSON
      }
    }

    // Call original fetch
    const response = await originalFetch(input, init);
    
    // Create Request object for interceptor
    const request = new Request(input.toString(), init);
    
    // Intercept response
    return conflictDetector.interceptResponse(response, request, requestBody);
  };
}

// Auto-wrap fetch if feature flag is enabled
if (typeof window !== 'undefined' && getFeatureFlag('offline.conflictUI')) {
  const originalFetch = window.fetch;
  window.fetch = wrapFetchForConflicts(originalFetch);
}