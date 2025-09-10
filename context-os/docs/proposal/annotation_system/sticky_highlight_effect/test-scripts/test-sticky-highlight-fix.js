/**
 * Test Script: Sticky Highlight Effect Fix Validation
 * 
 * This script validates that the annotation marks no longer extend
 * when typing at their boundaries.
 * 
 * Run this in the browser console while on a page with the editor.
 */

console.log('=== TESTING STICKY HIGHLIGHT FIX ===\n');

function testStickyHighlightFix() {
  console.log('1. CHECKING MARK CONFIGURATION:');
  
  // Find TipTap editor instance
  const editorElement = document.querySelector('.ProseMirror');
  if (!editorElement) {
    console.error('❌ No editor found on page');
    return;
  }
  
  // Access the editor view through the element
  const view = editorElement._editorView || 
                editorElement.pmViewDesc?.view ||
                window.__tiptapEditor?.view;
  
  if (!view) {
    console.error('❌ Could not access editor view');
    console.log('Try: Click in the editor first, then run this test');
    return;
  }
  
  const state = view.state;
  const annotationMark = state.schema.marks.annotation;
  
  if (!annotationMark) {
    console.error('❌ No annotation mark in schema');
    return;
  }
  
  // Check mark spec for inclusive and keepOnSplit
  console.log('   Annotation mark spec:');
  console.log(`   - inclusive: ${annotationMark.spec.inclusive}`);
  console.log(`   - keepOnSplit: ${annotationMark.spec.keepOnSplit}`);
  
  if (annotationMark.spec.inclusive === false) {
    console.log('   ✅ inclusive: false is set correctly');
  } else {
    console.error('   ❌ inclusive should be false but is:', annotationMark.spec.inclusive);
  }
  
  if (annotationMark.spec.keepOnSplit === false) {
    console.log('   ✅ keepOnSplit: false is set correctly');
  } else {
    console.error('   ❌ keepOnSplit should be false but is:', annotationMark.spec.keepOnSplit);
  }
  
  console.log('\n2. CHECKING PLUGINS:');
  
  // Check for ClearStoredMarksAtBoundary plugin
  const plugins = state.plugins;
  let foundClearMarks = false;
  let foundAnnotationDecorations = false;
  
  plugins.forEach(plugin => {
    const props = plugin.spec?.props || plugin.props;
    if (props?.handleTextInput) {
      // Check if it's our clear marks plugin by looking at the function
      const funcStr = props.handleTextInput.toString();
      if (funcStr.includes('rangeHasMark') && funcStr.includes('setStoredMarks')) {
        foundClearMarks = true;
        console.log('   ✅ ClearStoredMarksAtBoundary plugin found');
      }
    }
    
    // Check for annotation decorations
    if (plugin.key && plugin.key.key && plugin.key.key.includes('annotation')) {
      foundAnnotationDecorations = true;
    }
  });
  
  if (!foundClearMarks) {
    console.warn('   ⚠️ ClearStoredMarksAtBoundary plugin not found');
    console.log('   This may cause issues with IME input');
  }
  
  if (foundAnnotationDecorations) {
    console.log('   ✅ Annotation decorations plugin found');
  }
  
  console.log('\n3. SIMULATING BOUNDARY TYPING:');
  
  // Find an annotation in the document
  let annotationFound = false;
  let annotationEnd = null;
  
  state.doc.descendants((node, pos) => {
    if (!annotationFound && node.marks.some(mark => mark.type.name === 'annotation')) {
      annotationFound = true;
      annotationEnd = pos + node.nodeSize;
      console.log(`   Found annotation at position ${pos}-${annotationEnd}`);
      console.log(`   Text: "${node.text}"`);
      
      // Check what happens at the boundary
      const marksAtEnd = state.doc.resolve(annotationEnd).marks();
      const hasAnnotationAtEnd = marksAtEnd.some(m => m.type.name === 'annotation');
      
      if (!hasAnnotationAtEnd) {
        console.log('   ✅ Annotation mark does not extend past boundary');
      } else {
        console.error('   ❌ Annotation mark extends past boundary');
      }
    }
  });
  
  if (!annotationFound) {
    console.log('   No annotations found in document');
    console.log('   Create an annotation and run this test again');
  }
  
  console.log('\n4. TESTING STORED MARKS:');
  
  // Check current stored marks
  const storedMarks = state.storedMarks;
  if (storedMarks) {
    const hasAnnotation = storedMarks.some(m => m.type.name === 'annotation');
    if (hasAnnotation) {
      console.warn('   ⚠️ Annotation mark is in stored marks');
      console.log('   This could cause sticky behavior');
    } else {
      console.log('   ✅ No annotation marks in stored marks');
    }
  } else {
    console.log('   ✅ No stored marks active');
  }
  
  console.log('\n5. MANUAL TEST INSTRUCTIONS:');
  console.log('   1. Create an annotation (select text and annotate)');
  console.log('   2. Click at the END of the highlighted text');
  console.log('   3. Type new text - it should NOT be highlighted');
  console.log('   4. Press Enter at the end - new line should NOT be highlighted');
  console.log('   5. Use IME input (if available) - should work correctly');
  
  console.log('\n6. CONFIGURATION SUMMARY:');
  const allGood = annotationMark.spec.inclusive === false && 
                  annotationMark.spec.keepOnSplit === false &&
                  foundClearMarks;
  
  if (allGood) {
    console.log('   🎉 All sticky highlight fixes are properly configured!');
  } else {
    console.warn('   ⚠️ Some fixes may not be properly configured');
    console.log('   Check the errors above for details');
  }
}

// Helper function to create a test annotation
function createTestAnnotation() {
  const editorElement = document.querySelector('.ProseMirror');
  if (!editorElement) {
    console.error('No editor found');
    return;
  }
  
  // Focus the editor
  editorElement.focus();
  
  // Insert test text
  document.execCommand('insertText', false, 'This is test text for annotation');
  
  // Select some text
  const selection = window.getSelection();
  const range = document.createRange();
  const textNode = editorElement.querySelector('p')?.firstChild;
  
  if (textNode && textNode.nodeType === Node.TEXT_NODE) {
    range.setStart(textNode, 8); // Start at "test"
    range.setEnd(textNode, 12);   // End after "test"
    selection.removeAllRanges();
    selection.addRange(range);
    
    console.log('Text selected. Now trigger annotation creation through UI.');
  }
}

// Run the test
testStickyHighlightFix();

console.log('\n=== END TEST ===');
console.log('To create a test annotation, run: createTestAnnotation()');

// Export for use
window.testStickyHighlight = {
  test: testStickyHighlightFix,
  createAnnotation: createTestAnnotation
};