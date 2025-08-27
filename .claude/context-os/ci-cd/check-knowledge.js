#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { KnowledgeManager } = require('../core/knowledge-manager');

/**
 * Check knowledge base consistency for CI/CD
 */
class KnowledgeChecker {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.km = new KnowledgeManager(contextRoot);
    this.issues = [];
  }

  async check() {
    console.log('🧐 Checking knowledge base consistency...');
    
    await this.km.initialize();
    
    // Check for duplicates
    await this.checkDuplicates();
    
    // Check for orphaned entries
    await this.checkOrphans();
    
    // Check index consistency
    await this.checkIndex();
    
    // Check graph connectivity
    await this.checkGraph();
    
    // Report results
    this.reportResults();
    
    return this.issues.length === 0;
  }

  async checkDuplicates() {
    const entries = Array.from(this.km.index.values());
    const duplicates = [];
    
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const similarity = this.km.cosineSimilarity(
          entries[i].metadata.embedding || [],
          entries[j].metadata.embedding || []
        );
        
        if (similarity > 0.95) {
          duplicates.push({
            entry1: entries[i].id,
            entry2: entries[j].id,
            similarity
          });
        }
      }
    }
    
    if (duplicates.length > 0) {
      this.issues.push({
        type: 'duplicates',
        severity: 'warning',
        message: `Found ${duplicates.length} potential duplicate entries`,
        details: duplicates
      });
    }
  }

  async checkOrphans() {
    const knowledgeDir = path.join(this.contextRoot, 'knowledge');
    const orphans = [];
    
    const checkDir = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isFile() && entry.name.endsWith('.json')) {
            const id = entry.name.replace('.json', '');
            if (!this.km.index.has(id)) {
              orphans.push(fullPath);
            }
          } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await checkDir(fullPath);
          }
        }
      } catch {}
    };
    
    await checkDir(knowledgeDir);
    
    if (orphans.length > 0) {
      this.issues.push({
        type: 'orphans',
        severity: 'error',
        message: `Found ${orphans.length} orphaned knowledge files`,
        details: orphans
      });
    }
  }

  async checkIndex() {
    const indexPath = path.join(this.contextRoot, 'knowledge', 'index.json');
    
    try {
      const indexContent = await fs.readFile(indexPath, 'utf8');
      const index = JSON.parse(indexContent);
      
      // Check if all indexed entries exist
      const missing = [];
      for (const entry of index) {
        if (!this.km.index.has(entry.id)) {
          missing.push(entry.id);
        }
      }
      
      if (missing.length > 0) {
        this.issues.push({
          type: 'index',
          severity: 'error',
          message: `Index references ${missing.length} missing entries`,
          details: missing
        });
      }
      
      // Check if all entries are indexed
      const unindexed = [];
      for (const [id, entry] of this.km.index) {
        if (!index.find(e => e.id === id)) {
          unindexed.push(id);
        }
      }
      
      if (unindexed.length > 0) {
        this.issues.push({
          type: 'index',
          severity: 'warning',
          message: `${unindexed.length} entries not in index`,
          details: unindexed
        });
      }
    } catch (error) {
      this.issues.push({
        type: 'index',
        severity: 'error',
        message: 'Failed to read index file',
        details: error.message
      });
    }
  }

  async checkGraph() {
    await this.km.buildKnowledgeGraph();
    
    // Check for isolated nodes
    const isolated = [];
    for (const [id, node] of this.km.graph) {
      if (node.connections.size === 0) {
        isolated.push(id);
      }
    }
    
    if (isolated.length > 5) {
      this.issues.push({
        type: 'graph',
        severity: 'info',
        message: `${isolated.length} isolated knowledge entries`,
        details: isolated.slice(0, 10)
      });
    }
    
    // Check for broken connections
    const broken = [];
    for (const [id, node] of this.km.graph) {
      for (const connection of node.connections) {
        if (!this.km.graph.has(connection.id)) {
          broken.push({ from: id, to: connection.id });
        }
      }
    }
    
    if (broken.length > 0) {
      this.issues.push({
        type: 'graph',
        severity: 'error',
        message: `${broken.length} broken graph connections`,
        details: broken
      });
    }
  }

  reportResults() {
    console.log('\n📊 Knowledge Check Results');
    console.log('========================');
    
    if (this.issues.length === 0) {
      console.log('✅ Knowledge base is consistent');
    } else {
      const errors = this.issues.filter(i => i.severity === 'error');
      const warnings = this.issues.filter(i => i.severity === 'warning');
      const info = this.issues.filter(i => i.severity === 'info');
      
      if (errors.length > 0) {
        console.log(`\n❌ ${errors.length} errors:`);
        for (const issue of errors) {
          console.log(`  - ${issue.message}`);
        }
      }
      
      if (warnings.length > 0) {
        console.log(`\n⚠️  ${warnings.length} warnings:`);
        for (const issue of warnings) {
          console.log(`  - ${issue.message}`);
        }
      }
      
      if (info.length > 0) {
        console.log(`\nℹ️  ${info.length} info:`);
        for (const issue of info) {
          console.log(`  - ${issue.message}`);
        }
      }
    }
    
    // Save report
    const report = {
      timestamp: new Date().toISOString(),
      issues: this.issues,
      passed: this.issues.filter(i => i.severity === 'error').length === 0
    };
    
    const reportsDir = path.join(this.contextRoot, 'reports');
    fs.mkdir(reportsDir, { recursive: true }).then(() => {
      fs.writeFile(
        path.join(reportsDir, 'knowledge-check.json'),
        JSON.stringify(report, null, 2)
      );
    });
  }
}

// Run check
if (require.main === module) {
  const contextRoot = path.join(__dirname, '..');
  const checker = new KnowledgeChecker(contextRoot);
  
  checker.check().then(passed => {
    process.exit(passed ? 0 : 1);
  });
}