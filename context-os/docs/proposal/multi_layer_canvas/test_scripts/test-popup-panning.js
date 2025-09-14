// Test script for popup overlay panning functionality
// Run this in browser console after opening popups

async function testPopupPanning() {
  console.log('Testing Popup Overlay Panning...\n');
  
  // Check if popup overlay exists
  const overlay = document.querySelector('#popup-overlay');
  if (!overlay) {
    console.error('❌ Popup overlay not found. Please open some popups first.');
    return;
  }
  
  // Get transform container
  const container = overlay.querySelector('.absolute.inset-0');
  if (!container) {
    console.error('❌ Transform container not found');
    return;
  }
  
  // Get initial transform
  const initialTransform = container.style.transform;
  console.log('Initial transform:', initialTransform || 'none');
  
  // Simulate pan gesture
  console.log('\nSimulating pan gesture...');
  
  // Create pointer down event on empty space
  const rect = overlay.getBoundingClientRect();
  const startX = rect.left + 100;
  const startY = rect.top + 100;
  
  const pointerDown = new PointerEvent('pointerdown', {
    clientX: startX,
    clientY: startY,
    bubbles: true,
    cancelable: true,
    pointerId: 1
  });
  
  overlay.dispatchEvent(pointerDown);
  
  // Simulate drag
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const pointerMove = new PointerEvent('pointermove', {
    clientX: startX + 200,
    clientY: startY + 150,
    bubbles: true,
    cancelable: true,
    pointerId: 1
  });
  
  overlay.dispatchEvent(pointerMove);
  
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // End drag
  const pointerUp = new PointerEvent('pointerup', {
    clientX: startX + 200,
    clientY: startY + 150,
    bubbles: true,
    cancelable: true,
    pointerId: 1
  });
  
  overlay.dispatchEvent(pointerUp);
  
  // Check final transform
  await new Promise(resolve => setTimeout(resolve, 100));
  const finalTransform = container.style.transform;
  console.log('Final transform:', finalTransform);
  
  // Verify transform changed
  if (finalTransform !== initialTransform) {
    console.log('✅ Transform updated successfully');
    
    // Parse transform values
    const match = finalTransform.match(/translate3d\(([^,]+)px,\s*([^,]+)px,\s*0\)/);
    if (match) {
      const x = parseFloat(match[1]);
      const y = parseFloat(match[2]);
      console.log(`   Offset: x=${x}px, y=${y}px`);
      
      if (Math.abs(x - 200) < 10 && Math.abs(y - 150) < 10) {
        console.log('✅ Pan deltas applied correctly');
      } else {
        console.log('⚠️  Pan deltas not as expected');
      }
    }
  } else {
    console.error('❌ Transform did not change');
  }
  
  // Test zoom
  console.log('\nTesting zoom...');
  const wheelEvent = new WheelEvent('wheel', {
    deltaY: -100,
    clientX: rect.left + 200,
    clientY: rect.top + 200,
    bubbles: true,
    cancelable: true
  });
  
  overlay.dispatchEvent(wheelEvent);
  
  await new Promise(resolve => setTimeout(resolve, 100));
  const zoomTransform = container.style.transform;
  console.log('After zoom:', zoomTransform);
  
  if (zoomTransform.includes('scale')) {
    console.log('✅ Zoom working');
  } else {
    console.log('⚠️  Zoom not detected in transform');
  }
  
  console.log('\n=== Test Complete ===');
  console.log('Manual verification:');
  console.log('1. Click and drag on empty space - popups should pan together');
  console.log('2. No Space key needed - just click+drag');
  console.log('3. Scroll wheel should zoom in/out');
  console.log('4. Dragging popup headers should move individual popups');
}

// Export for use
window.testPopupPanning = testPopupPanning;
console.log('Test loaded. Run: testPopupPanning()');