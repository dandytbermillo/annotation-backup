// Debug script to understand what's in the branch data
console.log('=== DEBUGGING BRANCH CONTENT ===\n');

// Check canvasDataStore
const ds = window.canvasDataStore;
if (ds && ds.size > 0) {
  console.log('Canvas Data Store contents:\n');
  
  ds.forEach((branch, key) => {
    console.log(`Branch ID: ${key}`);
    console.log('Branch data:', branch);
    
    if (branch.content) {
      console.log('  content type:', typeof branch.content);
      console.log('  content value:', branch.content);
      
      // Try to parse if JSON
      if (typeof branch.content === 'string' && branch.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(branch.content);
          console.log('  Parsed content:', parsed);
          
          // Extract text from ProseMirror
          function extractText(node) {
            if (!node) return '';
            if (node.type === 'text' && node.text) return node.text;
            if (node.content && Array.isArray(node.content)) {
              return node.content.map(extractText).join(' ');
            }
            return '';
          }
          
          const extractedText = extractText(parsed);
          console.log('  Extracted text:', extractedText);
        } catch (e) {
          console.log('  Failed to parse as JSON');
        }
      }
    }
    
    console.log('  originalText:', branch.originalText);
    console.log('  title:', branch.title);
    console.log('---');
  });
} else {
  console.log('No branches in canvasDataStore');
}

// Check what the annotation elements have
console.log('\nAnnotation elements:');
const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
annotations.forEach((ann, i) => {
  const branchId = ann.getAttribute('data-branch-id') || ann.getAttribute('data-branch');
  const text = ann.textContent;
  console.log(`Annotation ${i + 1}:`);
  console.log('  Selected text:', text);
  console.log('  Branch ID:', branchId);
  
  // Check if this branch exists in store
  if (ds && branchId) {
    const branch = ds.get(branchId);
    if (branch) {
      console.log('  Branch found in store');
      console.log('  Branch content preview:', branch.content ? String(branch.content).substring(0, 100) : '(none)');
    } else {
      console.log('  Branch NOT in store');
    }
  }
});

console.log('\n=== KEY INSIGHT ===');
console.log('The branch.content should contain what you TYPED in the annotation panel,');
console.log('NOT the selected text ("def" in this case).');
console.log('If branch.content shows "def", then the wrong data is being saved.');
console.log('\nCheck what you typed in the annotation panel for the "def" annotation.');
console.log('That\'s what should appear in the tooltip!');