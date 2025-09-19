#!/usr/bin/env node

console.log('=== Testing when database returns EMPTY ===\n');

class ComponentSimulation {
    constructor() {
        this.isContentLoading = false;
        this.provider = {
            cache: new Map(),
            getDocument: (noteId, panelId) => {
                const key = `${noteId}:${panelId}`;
                const cached = this.provider.cache.get(key);
                console.log(`  provider.getDocument() returns: ${cached ? 'content from cache' : 'null (no cache)'}`);
                return cached || null;
            },
            getDocumentVersion: () => {
                return this.provider.cache.size > 0 ? 1 : 0;
            },
            loadDocument: async (noteId, panelId) => {
                console.log(`  provider.loadDocument() called`);
                await new Promise(resolve => setTimeout(resolve, 50));
                
                // IMPORTANT: Simulate database returning NOTHING (new document)
                console.log(`  Database returned: NOTHING (document doesn't exist yet)`);
                // Cache is NOT updated when database returns nothing
                return null;
            },
            saveDocument: (noteId, panelId, content) => {
                console.log(`  provider.saveDocument() called - saving restored content`);
                const key = `${noteId}:${panelId}`;
                this.provider.cache.set(key, content);
            }
        };
        this.localStorage = {
            backup: JSON.stringify({
                content: { type: 'doc', content: [{ text: 'Recent edits from localStorage' }] },
                timestamp: Date.now() - 30000 // 30 seconds old
            })
        };
    }

    async runFirstUseEffect() {
        console.log('1. First useEffect (content loading)');
        this.isContentLoading = true;
        console.log('  isContentLoading = true');
        
        const result = await this.provider.loadDocument('test', 'main');
        console.log(`  Load complete, result: ${result}`);
        
        this.isContentLoading = false;
        console.log('  isContentLoading = false\n');
    }

    runSecondUseEffect() {
        console.log('2. Second useEffect (localStorage restore check)');
        
        if (!this.isContentLoading && this.localStorage.backup) {
            const existingDoc = this.provider.getDocument('test', 'main');
            const existingVersion = this.provider.getDocumentVersion();
            
            console.log(`  !isContentLoading: true`);
            console.log(`  existingVersion: ${existingVersion}`);
            
            if (!existingDoc && existingVersion === 0) {
                console.log('  ✅ RESTORING localStorage backup!');
                const { content } = JSON.parse(this.localStorage.backup);
                this.provider.saveDocument('test', 'main', content);
                console.log('  localStorage cleared after restore');
                this.localStorage.backup = null;
            } else {
                console.log('  ❌ Not restoring (provider has content or version > 0)');
            }
        } else {
            console.log(`  Skipping: isContentLoading=${this.isContentLoading}, hasBackup=${!!this.localStorage.backup}`);
        }
        console.log('');
    }

    async simulate() {
        console.log('=== Page Load Sequence ===\n');
        
        // Initial render
        const loadPromise = this.runFirstUseEffect();
        this.runSecondUseEffect();
        
        await loadPromise;
        
        // After loading completes
        this.runSecondUseEffect();
        
        console.log('=== Result ===');
        const final = this.provider.getDocument('test', 'main');
        if (final) {
            console.log('User sees: Content from localStorage backup (their recent edits)');
        } else {
            console.log('User sees: Empty document');
        }
    }
}

new ComponentSimulation().simulate();