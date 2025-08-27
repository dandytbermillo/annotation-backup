// Test script to trace TipTap to persistence flow
// Run this in browser console to monitor persistence calls

(() => {
  console.log('=== Starting TipTap Persistence Monitor ===');
  
  // Track original fetch
  const originalFetch = window.fetch;
  
  // Override fetch to monitor persistence API calls
  window.fetch = async function(...args) {
    const [url, options] = args;
    
    // Check if it's a persistence call
    if (url && url.includes('/api/persistence')) {
      console.log('🔵 Persistence API Call:', {
        url,
        method: options?.method || 'GET',
        timestamp: new Date().toISOString()
      });
      
      if (options?.body) {
        try {
          const body = JSON.parse(options.body);
          console.log('📝 Persistence payload:', {
            docName: body.docName,
            hasUpdate: !!body.update,
            updateSize: body.update?.length || 0
          });
        } catch (e) {}
      }
    }
    
    // Call original fetch
    const response = await originalFetch.apply(this, args);
    
    // Log response status
    if (url && url.includes('/api/persistence')) {
      console.log(`${response.ok ? '✅' : '❌'} Persistence response:`, {
        status: response.status,
        ok: response.ok
      });
    }
    
    return response;
  };
  
  // Monitor YJS document updates
  const monitorYjsUpdates = () => {
    // Try to find YJS documents in the global scope
    if (window.Y) {
      console.log('🟢 YJS detected in window');
      
      // Hook into Y.Doc prototype
      const originalOn = window.Y.Doc.prototype.on;
      window.Y.Doc.prototype.on = function(event, handler) {
        if (event === 'update') {
          console.log('🔶 YJS update handler registered on doc:', this.guid);
          
          // Wrap the handler to log when updates occur
          const wrappedHandler = (...args) => {
            console.log('🟡 YJS update event fired:', {
              docGuid: this.guid,
              updateSize: args[0]?.length || 0,
              timestamp: new Date().toISOString()
            });
            return handler.apply(this, args);
          };
          
          return originalOn.call(this, event, wrappedHandler);
        }
        return originalOn.call(this, event, handler);
      };
    }
  };
  
  // Monitor editor content changes
  const monitorEditorChanges = () => {
    // Check for TipTap editors periodically
    setInterval(() => {
      const editors = document.querySelectorAll('.tiptap-editor');
      editors.forEach((editor, index) => {
        if (!editor.dataset.monitored) {
          editor.dataset.monitored = 'true';
          console.log(`🟣 Found TipTap editor ${index + 1}`);
          
          // Monitor content changes
          const observer = new MutationObserver((mutations) => {
            if (mutations.some(m => m.type === 'characterData' || m.type === 'childList')) {
              console.log(`✏️ Editor ${index + 1} content changed`);
            }
          });
          
          observer.observe(editor, {
            childList: true,
            characterData: true,
            subtree: true
          });
        }
      });
    }, 2000);
  };
  
  // Start monitoring
  monitorYjsUpdates();
  monitorEditorChanges();
  
  console.log('✅ Persistence monitoring active. Make edits in TipTap to see the flow.');
  console.log('📋 Legend:');
  console.log('  ✏️ = Editor content changed');
  console.log('  🟡 = YJS update event');
  console.log('  🔵 = Persistence API call');
  console.log('  ✅/❌ = API response');
})();