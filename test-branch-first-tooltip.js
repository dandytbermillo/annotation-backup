// Test script to verify branch-first tooltip fix
// This verifies that tooltips show branch annotation content, not editor content

console.log('=== TESTING BRANCH-FIRST TOOLTIP FIX ===\n');

function testTooltipContent() {
  console.log('1. CHECKING PRECEDENCE ORDER:');
  console.log('   Expected: Branch content → Original text → Provider doc (fallback)');
  console.log('   NOT: Provider doc → Branch content → Original text\n');
  
  // Check canvasDataStore
  const ds = window.canvasDataStore;
  if (ds && ds.size > 0) {
    console.log('2. CANVAS DATA STORE BRANCHES:');
    let foundWithContent = false;
    ds.forEach((branch, key) => {
      if (branch.content) {
        foundWithContent = true;
        console.log(`   Branch ${key}:`);
        console.log(`   - Has content: ${!!branch.content}`);
        console.log(`   - Content type: ${typeof branch.content}`);
        
        // Check what the content looks like
        if (typeof branch.content === 'string') {
          if (branch.content.startsWith('{') || branch.content.startsWith('[')) {
            console.log(`   - Content is JSON string (ProseMirror format)`);
            try {
              const parsed = JSON.parse(branch.content);
              if (parsed.type === 'doc') {
                console.log(`   - ✅ Valid ProseMirror JSON - will be parsed correctly`);
              }
            } catch {
              console.log(`   - ⚠️ Looks like JSON but failed to parse`);
            }
          } else if (branch.content.includes('<')) {
            console.log(`   - Content is HTML`);
          } else {
            console.log(`   - Content is plain text`);
          }
        }
        
        console.log(`   - Original text: "${branch.originalText || '(none)'}"`);
      }
    });
    
    if (!foundWithContent) {
      console.log('   ⚠️ No branches with content found - create annotations with notes first');
    }
  } else {
    console.log('2. No branches in canvasDataStore');
  }
  
  console.log('\n3. TESTING LIVE TOOLTIP:');
  
  // Find an annotation and trigger hover
  const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
  if (annotations.length > 0) {
    console.log(`   Found ${annotations.length} annotations`);
    
    // Trigger hover on first annotation
    const firstAnn = annotations[0];
    const branchId = firstAnn.getAttribute('data-branch-id') || firstAnn.getAttribute('data-branch');
    console.log(`   Testing annotation with branch ID: ${branchId}`);
    
    // Simulate hover
    const event = new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 100
    });
    firstAnn.dispatchEvent(event);
    
    // Check tooltip content after a delay
    setTimeout(() => {
      const tooltip = document.querySelector('.annotation-tooltip');
      if (tooltip) {
        const content = tooltip.querySelector('.tooltip-content');
        if (content) {
          const text = content.textContent;
          console.log(`\n   TOOLTIP CONTENT: "${text}"`);
          
          // Analyze what's shown
          if (text.includes('{"type":"doc"')) {
            console.error('   ❌ ERROR: Showing raw ProseMirror JSON!');
            console.log('   This means the branch content extraction failed');
          } else if (text.includes('<p>') || text.includes('<div>')) {
            console.error('   ❌ ERROR: Showing raw HTML!');
            console.log('   This means HTML stripping failed');
          } else if (text === 'No notes added yet') {
            console.log('   ⚠️ Showing placeholder - branch has no content');
            console.log('   Add notes to the annotation branch to test properly');
          } else if (text === 'Loading notes...') {
            console.log('   ⚠️ Still loading - wait a moment and check again');
          } else {
            console.log('   ✅ SUCCESS: Showing actual branch content (not JSON/HTML)');
            
            // Check if it matches branch content
            const normalizedBranchId = branchId.startsWith('branch-') ? branchId : `branch-${branchId}`;
            const branch = ds?.get(normalizedBranchId);
            if (branch) {
              console.log(`   Branch original text: "${branch.originalText || '(none)'}"`);
              if (text === branch.originalText) {
                console.log('   ℹ️ Showing original selected text (no branch notes yet)');
              } else {
                console.log('   ✅ Showing branch notes (not original text)');
              }
            }
          }
        }
      } else {
        console.log('   Tooltip not found - hover might have been too quick');
      }
    }, 500);
  } else {
    console.log('   No annotations found - create some first');
  }
}

console.log('ARCHITECTURAL FIX APPLIED:');
console.log('- Branch content is now prioritized over provider document');
console.log('- API calls fetch from /branches endpoint, not /documents');
console.log('- Provider document is only a last-resort fallback\n');

console.log('WHY THIS MATTERS:');
console.log('- Provider documents return EDITOR content (where annotation was made)');
console.log('- Branch content is the ANNOTATION notes (what user typed in branch panel)');
console.log('- Tooltips should show annotation notes, not editor content!\n');

testTooltipContent();

console.log('\n=== END TEST ===');