// Test script to verify note switching preserves content
// Run this in the browser console

async function testNoteSwitching() {
  console.log('=== Testing Note Switching Fix ===');
  
  // Check current editor docs cache
  console.log('Initial cache state:');
  console.log('- Editor docs in cache:', window.editorDocs?.size || 'N/A');
  
  // Simulate note switching
  console.log('\n1. Switching to Note A...');
  // You would manually switch to a note in the UI
  
  setTimeout(() => {
    console.log('2. Check if content loaded for Note A');
    const editors = document.querySelectorAll('.tiptap-editor');
    editors.forEach((editor, index) => {
      const content = editor.textContent || editor.innerText;
      console.log(`   Panel ${index}: ${content.substring(0, 50)}...`);
    });
    
    console.log('\n3. Now switch to Note B in the UI...');
    
    setTimeout(() => {
      console.log('4. Check if content loaded for Note B');
      const editorsB = document.querySelectorAll('.tiptap-editor');
      editorsB.forEach((editor, index) => {
        const content = editor.textContent || editor.innerText;
        console.log(`   Panel ${index}: ${content.substring(0, 50)}...`);
      });
      
      console.log('\n5. Now switch back to Note A...');
      
      setTimeout(() => {
        console.log('6. Check if Note A content is preserved:');
        const editorsA2 = document.querySelectorAll('.tiptap-editor');
        editorsA2.forEach((editor, index) => {
          const content = editor.textContent || editor.innerText;
          console.log(`   Panel ${index}: ${content.substring(0, 50)}...`);
        });
        
        console.log('\n=== Test Complete ===');
        console.log('If content appears immediately when switching back, the fix is working!');
      }, 3000);
    }, 3000);
  }, 2000);
}

// Helper to check Y.Doc content
function checkYDocContent() {
  console.log('\n=== Checking Y.Doc Content ===');
  
  // Try to access the CollaborationProvider
  if (window.CollaborationProvider) {
    const provider = window.CollaborationProvider.getInstance();
    const currentNote = provider.currentNoteId;
    console.log('Current note:', currentNote);
    
    // Check branches map
    const branchesMap = provider.getBranchesMap();
    console.log('Branches in current note:', branchesMap.size);
    
    branchesMap.forEach((value, key) => {
      console.log(`- Branch ${key}:`, value.content?.substring(0, 50) + '...');
    });
  }
}

// Run the test
console.log('Starting note switching test...');
console.log('Instructions:');
console.log('1. Make sure you have at least 2 notes with content');
console.log('2. Run: testNoteSwitching()');
console.log('3. Follow the prompts to switch between notes');
console.log('');
console.log('You can also run checkYDocContent() to inspect Y.Doc state');