'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  ConflictEnvelope, 
  ConflictResolution,
  conflictDetector 
} from '@/lib/offline/conflict-detector';
import {
  diffProseMirrorText,
  mergeProseMirrorDocs,
  extractPreview,
  calculateHash,
  ProseMirrorDoc
} from '@/lib/offline/prosemirror-diff-merge';
import { telemetry } from '@/lib/offline/telemetry';
import { AlertTriangle, CheckCircle, GitBranch, Save, HelpCircle, Info } from 'lucide-react';

interface ConflictResolutionDialogProps {
  onResolved?: (resolution: ConflictResolution) => void;
  testMode?: boolean; // Add test mode prop
}

export function ConflictResolutionDialog({ onResolved, testMode = false }: ConflictResolutionDialogProps) {
  const [conflict, setConflict] = useState<ConflictEnvelope | null>(null);
  const [selectedAction, setSelectedAction] = useState<'mine' | 'theirs' | 'merge' | null>(null);
  const [mergeResult, setMergeResult] = useState<any>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForceWarning, setShowForceWarning] = useState(false);
  const [diffView, setDiffView] = useState<'unified' | 'split'>('unified');
  const [showHelp, setShowHelp] = useState(true);
  const [lastResolution, setLastResolution] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to conflict events
    const unsubscribe = conflictDetector.onConflict((newConflict) => {
      setConflict(newConflict);
      setSelectedAction(null);
      setMergeResult(null);
      setError(null);
      setShowForceWarning(false);
    });

    return unsubscribe;
  }, []);

  const handleMerge = () => {
    if (!conflict || !conflict.baseContent || !conflict.serverContent) {
      setError('Cannot merge: missing version data');
      return;
    }

    const result = mergeProseMirrorDocs(
      conflict.baseContent as ProseMirrorDoc,
      conflict.userContent as ProseMirrorDoc,
      conflict.serverContent as ProseMirrorDoc,
      { preferMineOnConflict: false }
    );

    if (result.success) {
      setMergeResult(result.merged);
      setSelectedAction('merge');
      setError(null);
    } else if (result.conflicts && result.conflicts.length > 0) {
      setMergeResult(result.merged);
      setSelectedAction('merge');
      setError(`Merge has ${result.conflicts.length} conflict(s). Review carefully.`);
    } else {
      setError('Merge failed. Please choose another option.');
    }
  };

  const handleResolve = async (forceResolve: boolean = false) => {
    if (!conflict || (!selectedAction && !forceResolve)) return;

    setIsResolving(true);
    setError(null);

    try {
      let resolvedContent: any;
      let action: ConflictResolution['action'];

      if (forceResolve) {
        action = 'force';
        resolvedContent = conflict.userContent;
      } else {
        switch (selectedAction) {
          case 'mine':
            action = 'keep-mine';
            resolvedContent = conflict.userContent;
            break;
          case 'theirs':
            action = 'use-latest';
            resolvedContent = conflict.serverContent;
            break;
          case 'merge':
            action = 'merge';
            resolvedContent = mergeResult || conflict.userContent;
            break;
          default:
            throw new Error('No action selected');
        }
      }

      const resolution: ConflictResolution = {
        action,
        resolvedContent,
        newVersion: `v${Date.now()}`,
        newHash: calculateHash(resolvedContent)
      };

      const success = await conflictDetector.resolveConflict(
        conflict.noteId,
        conflict.panelId,
        resolution
      );

      if (success || testMode) {
        // In test mode, don't close the dialog
        if (testMode) {
          setLastResolution(`Resolution simulated: ${action}`);
          setSelectedAction(null);
          setMergeResult(null);
          setShowForceWarning(false);
          setError(null);
          // Show success message
          telemetry.trackConflict('resolved-test', {
            action,
            noteId: conflict.noteId,
            panelId: conflict.panelId
          });
        } else {
          setConflict(null);
        }
        
        if (onResolved) {
          onResolved(resolution);
        }
      } else {
        setError('Failed to save resolution. A new conflict may have occurred.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resolution failed');
      // Track error as a conflict event
      telemetry.trackConflict('resolution-error', {
        error: err instanceof Error ? err.message : 'Unknown error',
        noteId: conflict?.noteId,
        panelId: conflict?.panelId
      });
    } finally {
      setIsResolving(false);
    }
  };

  const getDiffDisplay = () => {
    if (!conflict || !conflict.baseContent || !conflict.serverContent) {
      return { added: [], removed: [], unchanged: [], conflicted: [] };
    }

    return diffProseMirrorText(
      conflict.baseContent as ProseMirrorDoc,
      conflict.userContent as ProseMirrorDoc,
      conflict.serverContent as ProseMirrorDoc
    );
  };

  if (!conflict) {
    return null;
  }

  const diff = getDiffDisplay();
  const userPreview = extractPreview(conflict.userContent as ProseMirrorDoc);
  const serverPreview = conflict.serverContent 
    ? extractPreview(conflict.serverContent as ProseMirrorDoc)
    : 'Loading...';

  return (
    <Dialog open={!!conflict} onOpenChange={(open) => !open && setConflict(null)}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-orange-500" />
            Version Conflict Detected
          </DialogTitle>
          <DialogDescription>
            The document has been modified by another source. Choose how to resolve this conflict.
          </DialogDescription>
        </DialogHeader>

        {/* Test Mode Indicator */}
        {testMode && (
          <Alert className="mb-4 bg-purple-50 border-purple-200">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <div className="font-semibold text-purple-800">🧪 Test Mode Active</div>
              <p className="text-xs mt-1">Dialog will stay open after resolution for testing all options.</p>
              {lastResolution && (
                <p className="text-xs mt-2 text-green-700 font-semibold">
                  ✅ Last action: {lastResolution}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Help Section */}
        {showHelp && (
          <Alert className="mb-4 bg-blue-50 border-blue-200">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm space-y-2">
              <div className="font-semibold">How to resolve this conflict:</div>
              <ol className="list-decimal list-inside space-y-1 text-xs">
                <li><strong>Compare Versions tab:</strong> View your changes vs server changes side-by-side</li>
                <li><strong>View Changes tab:</strong> See a detailed diff of what changed</li>
                <li><strong>Preview Result tab:</strong> Preview the final document after resolution</li>
                <li>Choose an action: Keep Mine, Use Latest, Auto-Merge, or Force Save</li>
                <li>Click "Save Resolution" to apply your choice</li>
              </ol>
              <button 
                className="text-xs underline text-blue-600" 
                onClick={() => setShowHelp(false)}
              >
                Hide instructions
              </button>
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="compare" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="compare" title="Shows both versions side-by-side for comparison">
              Compare Versions
            </TabsTrigger>
            <TabsTrigger value="diff" title="Shows what was added, removed, or changed">
              View Changes
            </TabsTrigger>
            <TabsTrigger value="preview" title="Shows what the document will look like after resolution">
              Preview Result
            </TabsTrigger>
          </TabsList>

          <TabsContent value="compare" className="flex-1 overflow-auto">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    Your Version
                    <span className="text-xs text-gray-500">(Local changes)</span>
                  </h3>
                  <Button
                    size="sm"
                    variant={selectedAction === 'mine' ? 'default' : 'outline'}
                    onClick={() => setSelectedAction('mine')}
                    title="Keep your version and discard server changes"
                  >
                    Keep Mine
                  </Button>
                </div>
                <div className="border rounded-lg p-4 bg-blue-50 max-h-64 overflow-auto">
                  <pre className="text-sm whitespace-pre-wrap">{userPreview}</pre>
                </div>
                <p className="text-xs text-gray-500">
                  Version: {conflict.baseVersion || 'unknown'}
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    Server Version
                    <span className="text-xs text-gray-500">(Latest from server)</span>
                  </h3>
                  <Button
                    size="sm"
                    variant={selectedAction === 'theirs' ? 'default' : 'outline'}
                    onClick={() => setSelectedAction('theirs')}
                    title="Accept server version and discard your local changes"
                  >
                    Use Latest
                  </Button>
                </div>
                <div className="border rounded-lg p-4 bg-green-50 max-h-64 overflow-auto">
                  <pre className="text-sm whitespace-pre-wrap">{serverPreview}</pre>
                </div>
                <p className="text-xs text-gray-500">
                  Version: {conflict.currentVersion || 'unknown'}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col items-center gap-2">
              <Button
                variant="outline"
                onClick={handleMerge}
                disabled={!conflict.baseContent || !conflict.serverContent}
                title="Try to automatically merge both versions (may have conflicts)"
              >
                <GitBranch className="mr-2 h-4 w-4" />
                Attempt Auto-Merge
              </Button>
              <p className="text-xs text-gray-500">
                Automatically combines changes from both versions when possible
              </p>
            </div>
          </TabsContent>

          <TabsContent value="diff" className="flex-1 overflow-auto">
            <div className="space-y-4">
              {diff.added.length > 0 && (
                <div>
                  <h4 className="font-semibold text-green-600 mb-2">Added</h4>
                  <div className="bg-green-50 border-l-4 border-green-400 p-3">
                    {diff.added.map((text, i) => (
                      <pre key={i} className="text-sm whitespace-pre-wrap">{text}</pre>
                    ))}
                  </div>
                </div>
              )}

              {diff.removed.length > 0 && (
                <div>
                  <h4 className="font-semibold text-red-600 mb-2">Removed</h4>
                  <div className="bg-red-50 border-l-4 border-red-400 p-3">
                    {diff.removed.map((text, i) => (
                      <pre key={i} className="text-sm whitespace-pre-wrap">{text}</pre>
                    ))}
                  </div>
                </div>
              )}

              {diff.conflicted.length > 0 && (
                <div>
                  <h4 className="font-semibold text-orange-600 mb-2">Conflicts</h4>
                  <div className="bg-orange-50 border-l-4 border-orange-400 p-3">
                    {diff.conflicted.map((text, i) => (
                      <pre key={i} className="text-sm whitespace-pre-wrap">{text}</pre>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-auto">
            {selectedAction ? (
              <div className="space-y-4">
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Preview of {selectedAction === 'mine' ? 'your version' : 
                             selectedAction === 'theirs' ? 'server version' : 
                             'merged version'}
                  </AlertDescription>
                </Alert>
                
                <div className="border rounded-lg p-4 bg-gray-50 max-h-96 overflow-auto">
                  <pre className="text-sm whitespace-pre-wrap">
                    {selectedAction === 'mine' ? userPreview :
                     selectedAction === 'theirs' ? serverPreview :
                     mergeResult ? extractPreview(mergeResult) : 'No preview available'}
                  </pre>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Select an action to preview the result
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>
        </Tabs>

        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {showForceWarning && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Warning:</strong> Force saving will overwrite the server version and may cause data loss for other users.
              Are you sure you want to continue?
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter className="flex flex-col gap-2">
          {/* Action guide */}
          <div className="text-xs text-gray-500 w-full mb-2">
            {!selectedAction && !showForceWarning && (
              <p className="flex items-center gap-1">
                <HelpCircle className="h-3 w-3" />
                Select an action above (Keep Mine, Use Latest, or Auto-Merge) then click Save Resolution
              </p>
            )}
            {selectedAction && (
              <p className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" />
                Ready to save: You selected "{selectedAction === 'mine' ? 'Keep Mine' : selectedAction === 'theirs' ? 'Use Latest' : 'Auto-Merge'}"
              </p>
            )}
          </div>
          
          <div className="flex justify-between w-full">
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => setShowForceWarning(true)}
                disabled={isResolving || showForceWarning}
                title="Override server version (requires confirmation)"
              >
                Force Save
              </Button>
              {showForceWarning && (
                <Button
                  variant="destructive"
                  onClick={() => handleResolve(true)}
                  disabled={isResolving}
                  title="Confirm overriding server version"
                >
                  Confirm Force Save
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              {testMode && selectedAction && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSelectedAction(null);
                    setMergeResult(null);
                    setShowForceWarning(false);
                    setError(null);
                  }}
                  disabled={isResolving}
                  title="Clear current selection"
                >
                  Reset
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setConflict(null);
                  setLastResolution(null);
                }}
                disabled={isResolving}
                title="Close dialog without saving"
              >
                Cancel
              </Button>
              <Button
                onClick={() => handleResolve()}
                disabled={!selectedAction || isResolving}
                title={selectedAction ? "Save your chosen resolution" : "Select an action first"}
              >
                <Save className="mr-2 h-4 w-4" />
                {isResolving ? 'Saving...' : testMode ? 'Test Resolution' : 'Save Resolution'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}