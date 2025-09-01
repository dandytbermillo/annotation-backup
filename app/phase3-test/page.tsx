'use client';

import React, { useState, useEffect } from 'react';
import { ConflictResolutionDialog } from '@/components/offline/conflict-resolution-dialog';
import { conflictDetector, ConflictEnvelope } from '@/lib/offline/conflict-detector';
import { getFeatureFlag, setFeatureFlag } from '@/lib/offline/feature-flags';
import { calculateHash } from '@/lib/offline/prosemirror-diff-merge';

export default function Phase3TestPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [flagEnabled, setFlagEnabled] = useState(false);
  const [testDoc1, setTestDoc1] = useState<any>(null);
  const [testDoc2, setTestDoc2] = useState<any>(null);
  const [baseDoc, setBaseDoc] = useState<any>(null);
  const [conflictStats, setConflictStats] = useState<any>(null);

  useEffect(() => {
    // Check if feature flag is enabled
    const enabled = getFeatureFlag('offline.conflictUI');
    setFlagEnabled(enabled);
    addLog(`Phase 3 Test Page loaded. Flag: ${enabled ? 'ENABLED' : 'DISABLED'}`, 'info');
    
    // Initialize test documents
    initializeTestDocuments();
    
    // Update conflict stats periodically
    const interval = setInterval(() => {
      const stats = conflictDetector.getConflictStats();
      setConflictStats(stats);
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  const addLog = (message: string, type: string = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${type.toUpperCase()}: ${message}`]);
  };

  const initializeTestDocuments = () => {
    // Create test ProseMirror documents
    const base = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is the original document.' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'It has multiple paragraphs.' }
          ]
        }
      ]
    };

    const mine = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is my edited version of the document.' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'It has multiple paragraphs.' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'I added this new paragraph.' }
          ]
        }
      ]
    };

    const theirs = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'This is the original document.' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Someone else modified this paragraph differently.' }
          ]
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'They also added a different paragraph.' }
          ]
        }
      ]
    };

    setBaseDoc(base);
    setTestDoc1(mine);
    setTestDoc2(theirs);
    
    addLog('Test documents initialized', 'success');
  };

  const toggleFeatureFlag = () => {
    const newValue = !flagEnabled;
    setFeatureFlag('offline.conflictUI', newValue);
    setFlagEnabled(newValue);
    addLog(`Feature flag set to: ${newValue}`, newValue ? 'success' : 'warning');
    
    if (newValue) {
      addLog('Reload the page to activate conflict detection', 'info');
    }
  };

  const simulateConflict = async () => {
    if (!flagEnabled) {
      addLog('Feature flag must be enabled first', 'error');
      return;
    }

    addLog('Simulating 409 conflict...', 'info');

    try {
      // Create a mock conflict envelope
      const mockConflict: ConflictEnvelope = {
        noteId: 'test-note-1',
        panelId: 'test-panel-1',
        baseVersion: 'v1',
        baseHash: calculateHash(baseDoc),
        currentVersion: 'v2',
        currentHash: calculateHash(testDoc2),
        userContent: testDoc1,
        serverContent: testDoc2,
        baseContent: baseDoc,
        timestamp: Date.now()
      };

      // Directly trigger conflict UI
      const listeners = (conflictDetector as any).conflictListeners;
      if (listeners && listeners.length > 0) {
        listeners.forEach((listener: any) => listener(mockConflict));
        addLog('Conflict dialog triggered', 'success');
      } else {
        addLog('No conflict listeners registered. Dialog component may not be mounted.', 'warning');
      }
    } catch (error: any) {
      addLog(`Failed to simulate conflict: ${error.message}`, 'error');
    }
  };

  const testVersionAPI = async () => {
    addLog('Testing version API endpoints...', 'info');

    try {
      // Test GET /api/versions/[noteId]/[panelId]
      const getResponse = await fetch('/api/versions/test-note/test-panel');
      if (getResponse.ok) {
        const data = await getResponse.json();
        addLog(`GET /api/versions: ${data.versions ? data.versions.length : 0} versions found`, 'success');
        if (data.current?.hash) {
          addLog(`Current version hash: ${data.current.hash.substring(0, 8)}...`, 'info');
        }
      } else {
        addLog(`GET /api/versions failed: ${getResponse.status}`, 'warning');
      }

      // Test POST /api/versions/compare
      const compareResponse = await fetch('/api/versions/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: 'test-note',
          panelId: 'test-panel',
          version1: 0,
          version2: 1
        })
      });

      if (compareResponse.ok) {
        const data = await compareResponse.json();
        addLog('POST /api/versions/compare: Success', 'success');
        if (data.comparison?.version1?.hash && data.comparison?.version2?.hash) {
          addLog('Both version hashes included in response', 'success');
        }
        if (data.version1Content && data.version2Content) {
          addLog('Both version contents included in response', 'success');
        }
      } else {
        addLog(`POST /api/versions/compare failed: ${compareResponse.status}`, 'warning');
      }
    } catch (error: any) {
      addLog(`API test error: ${error.message}`, 'error');
    }
  };

  const createRealConflict = async () => {
    addLog('Creating real conflict scenario...', 'info');

    try {
      // First, save a document
      const saveResponse1 = await fetch('/api/versions/conflict-test/panel-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          content: baseDoc,
          version: 1
        })
      });

      if (!saveResponse1.ok) {
        throw new Error('Failed to save initial version');
      }
      addLog('Initial version saved', 'success');

      // Save a conflicting version
      const saveResponse2 = await fetch('/api/versions/conflict-test/panel-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          content: testDoc2,
          version: 2
        })
      });

      if (!saveResponse2.ok) {
        throw new Error('Failed to save server version');
      }
      addLog('Server version saved', 'success');

      // Try to save with outdated base version (should trigger 409)
      const conflictResponse = await fetch('/api/versions/conflict-test/panel-1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          content: testDoc1,
          base_version: 1,
          base_hash: calculateHash(baseDoc)
        })
      });

      if (conflictResponse.status === 409) {
        addLog('409 Conflict successfully triggered!', 'success');
        const errorData = await conflictResponse.json();
        addLog(`Conflict type: ${errorData.conflict_type}`, 'info');
        addLog(`Current version: ${errorData.current_version}`, 'info');
      } else {
        addLog(`Expected 409 but got ${conflictResponse.status}`, 'warning');
      }
    } catch (error: any) {
      addLog(`Failed to create conflict: ${error.message}`, 'error');
    }
  };

  const clearLogs = () => {
    setLogs([]);
    addLog('Logs cleared', 'info');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8 border-b-2 border-purple-600 pb-4">
          🔄 Phase 3 - Conflict Resolution UI Test
        </h1>

        {/* How to Use */}
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">📖 How to Use This Test Page</h2>
          
          <ol className="list-decimal list-inside space-y-2 mb-4">
            <li><strong>Enable Feature Flag:</strong> Click "Toggle Flag" to enable conflict UI</li>
            <li><strong>Reload Page:</strong> Refresh after enabling flag to activate conflict detection</li>
            <li><strong>Test Version API:</strong> Verify endpoints return hash metadata</li>
            <li><strong>Simulate Conflict:</strong> Trigger mock conflict dialog</li>
            <li><strong>Create Real Conflict:</strong> Generate actual 409 response</li>
            <li><strong>Resolve Conflict:</strong> Use dialog to choose resolution action</li>
          </ol>
        </div>

        {/* Conflict Dialog Guide */}
        <div className="bg-blue-50 border-2 border-blue-200 rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4 text-blue-900">🎯 Understanding the Conflict Dialog</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-blue-800 mb-2">📑 Dialog Tabs</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-700">Compare Versions:</span>
                    <span>Shows your changes and server changes side-by-side for easy comparison</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-700">View Changes:</span>
                    <span>Displays a diff view showing what was added, removed, or modified</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-700">Preview Result:</span>
                    <span>Shows what the document will look like after applying your chosen resolution</span>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-blue-800 mb-2">📝 Version Sections</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-700">Your Version (Left):</span>
                    <span>Shows your local changes with version number (e.g., v1)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-700">Server Version (Right):</span>
                    <span>Shows the latest server version with version number (e.g., v2)</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-blue-800 mb-2">🔧 Resolution Actions</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-green-700">Keep Mine:</span>
                    <span>Keeps your version, discards all server changes</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-green-700">Use Latest:</span>
                    <span>Accepts server version, discards all your local changes</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-green-700">Auto-Merge:</span>
                    <span>Attempts to combine both versions automatically (may have conflicts)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-red-700">Force Save:</span>
                    <span>Overrides server version completely (requires confirmation, use with caution)</span>
                  </li>
                </ul>
              </div>

              <div>
                <h3 className="text-lg font-semibold text-blue-800 mb-2">🎮 Bottom Controls</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-gray-700">Cancel:</span>
                    <span>Closes dialog without saving any changes</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-gray-700">Save Resolution:</span>
                    <span>Saves your chosen resolution (must select an action first)</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <h3 className="text-lg font-semibold text-yellow-800 mb-2">💡 How to Test Each Resolution</h3>
            <div className="mb-3 p-2 bg-purple-100 border border-purple-300 rounded">
              <p className="text-sm font-semibold text-purple-800">
                🧪 Test Mode Enabled: Dialog stays open after each resolution so you can test all options!
              </p>
              <p className="text-xs text-purple-700 mt-1">
                Click "Reset" button between tests to clear your selection.
              </p>
            </div>
            <ol className="list-decimal list-inside space-y-1 text-sm">
              <li><strong>Keep Mine:</strong> Click "Keep Mine" → Click "Test Resolution" → Click "Reset" for next test</li>
              <li><strong>Use Latest:</strong> Click "Use Latest" → Click "Test Resolution" → Click "Reset" for next test</li>
              <li><strong>Auto-Merge:</strong> Click "Attempt Auto-Merge" → Review result → Click "Test Resolution"</li>
              <li><strong>Force Save:</strong> Click "Force Save" → Click "Confirm Force Save"</li>
            </ol>
            <p className="text-xs text-gray-600 mt-2">
              Note: In production mode, the dialog would close after resolution. Test mode keeps it open for convenience.
            </p>
          </div>
        </div>

        {/* Feature Flag Control */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Feature Flag Control</h2>
          <div className="flex items-center gap-4">
            <button
              onClick={toggleFeatureFlag}
              className={`px-6 py-2 rounded font-semibold ${
                flagEnabled 
                  ? 'bg-green-600 text-white hover:bg-green-700' 
                  : 'bg-gray-600 text-white hover:bg-gray-700'
              }`}
            >
              offline.conflictUI: {flagEnabled ? 'ENABLED' : 'DISABLED'}
            </button>
            <span className="text-sm text-gray-600">
              {flagEnabled 
                ? '✅ Conflict detection is active' 
                : '❌ Conflict detection is inactive'}
            </span>
          </div>
        </div>

        {/* Test Actions */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Actions</h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={testVersionAPI}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Test Version API
            </button>
            <button
              onClick={simulateConflict}
              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700"
              disabled={!flagEnabled}
            >
              Simulate Conflict Dialog
            </button>
            <button
              onClick={createRealConflict}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Create Real 409 Conflict
            </button>
            <button
              onClick={initializeTestDocuments}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Reset Test Documents
            </button>
          </div>
        </div>

        {/* Conflict Statistics */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Conflict Statistics</h2>
          {conflictStats ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-500">Active Conflicts</div>
                <div className="text-2xl font-bold">{conflictStats.activeCount}</div>
              </div>
              <div className="bg-gray-50 p-4 rounded">
                <div className="text-sm text-gray-500">Conflicts List</div>
                <div className="text-sm">
                  {conflictStats.conflicts.length > 0 
                    ? conflictStats.conflicts.map((c: any, i: number) => (
                        <div key={i}>{c.noteId}/{c.panelId}</div>
                      ))
                    : 'No active conflicts'}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-gray-500">Loading stats...</p>
          )}
        </div>

        {/* Test Logs */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Test Logs</h2>
            <button
              onClick={clearLogs}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Clear Logs
            </button>
          </div>
          <div className="bg-gray-900 text-gray-300 p-4 rounded font-mono text-sm h-64 overflow-y-auto">
            {logs.map((log, i) => (
              <div 
                key={i} 
                className={
                  log.includes('ERROR') ? 'text-red-400' :
                  log.includes('SUCCESS') ? 'text-green-400' :
                  log.includes('WARNING') ? 'text-yellow-400' :
                  'text-gray-300'
                }
              >
                {log}
              </div>
            ))}
          </div>
        </div>

        {/* Conflict Resolution Dialog (will appear when conflict is triggered) */}
        <ConflictResolutionDialog 
          testMode={true}  // Enable test mode to keep dialog open
          onResolved={(resolution) => {
            addLog(`Conflict resolved: ${resolution.action}`, 'success');
          }}
        />
      </div>
    </div>
  );
}