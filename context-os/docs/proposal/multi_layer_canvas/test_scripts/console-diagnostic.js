// RUN THIS IN BROWSER CONSOLE at http://localhost:3000
// After opening some popups

(async function diagnosePopupOverlay() {
    console.log('🔍 POPUP OVERLAY DIAGNOSTIC\n');
    
    // 1. Check if PopupOverlay exists
    const overlay = document.querySelector('#popup-overlay');
    if (!overlay) {
        console.error('❌ PopupOverlay NOT FOUND - Component not rendered');
        console.log('Possible causes:');
        console.log('- Feature flag disabled');
        console.log('- Component not mounting');
        console.log('- Conditional render failing');
        return;
    }
    
    console.log('✅ PopupOverlay found');
    
    // 2. Check overlay styles
    const styles = window.getComputedStyle(overlay);
    console.log('\n📊 Overlay Styles:');
    console.log('- z-index:', styles.zIndex);
    console.log('- pointer-events:', styles.pointerEvents);
    console.log('- left:', styles.left);
    console.log('- position:', styles.position);
    
    // 3. Check transform container
    const container = overlay.querySelector('.absolute.inset-0');
    if (!container) {
        console.error('❌ Transform container NOT FOUND');
        return;
    }
    console.log('\n✅ Transform container found');
    console.log('- Transform:', container.style.transform || 'none');
    console.log('- Will-change:', container.style.willChange || 'none');
    
    // 4. Check popups
    const popups = overlay.querySelectorAll('.popup-card');
    console.log('\n📦 Popups:', popups.length);
    
    if (popups.length === 0) {
        console.warn('⚠️ No popups found - open some popups first');
        return;
    }
    
    // 5. Check if popups are inside container
    popups.forEach((popup, i) => {
        const isInsideContainer = popup.parentElement === container || 
                                 popup.parentElement?.parentElement === container;
        console.log(`- Popup ${i+1}: ${isInsideContainer ? '✅ Inside container' : '❌ NOT inside container'}`);
        console.log(`  Position: left=${popup.style.left}, top=${popup.style.top}`);
    });
    
    // 6. Test pointer events
    console.log('\n🖱️ Testing Pointer Events...');
    
    let eventCaptured = false;
    const testHandler = (e) => {
        eventCaptured = true;
        console.log('✅ Pointer event captured:', e.type);
    };
    
    overlay.addEventListener('pointerdown', testHandler, { once: true });
    
    // Simulate event
    const rect = overlay.getBoundingClientRect();
    const event = new PointerEvent('pointerdown', {
        clientX: rect.left + 400,
        clientY: rect.top + 300,
        bubbles: true
    });
    
    overlay.dispatchEvent(event);
    
    setTimeout(() => {
        if (!eventCaptured) {
            console.error('❌ Pointer events NOT working');
        }
        
        // 7. Check recent logs
        console.log('\n📝 Fetching recent debug logs...');
        fetch('/api/debug-log')
            .then(r => r.json())
            .then(data => {
                const popupLogs = data.logs.filter(log => 
                    log.context === 'PopupOverlay' || 
                    log.metadata?.context === 'PopupOverlay'
                );
                
                if (popupLogs.length === 0) {
                    console.error('❌ No PopupOverlay logs found in database');
                    console.log('This means the component is not logging properly');
                } else {
                    console.log(`✅ Found ${popupLogs.length} PopupOverlay logs`);
                    console.log('Recent events:');
                    popupLogs.slice(0, 5).forEach(log => {
                        console.log(`- ${log.action || log.metadata?.event}: ${JSON.stringify(log.metadata)}`);
                    });
                }
                
                console.log('\n🎯 DIAGNOSIS COMPLETE');
                console.log('If dragging doesn\'t work, the issue is likely:');
                console.log('1. PopupOverlay not mounting (check feature flag)');
                console.log('2. Pointer events blocked (check z-index/pointer-events)');
                console.log('3. Transform not updating (check event handlers)');
            });
    }, 100);
})();