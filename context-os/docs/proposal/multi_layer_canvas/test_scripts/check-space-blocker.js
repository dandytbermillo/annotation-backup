// Run this in browser console to find what's blocking space bar

(function findSpaceBlocker() {
    console.log('🔍 FINDING SPACE BAR BLOCKER\n');
    
    // 1. Check if popup overlay exists and its state
    const overlay = document.querySelector('#popup-overlay');
    if (overlay) {
        const styles = window.getComputedStyle(overlay);
        console.log('Popup Overlay Found:');
        console.log('- pointer-events:', styles.pointerEvents);
        console.log('- z-index:', styles.zIndex);
        console.log('- display:', styles.display);
        console.log('- visibility:', styles.visibility);
        
        // Check if it's blocking
        if (styles.pointerEvents === 'auto') {
            console.error('❌ POPUP OVERLAY IS BLOCKING (pointer-events: auto)');
        } else {
            console.log('✅ Popup overlay not blocking (pointer-events:', styles.pointerEvents + ')');
        }
    } else {
        console.log('✅ No popup overlay in DOM');
    }
    
    // 2. Find all elements with pointer-events: auto and high z-index
    console.log('\n🎯 Elements with high z-index that might block:');
    const allElements = document.querySelectorAll('*');
    const blockers = [];
    
    allElements.forEach(el => {
        const styles = window.getComputedStyle(el);
        const zIndex = parseInt(styles.zIndex) || 0;
        
        if (zIndex > 10 && styles.pointerEvents !== 'none' && styles.position === 'fixed') {
            blockers.push({
                element: el,
                id: el.id || 'no-id',
                className: el.className || 'no-class',
                zIndex: zIndex,
                pointerEvents: styles.pointerEvents,
                display: styles.display,
                position: styles.position
            });
        }
    });
    
    blockers.sort((a, b) => b.zIndex - a.zIndex);
    blockers.slice(0, 5).forEach(b => {
        console.log(`- ${b.id || b.className} (z: ${b.zIndex}, pointer: ${b.pointerEvents})`);
    });
    
    // 3. Test space key handling
    console.log('\n⌨️ Testing space key:');
    
    // Create a test input
    const testInput = document.createElement('input');
    testInput.style.position = 'fixed';
    testInput.style.top = '50%';
    testInput.style.left = '50%';
    testInput.style.zIndex = '10000';
    testInput.style.padding = '10px';
    testInput.style.border = '2px solid red';
    testInput.placeholder = 'Type space here to test';
    document.body.appendChild(testInput);
    testInput.focus();
    
    // Listen for space
    testInput.addEventListener('keydown', (e) => {
        if (e.key === ' ') {
            console.log('✅ Space key received in test input');
            e.stopPropagation();
        }
    });
    
    console.log('📝 A red test input appeared - try typing space in it');
    console.log('If space works there but not in notes, something is blocking notes specifically');
    
    // Remove test after 10 seconds
    setTimeout(() => {
        testInput.remove();
        console.log('Test input removed');
    }, 10000);
    
    // 4. Check for global key handlers
    console.log('\n🔍 Checking for global key handlers:');
    
    // Get all event listeners (this only works in Chrome DevTools)
    if (window.getEventListeners) {
        const listeners = getEventListeners(document);
        if (listeners.keydown) {
            console.log('Found', listeners.keydown.length, 'keydown listeners on document');
        }
        const bodyListeners = getEventListeners(document.body);
        if (bodyListeners.keydown) {
            console.log('Found', bodyListeners.keydown.length, 'keydown listeners on body');
        }
    } else {
        console.log('(Use Chrome DevTools to see event listeners)');
    }
    
    // 5. Test if preventDefault is being called
    const originalPreventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function() {
        if (this.key === ' ') {
            console.error('❌ SPACE KEY preventDefault called by:', new Error().stack);
        }
        return originalPreventDefault.call(this);
    };
    
    console.log('\n✅ Monitoring space key - try typing space in a note now');
    console.log('If something calls preventDefault, you\'ll see a stack trace');
})();