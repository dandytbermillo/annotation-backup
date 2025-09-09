// Test script to verify tooltip JSON parsing fix
// Run this in browser console after creating an annotation

console.log('=== TESTING TOOLTIP JSON FIX ===');

// Test the extractTextFromPMJSON function behavior
function testExtractText() {
  // Simulate the ProseMirror JSON structure
  const testDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'This is the actual branch content'
          }
        ]
      }
    ]
  };
  
  // Test stringified version (what might be stored)
  const stringifiedDoc = JSON.stringify(testDoc);
  
  console.log('Test Document:', testDoc);
  console.log('Stringified:', stringifiedDoc);
  
  // Check if canvasDataStore has any branches
  const ds = window.canvasDataStore;
  if (ds && ds.size > 0) {
    console.log('\n=== Canvas Data Store Branches ===');
    ds.forEach((value, key) => {
      console.log(`Branch ${key}:`, {
        title: value.title,
        type: value.type,
        content: value.content,
        contentType: typeof value.content,
        originalText: value.originalText
      });
    });
  }
  
  // Try to trigger tooltip on existing annotation
  const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
  if (annotations.length > 0) {
    console.log(`\nFound ${annotations.length} annotations`);
    console.log('First annotation branch ID:', 
      annotations[0].getAttribute('data-branch-id') || 
      annotations[0].getAttribute('data-branch')
    );
    
    // Simulate hover to check tooltip content
    const event = new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100
    });
    annotations[0].dispatchEvent(event);
    
    setTimeout(() => {
      const tooltip = document.querySelector('.annotation-tooltip');
      if (tooltip) {
        const content = tooltip.querySelector('.tooltip-content');
        console.log('\n=== Tooltip Content ===');
        console.log('Content element:', content);
        console.log('Text displayed:', content?.textContent);
        
        // Check if it's showing JSON or actual text
        const text = content?.textContent || '';
        if (text.includes('{"type":"doc"')) {
          console.error('❌ STILL SHOWING JSON! Fix not working properly');
        } else if (text.includes('No notes added yet') || text.includes('Loading')) {
          console.warn('⚠️ Showing placeholder text');
        } else {
          console.log('✅ Showing actual content (not JSON)');
        }
      } else {
        console.warn('Tooltip element not found after hover');
      }
    }, 500);
  } else {
    console.log('No annotations found. Create one first.');
  }
}

testExtractText();
console.log('\n=== END TEST ===');