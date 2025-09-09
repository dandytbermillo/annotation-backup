// Final test for hover icon and tooltip functionality
// Run this in browser console after creating an annotation

function testTooltipFunctionality() {
    console.log('=== Testing Tooltip Functionality ===');
    
    // 1. Check for annotations
    const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
    console.log(`✅ Found ${annotations.length} annotation(s)`);
    
    if (annotations.length === 0) {
        console.error('❌ No annotations found. Please create an annotation first.');
        return;
    }
    
    // 2. Test hover icon
    const firstAnnotation = annotations[0];
    console.log('\n📍 Testing hover icon on annotation:', {
        class: firstAnnotation.className,
        branchId: firstAnnotation.getAttribute('data-branch-id'),
        type: firstAnnotation.getAttribute('data-annotation-type')
    });
    
    // Simulate mouseover
    const mouseoverEvent = new MouseEvent('mouseover', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: firstAnnotation.getBoundingClientRect().left + 10,
        clientY: firstAnnotation.getBoundingClientRect().top + 10
    });
    
    firstAnnotation.dispatchEvent(mouseoverEvent);
    
    // Check for hover icon
    setTimeout(() => {
        const hoverIcon = document.querySelector('.annotation-hover-icon');
        if (hoverIcon && hoverIcon.style.display !== 'none') {
            console.log('✅ Hover icon appeared');
            
            // 3. Test tooltip on icon hover
            console.log('\n📍 Testing tooltip on icon hover...');
            
            // Simulate hover on icon
            const iconHoverEvent = new MouseEvent('mouseenter', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            
            hoverIcon.dispatchEvent(iconHoverEvent);
            
            // Check for tooltip
            setTimeout(() => {
                const tooltip = document.querySelector('.annotation-tooltip');
                if (tooltip) {
                    const isVisible = tooltip.classList.contains('visible');
                    if (isVisible) {
                        console.log('✅ Tooltip is visible');
                        console.log('   Content:', {
                            header: tooltip.querySelector('.tooltip-header')?.textContent,
                            content: tooltip.querySelector('.tooltip-content')?.textContent?.substring(0, 50) + '...'
                        });
                    } else {
                        console.error('❌ Tooltip exists but not visible');
                        console.log('   Classes:', tooltip.className);
                        console.log('   Style:', tooltip.style.cssText);
                    }
                } else {
                    console.error('❌ Tooltip element not found');
                }
                
                // Clean up
                const mouseoutEvent = new MouseEvent('mouseout', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                firstAnnotation.dispatchEvent(mouseoutEvent);
                
                const iconLeaveEvent = new MouseEvent('mouseleave', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                if (hoverIcon) hoverIcon.dispatchEvent(iconLeaveEvent);
                
            }, 200);
            
        } else {
            console.error('❌ Hover icon did not appear or is hidden');
            if (hoverIcon) {
                console.log('   Icon exists but display:', hoverIcon.style.display);
            }
        }
    }, 100);
    
    // 4. Check console for errors
    console.log('\n📋 Check browser console for any errors above');
}

// Run the test
testTooltipFunctionality();

// Also provide manual test instructions
console.log('\n📝 Manual Test Instructions:');
console.log('1. Hover over annotated text - 🔎 icon should appear');
console.log('2. Hover over the 🔎 icon - tooltip should appear');
console.log('3. Move mouse to tooltip - it should stay visible');
console.log('4. Move mouse away - both should hide after a short delay');