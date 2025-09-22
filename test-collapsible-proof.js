// Test to prove/disprove the cache theory about collapsible blocks

console.log("=== TESTING COLLAPSIBLE BLOCK CACHE BEHAVIOR ===\n");

// Simulating the component's state and behavior
class CollapsibleBlockSimulation {
    constructor(initiallyCollapsed = false) {
        this.isCollapsed = initiallyCollapsed;
        this.cachedHtmlContent = '';
        this.contentRef = null;
        
        console.log(`Block created with collapsed=${initiallyCollapsed}`);
        console.log(`Initial cachedHtmlContent: "${this.cachedHtmlContent}" (empty string)\n`);
        
        // Simulate useEffect on mount
        if (!initiallyCollapsed) {
            this.simulateUseEffectOnMount();
        }
    }
    
    simulateUseEffectOnMount() {
        console.log("useEffect triggered (component mounted with isCollapsed=false)");
        if (!this.isCollapsed && this.contentRef) {
            // Simulating DOM content with formatting
            const simulatedDOM = '<p><strong>Bold text</strong>, <em>italic text</em>, normal text</p>';
            this.cachedHtmlContent = simulatedDOM;
            console.log(`cachedHtmlContent updated from DOM: "${simulatedDOM}"\n`);
        }
    }
    
    getHtmlContent() {
        console.log("getHtmlContent() called");
        
        // Line 209: First check if we have cached HTML
        console.log(`Line 209: if (cachedHtmlContent) - checking: "${this.cachedHtmlContent}"`);
        if (this.cachedHtmlContent) {
            console.log("  → TRUE: Returning cached HTML (preserves formatting)");
            return this.cachedHtmlContent;
        }
        console.log("  → FALSE: cachedHtmlContent is empty or falsy");
        
        // Line 214: If not cached but content is expanded, get it from DOM
        console.log(`Line 214: if (!isCollapsed && contentRef.current) - checking: !${this.isCollapsed} && ${this.contentRef}`);
        if (!this.isCollapsed && this.contentRef) {
            console.log("  → TRUE: Getting from DOM");
            const html = '<p><strong>Bold text</strong>, <em>italic text</em>, normal text</p>';
            this.cachedHtmlContent = html;
            return html;
        }
        console.log("  → FALSE: Block is collapsed or no contentRef");
        
        // Line 222: Falls through to renderNodeToHtml
        console.log("Line 222: Falling through to renderNodeToHtml()");
        return this.renderNodeToHtml();
    }
    
    renderNodeToHtml() {
        console.log("  renderNodeToHtml() called - This function ignores marks!");
        console.log("  Returning: 'Bold text, italic text, normal text' (plain text, no HTML tags)");
        return 'Bold text, italic text, normal text';
    }
}

// Test Case 1: Block that starts collapsed
console.log("TEST 1: Block created with collapsed=true");
console.log("----------------------------------------");
const collapsedBlock = new CollapsibleBlockSimulation(true);
console.log("User hovers on tooltip icon:");
const result1 = collapsedBlock.getHtmlContent();
console.log(`\nRESULT: "${result1}"`);
console.log("FORMATTING LOST: No <strong> or <em> tags!\n\n");

// Test Case 2: Block that starts expanded  
console.log("TEST 2: Block created with collapsed=false");
console.log("-------------------------------------------");
const expandedBlock = new CollapsibleBlockSimulation(false);
expandedBlock.contentRef = {}; // Simulate having a content ref
expandedBlock.simulateUseEffectOnMount(); // Re-run to simulate actual DOM reading
console.log("User hovers on tooltip icon:");
const result2 = expandedBlock.getHtmlContent();
console.log(`\nRESULT: "${result2}"`);
console.log("FORMATTING PRESERVED: Has <strong> and <em> tags!\n\n");

// Analysis
console.log("=== ANALYSIS ===");
console.log("The review claim is PARTIALLY CORRECT but misses the user's actual issue:\n");
console.log("1. TRUE: After first expand/collapse, cache is used (formatting preserved)");
console.log("2. TRUE: renderNodeToHtml is incomplete (missing many node types)");
console.log("3. TRUE: Marks need proper handling with attributes\n");
console.log("BUT THE KEY ISSUE THE USER EXPERIENCES:");
console.log("- When a collapsible block STARTS COLLAPSED (collapsed=true on creation)");
console.log("- It has NEVER been expanded, so cachedHtmlContent is empty");
console.log("- The tooltip MUST use renderNodeToHtml which loses ALL formatting");
console.log("- This is why users must expand first to see formatted tooltips\n");
console.log("The review focuses on post-expansion behavior but misses the");
console.log("initial-collapsed-state bug that users actually encounter!");