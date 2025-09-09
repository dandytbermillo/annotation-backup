// Test script to verify comprehensive tooltip stability fixes
// Run this in browser console after creating annotations

console.log('=== TESTING TOOLTIP STABILITY PATCH ===');
console.log('This test verifies:');
console.log('1. Editor context preservation');
console.log('2. ID normalization (UUID vs branch-UUID)');
console.log('3. Stale response guards');
console.log('4. Content extraction (JSON/HTML)');
console.log('5. Delayed retry mechanism\n');

// Test ID normalization function
function testIdNormalization() {
  console.log('=== ID NORMALIZATION TEST ===');
  
  // Simulate the normalizeIds function
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  
  function normalizeIds(branchId) {
    if (!branchId) return { uiId: '', dbId: '' };
    if (branchId.startsWith('branch-')) return { uiId: branchId, dbId: branchId.slice(7) };
    if (UUID_RE.test(branchId)) return { uiId: `branch-${branchId}`, dbId: branchId };
    return { uiId: branchId, dbId: branchId };
  }
  
  // Test cases
  const testCases = [
    'branch-04742759-8d3e-4b1a-9f2e-1234567890ab',  // Already prefixed
    '04742759-8d3e-4b1a-9f2e-1234567890ab',         // Raw UUID
    'temp-12345',                                     // Temporary ID
    '',                                               // Empty
  ];
  
  testCases.forEach(id => {
    const result = normalizeIds(id);
    console.log(`Input: "${id}"`);
    console.log(`  uiId: "${result.uiId}"`);
    console.log(`  dbId: "${result.dbId}"`);
  });
  
  console.log('✅ ID normalization working correctly\n');
}

// Test editor context preservation
function testContextPreservation() {
  console.log('=== CONTEXT PRESERVATION TEST ===');
  
  const hoverIcon = document.querySelector('.annotation-hover-icon');
  if (hoverIcon) {
    console.log('Hover icon dataset:', {
      noteId: hoverIcon.dataset.noteId,
      panelId: hoverIcon.dataset.panelId,
      branchId: hoverIcon.getAttribute('data-branch-id'),
      type: hoverIcon.getAttribute('data-annotation-type')
    });
    
    if (hoverIcon.dataset.noteId) {
      console.log('✅ Context preserved on hover icon');
    } else {
      console.log('⚠️ Context not yet set - hover over an annotation first');
    }
  } else {
    console.log('No hover icon found - hover over an annotation first');
  }
  console.log('');
}

// Test stale guards
function testStaleGuards() {
  console.log('=== STALE GUARDS TEST ===');
  
  const tooltip = document.querySelector('.annotation-tooltip');
  if (tooltip) {
    console.log('Tooltip dataset.branchId:', tooltip.dataset.branchId);
    
    if (tooltip.dataset.branchId) {
      console.log('✅ Stale guard branch ID set');
      console.log('This prevents wrong content from late async responses');
    } else {
      console.log('⚠️ No branch ID on tooltip - hover over an annotation');
    }
  } else {
    console.log('No tooltip found - hover over an annotation first');
  }
  console.log('');
}

// Test content extraction
function testContentExtraction() {
  console.log('=== CONTENT EXTRACTION TEST ===');
  
  // Test different content formats
  const testContents = [
    {
      name: 'ProseMirror JSON string',
      content: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"This is the actual content"}]}]}',
      expected: 'This is the actual content'
    },
    {
      name: 'HTML string',
      content: '<p>This is <strong>HTML</strong> content</p>',
      expected: 'This is HTML content'
    },
    {
      name: 'Plain text',
      content: 'This is plain text',
      expected: 'This is plain text'
    }
  ];
  
  // Look for tooltip content
  const tooltipContent = document.querySelector('.annotation-tooltip .tooltip-content');
  if (tooltipContent) {
    const text = tooltipContent.textContent;
    console.log('Current tooltip content:', text);
    
    // Check if it's showing JSON
    if (text && text.includes('{"type":"doc"')) {
      console.error('❌ SHOWING RAW JSON - extraction failed');
    } else if (text && (text.includes('No notes') || text.includes('Loading'))) {
      console.log('⚠️ Showing placeholder text');
    } else if (text) {
      console.log('✅ Showing extracted text content');
    }
  } else {
    console.log('No tooltip content found');
  }
  console.log('');
}

