// Runtime test for hover icon functionality
// Run this in browser console after creating an annotation

function testHoverIcon() {
    console.log('=== Testing Hover Icon Functionality ===');
    
    // Check if annotation decorations plugin is registered
    const editor = window.editor || document.querySelector('.ProseMirror')?.__vueParentComponent?.proxy?.editor;
    
    if (!editor) {
        console.error('❌ Editor not found. Make sure you have the editor open.');
        return;
    }
    
    console.log('✅ Editor found');
    
    // Check for annotation elements
    const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
    console.log(`📝 Found ${annotations.length} annotation elements`);
    
    if (annotations.length === 0) {
        console.warn('⚠️ No annotations found. Please create an annotation first.');
        return;
    }
    
    // Check for hover icon element
    const hoverIcon = document.querySelector('.annotation-hover-icon');
    if (hoverIcon) {
        console.log('✅ Hover icon element exists in DOM');
        console.log('   Style:', hoverIcon.style.cssText);
        console.log('   Display:', hoverIcon.style.display);
    } else {
        console.warn('⚠️ Hover icon element not found in DOM');
    }
    
    // Simulate hover on first annotation
    const firstAnnotation = annotations[0];
    console.log('\n📍 Simulating hover on annotation:', {
        class: firstAnnotation.className,
        branchId: firstAnnotation.getAttribute('data-branch-id'),
        type: firstAnnotation.getAttribute('data-annotation-type')
    });
    
    // Create and dispatch mouseover event
    const mouseoverEvent = new MouseEvent('mouseover', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: firstAnnotation.getBoundingClientRect().left + 10,
        clientY: firstAnnotation.getBoundingClientRect().top + 10
    });
    
    firstAnnotation.dispatchEvent(mouseoverEvent);
    
    // Check if hover icon appeared
    setTimeout(() => {
        const hoverIconAfter = document.querySelector('.annotation-hover-icon');
        if (hoverIconAfter && hoverIconAfter.style.display !== 'none') {
            console.log('✅ Hover icon appeared!');
            console.log('   Position:', hoverIconAfter.style.left, hoverIconAfter.style.top);
        } else {
            console.error('❌ Hover icon did not appear');
            
            // Debug: Check event listeners
            console.log('\n🔍 Debugging info:');
            const proseMirror = document.querySelector('.ProseMirror');
            if (proseMirror) {
                const listeners = getEventListeners ? getEventListeners(proseMirror) : null;
                if (listeners) {
                    console.log('Event listeners on .ProseMirror:', Object.keys(listeners));
                }
            }
        }
        
        // Clean up - dispatch mouseout
        const mouseoutEvent = new MouseEvent('mouseout', {
            view: window,
            bubbles: true,
            cancelable: true
        });
        firstAnnotation.dispatchEvent(mouseoutEvent);
    }, 100);
}

// Run the test
testHoverIcon();

// Also check console logs
console.log('\n📋 Recent console logs containing "AnnotationDecorations":');
const consoleLogs = performance.getEntriesByType('measure')
    .filter(e => e.name.includes('AnnotationDecorations'))
    .slice(-5);
if (consoleLogs.length > 0) {
    consoleLogs.forEach(log => console.log(log));
} else {
    console.log('No recent logs found. Check browser console for [AnnotationDecorations] messages.');
}