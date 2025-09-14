// TEST DRAG IN BROWSER CONSOLE
// This will simulate a drag and show if transform updates

(function testDrag() {
    const overlay = document.querySelector('#popup-overlay');
    const container = overlay?.querySelector('.absolute.inset-0');
    
    if (!overlay || !container) {
        console.error('Elements not found');
        return;
    }
    
    console.log('Initial transform:', container.style.transform);
    
    // Get a position on empty space (not on popup)
    const rect = overlay.getBoundingClientRect();
    const startX = rect.left + 400; // Adjust to avoid popup
    const startY = rect.top + 100;
    
    // Create pointer down
    const down = new PointerEvent('pointerdown', {
        clientX: startX,
        clientY: startY,
        pointerId: 1,
        bubbles: true,
        cancelable: true,
        view: window,
        buttons: 1
    });
    
    // Dispatch to target the background, not a popup
    const background = overlay.querySelector('.popup-background') || overlay;
    background.dispatchEvent(down);
    
    console.log('Sent pointerdown');
    
    // Simulate drag with multiple move events
    for (let i = 1; i <= 10; i++) {
        setTimeout(() => {
            const move = new PointerEvent('pointermove', {
                clientX: startX + (i * 10),
                clientY: startY + (i * 5),
                pointerId: 1,
                bubbles: true,
                cancelable: true,
                view: window,
                buttons: 1
            });
            overlay.dispatchEvent(move);
            
            if (i === 5) {
                console.log('Mid-drag transform:', container.style.transform);
            }
        }, i * 50);
    }
    
    // End drag
    setTimeout(() => {
        const up = new PointerEvent('pointerup', {
            clientX: startX + 100,
            clientY: startY + 50,
            pointerId: 1,
            bubbles: true,
            cancelable: true,
            view: window,
            buttons: 0
        });
        overlay.dispatchEvent(up);
        
        console.log('Sent pointerup');
        
        setTimeout(() => {
            const finalTransform = container.style.transform;
            console.log('Final transform:', finalTransform);
            
            if (finalTransform === 'translate3d(0px, 0px, 0px) scale(1)') {
                console.error('❌ Transform did not change - drag is not working');
                console.log('Check browser console for any errors');
                console.log('Check if pointer events are reaching handlers');
            } else {
                console.log('✅ Transform updated successfully!');
            }
        }, 100);
    }, 600);
})();