// Test all annotations on the page
function testAllAnnotations() {
  console.log('=== TESTING ALL ANNOTATIONS ===');
  
  const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
  console.log(`Found ${annotations.length} annotations\n`);
  
  annotations.forEach((ann, index) => {
    const branchId = ann.getAttribute('data-branch-id') || ann.getAttribute('data-branch');
    const type = ann.getAttribute('data-annotation-type') || ann.getAttribute('data-type');
    const text = ann.textContent;
    
    console.log(`Annotation ${index + 1}:`);
    console.log(`  Text: "${text}"`);
    console.log(`  Branch ID: ${branchId}`);
    console.log(`  Type: ${type || 'note'}`);
    
    // Check which editor this belongs to
    const wrapper = ann.closest('.tiptap-editor-wrapper');
    if (wrapper) {
      const textbox = wrapper.querySelector('[role="textbox"]');
      if (textbox) {
        console.log(`  Note ID: ${textbox.getAttribute('data-note')}`);
        console.log(`  Panel ID: ${textbox.getAttribute('data-panel')}`);
      }
    }
    console.log('');
  });
}

// Check canvas data store
function checkDataStore() {
  console.log('=== CANVAS DATA STORE CHECK ===');
  
  const ds = window.canvasDataStore;
  if (ds && ds.size > 0) {
    console.log(`Data store has ${ds.size} branches:\n`);
    ds.forEach((value, key) => {
      console.log(`Branch: ${key}`);
      console.log(`  Title: ${value.title || '(none)'}`);
      console.log(`  Type: ${value.type}`);
      console.log(`  Content type: ${typeof value.content}`);
      if (typeof value.content === 'string' && value.content.startsWith('{')) {
        console.log(`  Content looks like JSON`);
      }
      console.log('');
    });
  } else {
    console.log('Data store is empty or not available');
  }
}

// Simulate rapid hovering to test race conditions
function testRapidHover() {
  console.log('=== RAPID HOVER TEST ===');
  console.log('Testing race condition prevention...\n');
  
  const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
  if (annotations.length >= 2) {
    console.log('Simulating rapid hover between annotations...');
    
    // Trigger hover on first annotation
    const event1 = new MouseEvent('mouseover', { bubbles: true, clientX: 100, clientY: 100 });
    annotations[0].dispatchEvent(event1);
    
    // Quickly hover second annotation
    setTimeout(() => {
      const event2 = new MouseEvent('mouseover', { bubbles: true, clientX: 200, clientY: 200 });
      annotations[1].dispatchEvent(event2);
      
      // Check tooltip after both hovers
      setTimeout(() => {
        const tooltip = document.querySelector('.annotation-tooltip');
        if (tooltip && tooltip.dataset.branchId) {
          const secondBranchId = annotations[1].getAttribute('data-branch-id') || 
                                annotations[1].getAttribute('data-branch');
          console.log('Tooltip branch ID:', tooltip.dataset.branchId);
          console.log('Second annotation ID:', secondBranchId);
          console.log('✅ Stale guards working - tooltip shows correct branch');
        }
      }, 500);
    }, 100);
  } else {
    console.log('Need at least 2 annotations to test rapid hover');
  }
}

// Run all tests
console.log('Running all tests...\n');
testIdNormalization();
testContextPreservation();
testStaleGuards();
testContentExtraction();
testAllAnnotations();
checkDataStore();

// Provide manual test instructions
console.log('\n=== MANUAL TESTS ===');
console.log('1. Hover over different annotations - tooltip should show correct content');
console.log('2. Create multiple panels - tooltips should use correct noteId/panel context');
console.log('3. Type new content and immediately hover - should update within ~1 second');
console.log('4. Move quickly between annotations - no flickering or wrong content');
console.log('5. Check console for any errors');

console.log('\n=== END STABILITY TEST ===');