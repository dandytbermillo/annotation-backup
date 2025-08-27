#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');
const minimatch = require('minimatch');

/**
 * Incremental Indexer - Efficiently indexes files using git for change detection
 */
class IncrementalIndexer {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.indexPath = path.join(contextRoot, 'cache', 'file-index.json');
    this.index = new Map();
    this.projectRoot = path.dirname(path.dirname(contextRoot));
  }
  
  async initialize() {
    await fs.mkdir(path.join(this.contextRoot, 'cache'), { recursive: true });
    await this.loadIndex();
  }
  
  async loadIndex() {
    try {
      const data = await fs.readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(data);
      this.index = new Map(Object.entries(parsed));
    } catch (e) {
      // Index doesn't exist yet
      this.index = new Map();
    }
  }
  
  async saveIndex() {
    const data = Object.fromEntries(this.index);
    await fs.writeFile(this.indexPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * Update index with only changed files
   */
  async updateIndex() {
    try {
      // Get git file hashes
      const gitFiles = execSync('git ls-files -s', { 
        encoding: 'utf8',
        cwd: this.projectRoot 
      })
        .split('\n')
        .filter(Boolean)
        .map(line => {
          const [mode, hash, stage, ...pathParts] = line.split(/\s+/);
          return { 
            path: pathParts.join(' '), 
            hash,
            mode 
          };
        });
      
      // Track updates
      const updates = [];
      const deletions = [];
      
      // Check for updated files
      for (const { path: filePath, hash, mode } of gitFiles) {
        const existing = this.index.get(filePath);
        if (!existing || existing.hash !== hash) {
          try {
            const fullPath = path.join(this.projectRoot, filePath);
            const stats = await fs.stat(fullPath);
            const content = await fs.readFile(fullPath, 'utf8');
            
            const metadata = {
              hash,
              mode,
              size: stats.size,
              modified: stats.mtime.toISOString(),
              tokens: this.estimateTokens(content),
              lines: content.split('\n').length,
              extension: path.extname(filePath),
              language: this.detectLanguage(filePath),
              hasTests: this.hasTests(filePath, content),
              complexity: this.estimateComplexity(content, filePath)
            };
            
            this.index.set(filePath, metadata);
            updates.push(filePath);
          } catch (e) {
            console.error(`Error indexing ${filePath}:`, e.message);
          }
        }
      }
      
      // Check for deleted files
      const gitFilePaths = new Set(gitFiles.map(f => f.path));
      for (const [filePath] of this.index) {
        if (!gitFilePaths.has(filePath)) {
          this.index.delete(filePath);
          deletions.push(filePath);
        }
      }
      
      if (updates.length > 0 || deletions.length > 0) {
        await this.saveIndex();
        console.log(`📍 Index updated: ${updates.length} files updated, ${deletions.length} deleted`);
      }
      
      return { updates, deletions };
    } catch (e) {
      // Not a git repository or git not available
      console.warn('Git not available, falling back to file system scan');
      return await this.fullScan();
    }
  }
  
  /**
   * Full file system scan (fallback when git not available)
   */
  async fullScan() {
    const updates = [];
    const glob = require('glob');
    
    const files = await new Promise((resolve, reject) => {
      glob('**/*', {
        cwd: this.projectRoot,
        nodir: true,
        ignore: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          '**/.next/**',
          '**/coverage/**'
        ]
      }, (err, files) => {
        if (err) reject(err);
        else resolve(files);
      });
    });
    
    for (const filePath of files) {
      try {
        const fullPath = path.join(this.projectRoot, filePath);
        const stats = await fs.stat(fullPath);
        const content = await fs.readFile(fullPath, 'utf8');
        const hash = crypto.createHash('sha1').update(content).digest('hex');
        
        const existing = this.index.get(filePath);
        if (!existing || existing.hash !== hash) {
          const metadata = {
            hash,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            tokens: this.estimateTokens(content),
            lines: content.split('\n').length,
            extension: path.extname(filePath),
            language: this.detectLanguage(filePath),
            hasTests: this.hasTests(filePath, content),
            complexity: this.estimateComplexity(content, filePath)
          };
          
          this.index.set(filePath, metadata);
          updates.push(filePath);
        }
      } catch (e) {
        // Skip files we can't read
      }
    }
    
    if (updates.length > 0) {
      await this.saveIndex();
    }
    
    return { updates, deletions: [] };
  }
  
  /**
   * Query index with pattern and token budget
   */
  async queryIndex(pattern, tokenBudget) {
    await this.updateIndex();
    
    const matches = [];
    for (const [filePath, metadata] of this.index) {
      if (this.matchesPattern(filePath, pattern)) {
        matches.push({ path: filePath, ...metadata });
      }
    }
    
    // Score and sort by relevance
    const scored = matches.map(file => ({
      ...file,
      score: this.calculateRelevanceScore(file, pattern)
    }));
    
    scored.sort((a, b) => b.score - a.score);
    
    // Select files within token budget
    const selected = [];
    let tokens = 0;
    
    for (const file of scored) {
      if (tokens + file.tokens <= tokenBudget) {
        selected.push(file);
        tokens += file.tokens;
      } else if (file.tokens < tokenBudget * 0.1) {
        // Include small files even if slightly over budget
        selected.push(file);
        tokens += file.tokens;
      }
    }
    
    return {
      files: selected,
      totalTokens: tokens,
      totalMatches: matches.length
    };
  }
  
  /**
   * Pattern matching with support for multiple patterns
   */
  matchesPattern(filePath, pattern) {
    if (typeof pattern === 'string') {
      // Simple string match
      if (pattern.includes('*') || pattern.includes('?')) {
        return minimatch(filePath, pattern);
      }
      return filePath.includes(pattern);
    } else if (Array.isArray(pattern)) {
      // Multiple patterns (OR)
      return pattern.some(p => this.matchesPattern(filePath, p));
    } else if (pattern.include || pattern.exclude) {
      // Complex pattern object
      const included = !pattern.include || 
        pattern.include.some(p => this.matchesPattern(filePath, p));
      const excluded = pattern.exclude && 
        pattern.exclude.some(p => this.matchesPattern(filePath, p));
      return included && !excluded;
    }
    return false;
  }
  
  /**
   * Calculate relevance score for sorting
   */
  calculateRelevanceScore(file, pattern) {
    let score = 0;
    
    // Recency bonus
    const daysSinceModified = (Date.now() - new Date(file.modified)) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 10 - daysSinceModified);
    
    // Language relevance
    if (typeof pattern === 'string') {
      if (pattern.includes('test') && file.hasTests) score += 20;
      if (pattern.includes('component') && file.path.includes('component')) score += 15;
      if (pattern.includes('api') && file.path.includes('api')) score += 15;
    }
    
    // File type priority
    const priorityExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];
    if (priorityExtensions.includes(file.extension)) {
      score += 10;
    }
    
    // Complexity penalty (prefer simpler files first)
    score -= file.complexity * 0.5;
    
    // Size penalty (prefer smaller files)
    if (file.tokens > 5000) score -= 5;
    
    return score;
  }
  
  /**
   * Estimate tokens in content
   */
  estimateTokens(content) {
    // Rough estimate: ~4 characters per token
    return Math.ceil(content.length / 4);
  }
  
  /**
   * Detect programming language from file path
   */
  detectLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const langMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.r': 'r',
      '.m': 'objc',
      '.mm': 'objcpp'
    };
    
    return langMap[ext] || 'unknown';
  }
  
  /**
   * Check if file has tests
   */
  hasTests(filePath, content) {
    // File name indicators
    if (filePath.includes('.test.') || 
        filePath.includes('.spec.') ||
        filePath.includes('__tests__') ||
        filePath.includes('test/')) {
      return true;
    }
    
    // Content indicators
    const testPatterns = [
      /describe\s*\(/,
      /test\s*\(/,
      /it\s*\(/,
      /expect\s*\(/,
      /@Test/,
      /def test_/,
      /func Test/
    ];
    
    return testPatterns.some(pattern => pattern.test(content));
  }
  
  /**
   * Estimate code complexity
   */
  estimateComplexity(content, filePath) {
    let complexity = 0;
    
    // Count control structures
    const controlStructures = [
      /if\s*\(/g,
      /else\s+if\s*\(/g,
      /for\s*\(/g,
      /while\s*\(/g,
      /switch\s*\(/g,
      /catch\s*\(/g
    ];
    
    for (const pattern of controlStructures) {
      const matches = content.match(pattern);
      if (matches) complexity += matches.length;
    }
    
    // Add complexity for deeply nested code
    const lines = content.split('\n');
    let maxIndent = 0;
    for (const line of lines) {
      const indent = line.search(/\S/);
      if (indent > maxIndent) maxIndent = indent;
    }
    complexity += Math.floor(maxIndent / 10);
    
    return complexity;
  }
  
  /**
   * Get statistics about the index
   */
  getStats() {
    const stats = {
      totalFiles: this.index.size,
      totalTokens: 0,
      totalSize: 0,
      byLanguage: {},
      byExtension: {}
    };
    
    for (const [_, metadata] of this.index) {
      stats.totalTokens += metadata.tokens || 0;
      stats.totalSize += metadata.size || 0;
      
      // Count by language
      const lang = metadata.language || 'unknown';
      stats.byLanguage[lang] = (stats.byLanguage[lang] || 0) + 1;
      
      // Count by extension
      const ext = metadata.extension || 'none';
      stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;
    }
    
    return stats;
  }
}

module.exports = IncrementalIndexer;