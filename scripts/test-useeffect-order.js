#!/usr/bin/env node

console.log('=== Simulating useEffect execution order ===\n');

// Simulate the component state and effects
class ComponentSimulation {
    constructor() {
        this.isContentLoading = false;
        this.provider = {
            cache: new Map(),
            getDocument: (noteId, panelId) => {
                const key = `${noteId}:${panelId}`;
                console.log(`  provider.getDocument() called - cache has: ${this.provider.cache.has(key) ? 'content' : 'nothing'}`);
                return this.provider.cache.get(key) || null;
            },
            getDocumentVersion: () => {
                return this.provider.cache.size > 0 ? 1 : 0;
            },
            loadDocument: async (noteId, panelId) => {
                console.log(`  provider.loadDocument() called - starting async load`);
                // Simulate async database fetch
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Simulate database returning old content
                const content = { type: 'doc', content: [{ text: 'OLD content from database' }] };
                const key = `${noteId}:${panelId}`;
                this.provider.cache.set(key, content);
                console.log(`  provider.loadDocument() completed - cache updated with database content`);
                return content;
            }
        };
        this.localStorage = {
            backup: JSON.stringify({
                content: { type: 'doc', content: [{ text: 'STALE localStorage backup' }] },
                timestamp: Date.now() - 60000 // 1 minute old
            })
        };
    }

    // First useEffect - loads content
    async runFirstUseEffect() {
        console.log('1. First useEffect runs (content loading)');
        console.log('  Setting isContentLoading = true');
        this.isContentLoading = true;
        
        const loadPromise = this.provider.loadDocument('test', 'main');
        
        // This is async, so control returns here
        console.log('  Async load started, useEffect completes\n');
        
        // Wait for load to complete
        await loadPromise;
        console.log('  Setting isContentLoading = false');
        this.isContentLoading = false;
        console.log('  First useEffect async operation complete\n');
    }

    // Second useEffect - localStorage restore check
    runSecondUseEffect() {
        console.log('2. Second useEffect runs (localStorage check)');
        console.log(`  Checking: !isContentLoading = ${!this.isContentLoading}`);
        
        if (!this.isContentLoading && this.localStorage.backup) {
            console.log('  Conditions met, checking provider content...');
            const existingDoc = this.provider.getDocument('test', 'main');
            const existingVersion = this.provider.getDocumentVersion();
            const providerHasContent = !!existingDoc;
            
            console.log(`  Provider has content: ${providerHasContent}`);
            console.log(`  Provider version: ${existingVersion}`);
            
            if (!providerHasContent && existingVersion === 0) {
                console.log('  ✅ Would restore localStorage backup');
            } else {
                console.log('  ❌ Would NOT restore localStorage (provider already has content)');
            }
        } else {
            if (this.isContentLoading) {
                console.log('  ❌ Skipping - content still loading');
            } else {
                console.log('  ❌ Skipping - no localStorage backup');
            }
        }
        console.log('');
    }

    async simulate() {
        console.log('=== Initial render ===');
        // Both effects run on mount
        const firstEffectPromise = this.runFirstUseEffect();
        this.runSecondUseEffect(); // Runs immediately, checks isContentLoading
        
        // Wait for async operations
        await firstEffectPromise;
        
        console.log('=== After isContentLoading changes to false ===');
        // Second effect re-runs due to isContentLoading dependency
        this.runSecondUseEffect();
        
        console.log('=== Final State ===');
        const finalContent = this.provider.getDocument('test', 'main');
        console.log(`Content in provider: ${JSON.stringify(finalContent)}`);
    }
}

const sim = new ComponentSimulation();
sim.simulate().catch(console.error);