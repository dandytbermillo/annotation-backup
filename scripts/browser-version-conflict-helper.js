/**
 * Browser Console Helper for Version Conflict Testing
 *
 * Copy and paste this entire script into your browser console (Tab A)
 * Then follow the instructions printed to console
 */

(function() {
  console.clear();
  console.log('%c🔬 Version Conflict Test Helper', 'font-size: 20px; font-weight: bold; color: #4CAF50');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Helper: Get workspace versions from localStorage
  window.getWorkspaceVersions = function() {
    const raw = localStorage.getItem('canvas_workspace_versions');
    if (!raw) {
      console.warn('⚠️  No workspace versions found in localStorage');
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      console.table(parsed.map(([noteId, version]) => ({
        noteId: noteId.substring(0, 8) + '...',
        version
      })));
      return parsed;
    } catch (e) {
      console.error('Failed to parse workspace versions:', e);
      return null;
    }
  };

  // Helper: Get current note ID
  window.getCurrentNoteId = function() {
    const url = new URL(window.location.href);
    const noteId = url.searchParams.get('noteId') ||
                   url.pathname.split('/').pop();

    if (noteId && noteId !== 'canvas') {
      console.log('📝 Current Note ID:', noteId);
      return noteId;
    }

    console.warn('⚠️  Could not determine note ID from URL');
    return null;
  };

  // Helper: Check offline queue
  window.checkOfflineQueue = async function() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('canvas_offline_queue', 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction(['operations'], 'readonly');
        const store = tx.objectStore('operations');
        const getAll = store.getAll();

        getAll.onsuccess = () => {
          const operations = getAll.result;
          console.log(`📦 Offline Queue: ${operations.length} operations`);
          if (operations.length > 0) {
            console.table(operations.map(op => ({
              type: op.type,
              noteId: op.noteId.substring(0, 8) + '...',
              version: op.workspaceVersion,
              status: op.status,
              timestamp: new Date(op.timestamp).toLocaleTimeString()
            })));
          }
          resolve(operations);
        };
      };
    });
  };

  // Helper: Simulate going offline
  window.goOffline = function() {
    // Method 1: DevTools Network throttling (user must enable manually)
    console.log('🔌 To go OFFLINE:');
    console.log('   1. Open DevTools → Network tab');
    console.log('   2. Click "No throttling" dropdown');
    console.log('   3. Select "Offline"');
    console.log('   OR run: goOfflineManual()');
  };

  window.goOfflineManual = function() {
    // Dispatch offline event to simulate
    window.dispatchEvent(new Event('offline'));
    console.log('📴 Dispatched offline event');
    console.log('🎯 Now make a change (move a panel or create one)');
  };

  window.goOnline = function() {
    window.dispatchEvent(new Event('online'));
    console.log('📶 Dispatched online event');
    console.log('🔄 Offline queue will flush automatically...');
  };

  // Helper: Manually enqueue an operation
  window.manuallyEnqueueOperation = async function() {
    const noteId = getCurrentNoteId();
    const versions = getWorkspaceVersions();
    const currentVersion = versions ? versions[0][1] : 0;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open('canvas_offline_queue', 1);

      request.onerror = () => reject(request.error);

      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction(['operations'], 'readwrite');
        const store = tx.objectStore('operations');

        const operation = {
          id: Date.now().toString(),
          type: 'camera_update',
          noteId: noteId,
          workspaceVersion: currentVersion,
          data: {
            camera: { x: 100, y: 100, zoom: 1 },
            userId: 'test-user-manual'
          },
          timestamp: Date.now(),
          retries: 0,
          status: 'pending'
        };

        const addRequest = store.add(operation);

        addRequest.onsuccess = () => {
          console.log(`✅ Manually enqueued operation with version ${currentVersion}`);
          resolve(operation);
        };

        addRequest.onerror = () => reject(addRequest.error);
      };
    });
  };

  // Print instructions
  console.log('%c📋 INSTRUCTIONS:', 'font-weight: bold; font-size: 14px');
  console.log('\n1️⃣  TAB A (this tab) - Check versions:');
  console.log('   → getCurrentNoteId()');
  console.log('   → getWorkspaceVersions()');
  console.log('\n2️⃣  TAB A - Go offline:');
  console.log('   → goOfflineManual()');
  console.log('\n3️⃣  TAB A - Make a change while offline:');
  console.log('   → Move a panel or create a branch panel');
  console.log('   → checkOfflineQueue()  // Verify operation queued');
  console.log('\n4️⃣  TAB B (open new tab with same note):');
  console.log('   → Close the main panel (this bumps version on server)');
  console.log('\n5️⃣  TAB A - Come back online:');
  console.log('   → goOnline()');
  console.log('   → Watch the terminal running monitor script!');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('✅ Helper functions loaded!');
  console.log('💡 Start with: getCurrentNoteId()');
})();
