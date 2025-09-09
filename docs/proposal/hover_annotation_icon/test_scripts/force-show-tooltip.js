// Force show a tooltip to test if CSS is working
// Run this in browser console

console.log('=== FORCE SHOW TOOLTIP TEST ===');

// Remove any existing test tooltip
const existing = document.querySelector('#test-tooltip');
if (existing) existing.remove();

// Create a test tooltip
const tooltip = document.createElement('div');
tooltip.id = 'test-tooltip';
tooltip.className = 'annotation-tooltip visible'; // Add visible class immediately
tooltip.innerHTML = `
    <div class="tooltip-header">
        <span class="tooltip-icon">📝</span>
        <span class="tooltip-title">Test Tooltip</span>
    </div>
    <div class="tooltip-content">This is a test tooltip to verify CSS works</div>
    <div class="tooltip-footer">If you see this, CSS is working!</div>
`;

// Add to body
document.body.appendChild(tooltip);

// Position in center of screen
tooltip.style.position = 'fixed';
tooltip.style.top = '50%';
tooltip.style.left = '50%';
tooltip.style.transform = 'translate(-50%, -50%)';

// Check computed styles
const styles = window.getComputedStyle(tooltip);
console.log('Tooltip computed styles:', {
    visibility: styles.visibility,
    opacity: styles.opacity,
    display: styles.display,
    pointerEvents: styles.pointerEvents,
    position: styles.position,
    zIndex: styles.zIndex
});

// Check if visible
const isVisible = styles.visibility === 'visible' && styles.opacity !== '0';
if (isVisible) {
    console.log('✅ SUCCESS: Tooltip is visible! CSS is working.');
    console.log('The issue is likely with:');
    console.log('1. Branch data not being found');
    console.log('2. BranchId not being passed correctly');
    console.log('3. The showAnnotationTooltip function not being called');
} else {
    console.log('❌ FAIL: Tooltip is not visible even with .visible class!');
    console.log('The CSS is broken. Check:');
    console.log('1. CSS specificity conflicts');
    console.log('2. Missing CSS rules');
    console.log('3. CSS not being loaded');
}

// Also create a hover icon for testing
const hoverIcon = document.querySelector('.annotation-hover-icon');
if (hoverIcon) {
    console.log('\n=== HOVER ICON TEST ===');
    console.log('Setting test data on hover icon...');
    hoverIcon.setAttribute('data-branch-id', 'test-branch-123');
    hoverIcon.setAttribute('data-annotation-type', 'note');
    console.log('Hover icon attributes set:', {
        'data-branch-id': hoverIcon.getAttribute('data-branch-id'),
        'data-annotation-type': hoverIcon.getAttribute('data-annotation-type')
    });
    console.log('Now hover over the 🔎 icon and check console for [HoverIcon] logs');
} else {
    console.log('\nNo hover icon found. Hover over an annotation first.');
}

console.log('\n=== END TEST ===');