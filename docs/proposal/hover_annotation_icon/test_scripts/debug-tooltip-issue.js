// Debug script to understand why tooltip isn't showing
// Run this in browser console after creating an annotation

console.log('=== TOOLTIP DEBUG SCRIPT ===');

// 1. Check for annotations
const annotations = document.querySelectorAll('.annotation, .annotation-hover-target');
console.log(`Found ${annotations.length} annotation(s)`);

if (annotations.length > 0) {
    const first = annotations[0];
    console.log('First annotation:', {
        className: first.className,
        'data-branch-id': first.getAttribute('data-branch-id'),
        'data-branch': first.getAttribute('data-branch'),
        'data-annotation-type': first.getAttribute('data-annotation-type'),
        'data-type': first.getAttribute('data-type')
    });
    
    // Check if annotation mark has branchId
    const marks = first.querySelectorAll('[data-branch-id], [data-branch]');
    console.log('Elements with branch data inside annotation:', marks.length);
}

// 2. Check for hover icon
const hoverIcon = document.querySelector('.annotation-hover-icon');
if (hoverIcon) {
    console.log('Hover icon found:', {
        display: hoverIcon.style.display,
        'data-branch-id': hoverIcon.getAttribute('data-branch-id'),
        'data-annotation-type': hoverIcon.getAttribute('data-annotation-type')
    });
} else {
    console.log('Hover icon not in DOM');
}

// 3. Check for tooltip element
const tooltip = document.querySelector('.annotation-tooltip');
if (tooltip) {
    console.log('Tooltip found:', {
        className: tooltip.className,
        visibility: window.getComputedStyle(tooltip).visibility,
        opacity: window.getComputedStyle(tooltip).opacity,
        display: window.getComputedStyle(tooltip).display
    });
} else {
    console.log('Tooltip not in DOM');
}

// 4. Check CSS styles
const styleSheets = Array.from(document.styleSheets);
let tooltipStyles = [];
styleSheets.forEach(sheet => {
    try {
        const rules = Array.from(sheet.cssRules || sheet.rules || []);
        rules.forEach(rule => {
            if (rule.selectorText && rule.selectorText.includes('annotation-tooltip')) {
                tooltipStyles.push({
                    selector: rule.selectorText,
                    styles: rule.style.cssText
                });
            }
        });
    } catch (e) {
        // Cross-origin stylesheets might throw
    }
});
console.log('Tooltip CSS rules found:', tooltipStyles.length);
tooltipStyles.forEach(s => console.log(s));

// 5. Manual test - simulate hover
console.log('\n=== MANUAL TEST ===');
console.log('1. Hover over annotated text - look for [showHoverIcon] logs');
console.log('2. Hover over 🔎 icon - look for [HoverIcon] and [showAnnotationTooltip] logs');
console.log('3. Check for any ERROR messages in console');

// 6. Check providers
console.log('\n=== CHECKING PROVIDERS ===');

// Try to get providers
try {
    // Check if CollaborationProvider is available
    if (typeof CollaborationProvider !== 'undefined') {
        const provider = CollaborationProvider.getInstance();
        if (provider && provider.getBranchesMap) {
            const map = provider.getBranchesMap();
            console.log('CollaborationProvider branches:', map.size);
            map.forEach((value, key) => {
                console.log(`  Branch ${key}:`, value);
            });
        }
    } else {
        console.log('CollaborationProvider not defined');
    }
} catch (e) {
    console.log('CollaborationProvider error:', e.message);
}

// Check plain provider through window
if (window.plainProvider) {
    console.log('PlainProvider found on window');
} else {
    console.log('PlainProvider not on window');
}

console.log('\n=== END DEBUG ===');
console.log('Now hover over an annotation and check the console logs above');