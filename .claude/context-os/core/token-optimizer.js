#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Token Optimizer - Manages token budgets and smart context loading
 */
class TokenOptimizer {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.rulesPath = path.join(contextRoot, 'rules');
    this.cachePath = path.join(contextRoot, 'cache', 'token-cache.json');
    this.maxTokens = 100000; // Claude's context window
    this.targetUtilization = 0.8; // Use 80% of available tokens
    this.reservedTokens = 5000; // Reserve for responses
  }

  async initialize() {
    await fs.mkdir(path.join(this.contextRoot, 'cache'), { recursive: true });
    
    // Initialize token cache
    try {
      await fs.access(this.cachePath);
    } catch {
      await fs.writeFile(this.cachePath, JSON.stringify({}, null, 2));
    }
  }

  /**
   * Load context with smart token optimization
   */
  async loadOptimizedContext(intent, options = {}) {
    const rules = await this.loadRules();
    const matchingRule = this.findMatchingRule(intent, rules);
    
    if (!matchingRule) {
      console.log('⚠️  No matching rule found, loading default context');
      return await this.loadDefaultContext();
    }
    
    console.log(`🎯 Loading context for: ${intent}`);
    console.log(`  Rule: ${matchingRule.name}`);
    console.log(`  Token budget: ${matchingRule.max_tokens || 'default'}`);
    
    const budget = matchingRule.max_tokens || (this.maxTokens * this.targetUtilization - this.reservedTokens);
    const files = await this.expandFilePatterns(matchingRule.load);
    
    // Calculate token usage for each file
    const fileTokens = await this.calculateFileTokens(files);
    
    // Optimize file selection
    const selectedFiles = await this.optimizeFileSelection(fileTokens, budget, matchingRule.priority);
    
    // Load selected files
    const loadedContext = [];
    let totalTokens = 0;
    
    for (const file of selectedFiles) {
      const content = await this.loadFile(file.path);
      if (content) {
        loadedContext.push({
          path: file.path,
          content,
          tokens: file.tokens
        });
        totalTokens += file.tokens;
      }
    }
    
    // Track metrics
    await this.trackContextLoad(intent, selectedFiles, totalTokens);
    
    console.log(`✓ Loaded ${selectedFiles.length} files (${totalTokens} tokens)`);
    console.log(`  Utilization: ${Math.round(totalTokens / budget * 100)}%`);
    
    return {
      intent,
      files: loadedContext,
      totalTokens,
      budget,
      utilization: totalTokens / budget
    };
  }

  /**
   * Find matching rule for intent
   */
  findMatchingRule(intent, rules) {
    // Direct match
    for (const rule of rules) {
      if (rule.when === intent) {
        return rule;
      }
    }
    
    // Pattern match
    for (const rule of rules) {
      if (rule.when_pattern) {
        const pattern = new RegExp(rule.when_pattern);
        if (pattern.test(intent)) {
          return rule;
        }
      }
    }
    
    // Keyword match
    for (const rule of rules) {
      if (rule.when_keywords) {
        const keywords = rule.when_keywords;
        if (keywords.some(keyword => intent.toLowerCase().includes(keyword))) {
          return rule;
        }
      }
    }
    
    return null;
  }

  /**
   * Expand file patterns to actual files
   */
  async expandFilePatterns(patterns) {
    const files = new Set();
    
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        // Glob pattern
        const expanded = await this.glob(pattern);
        expanded.forEach(file => files.add(file));
      } else if (pattern.includes('#')) {
        // File with section
        files.add(pattern);
      } else if (pattern.includes('{') && pattern.includes('}')) {
        // Template pattern
        const expanded = await this.expandTemplate(pattern);
        expanded.forEach(file => files.add(file));
      } else {
        // Direct file
        files.add(pattern);
      }
    }
    
    return Array.from(files);
  }

  /**
   * Calculate token count for files
   */
  async calculateFileTokens(files) {
    const cache = JSON.parse(await fs.readFile(this.cachePath, 'utf8'));
    const fileTokens = [];
    
    for (const file of files) {
      const filePath = this.resolveFilePath(file);
      
      try {
        const stats = await fs.stat(filePath);
        const cacheKey = `${filePath}:${stats.mtime.getTime()}`;
        
        let tokens;
        if (cache[cacheKey]) {
          tokens = cache[cacheKey];
        } else {
          const content = await fs.readFile(filePath, 'utf8');
          tokens = this.estimateTokens(content);
          cache[cacheKey] = tokens;
        }
        
        fileTokens.push({
          path: file,
          fullPath: filePath,
          tokens,
          size: stats.size,
          modified: stats.mtime
        });
      } catch (error) {
        // File doesn't exist or can't be read
        console.warn(`  ⚠️  Cannot read: ${file}`);
      }
    }
    
    // Save updated cache
    await fs.writeFile(this.cachePath, JSON.stringify(cache, null, 2));
    
    return fileTokens;
  }

  /**
   * Optimize file selection within budget
   */
  async optimizeFileSelection(fileTokens, budget, priorityRules = {}) {
    // Apply priority scores
    const scoredFiles = fileTokens.map(file => {
      let score = 1.0;
      
      // Recent files get higher score
      const age = Date.now() - file.modified.getTime();
      const ageScore = Math.exp(-age / (7 * 24 * 60 * 60 * 1000)); // Decay over 7 days
      score *= (1 + ageScore * 0.5);
      
      // Apply custom priority rules
      if (priorityRules.patterns) {
        for (const [pattern, weight] of Object.entries(priorityRules.patterns)) {
          if (file.path.includes(pattern)) {
            score *= weight;
          }
        }
      }
      
      // Smaller files get slight preference
      const sizeScore = 1 / Math.log(file.tokens + 10);
      score *= (1 + sizeScore * 0.2);
      
      return { ...file, score };
    });
    
    // Sort by score
    scoredFiles.sort((a, b) => b.score - a.score);
    
    // Select files within budget
    const selected = [];
    let totalTokens = 0;
    
    for (const file of scoredFiles) {
      if (totalTokens + file.tokens <= budget) {
        selected.push(file);
        totalTokens += file.tokens;
      } else if (selected.length === 0) {
        // Always include at least one file, even if over budget
        console.warn(`  ⚠️  File exceeds budget: ${file.path} (${file.tokens} tokens)`);
        selected.push(file);
        totalTokens += file.tokens;
        break;
      }
    }
    
    return selected;
  }

  /**
   * Estimate token count for content
   */
  estimateTokens(content) {
    // Rough estimation: ~1 token per 4 characters
    // More accurate would use actual tokenizer
    return Math.ceil(content.length / 4);
  }

  /**
   * Load rules from JSON files
   */
  async loadRules() {
    const rules = [];
    
    // Load default rules
    try {
      const defaultRules = JSON.parse(
        await fs.readFile(path.join(this.rulesPath, 'default.json'), 'utf8')
      );
      rules.push(...defaultRules.rules);
    } catch {}
    
    // Load custom rules
    try {
      const customRules = JSON.parse(
        await fs.readFile(path.join(this.rulesPath, 'custom.json'), 'utf8')
      );
      rules.push(...customRules.rules);
    } catch {}
    
    return rules;
  }

  /**
   * Load default context
   */
  async loadDefaultContext() {
    const files = [
      'project.md',
      'current/active.md',
      'knowledge/index.md'
    ];
    
    const fileTokens = await this.calculateFileTokens(files);
    const budget = this.maxTokens * this.targetUtilization - this.reservedTokens;
    const selected = await this.optimizeFileSelection(fileTokens, budget);
    
    const loadedContext = [];
    let totalTokens = 0;
    
    for (const file of selected) {
      const content = await this.loadFile(file.path);
      if (content) {
        loadedContext.push({
          path: file.path,
          content,
          tokens: file.tokens
        });
        totalTokens += file.tokens;
      }
    }
    
    return {
      intent: 'default',
      files: loadedContext,
      totalTokens,
      budget,
      utilization: totalTokens / budget
    };
  }

  /**
   * Load file with section support
   */
  async loadFile(filePath) {
    const [file, section] = filePath.split('#');
    const fullPath = this.resolveFilePath(file);
    
    try {
      let content = await fs.readFile(fullPath, 'utf8');
      
      if (section) {
        // Extract specific section
        const sectionContent = this.extractSection(content, section);
        if (sectionContent) {
          content = `# From ${file}#${section}\n\n${sectionContent}`;
        }
      }
      
      return content;
    } catch {
      return null;
    }
  }

  /**
   * Extract section from markdown content
   */
  extractSection(content, sectionName) {
    const lines = content.split('\n');
    const sectionStart = lines.findIndex(line => 
      line.toLowerCase().includes(sectionName.toLowerCase()) &&
      line.match(/^#+\s/)
    );
    
    if (sectionStart === -1) return null;
    
    // Find section end
    const sectionLevel = lines[sectionStart].match(/^#+/)[0].length;
    let sectionEnd = lines.findIndex((line, idx) => 
      idx > sectionStart &&
      line.match(/^#+\s/) &&
      line.match(/^#+/)[0].length <= sectionLevel
    );
    
    if (sectionEnd === -1) sectionEnd = lines.length;
    
    return lines.slice(sectionStart, sectionEnd).join('\n');
  }

  /**
   * Resolve file path relative to context root
   */
  resolveFilePath(file) {
    if (file.startsWith('/')) {
      return file;
    }
    return path.join(this.contextRoot, file);
  }

  /**
   * Simple glob implementation
   */
  async glob(pattern) {
    // Very basic glob - in production use proper glob library
    const parts = pattern.split('/');
    const files = [];
    
    const searchDir = async (dir, patternParts, depth = 0) => {
      if (depth >= patternParts.length) return;
      
      const currentPattern = patternParts[depth];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (currentPattern === '*' || currentPattern === '**') {
          if (entry.isDirectory()) {
            await searchDir(path.join(dir, entry.name), patternParts, depth + 1);
            if (currentPattern === '**') {
              await searchDir(path.join(dir, entry.name), patternParts, depth);
            }
          } else if (depth === patternParts.length - 1) {
            files.push(path.relative(this.contextRoot, path.join(dir, entry.name)));
          }
        } else if (currentPattern.includes('*')) {
          // Simple wildcard
          const regex = new RegExp(currentPattern.replace('*', '.*'));
          if (regex.test(entry.name)) {
            if (entry.isDirectory() && depth < patternParts.length - 1) {
              await searchDir(path.join(dir, entry.name), patternParts, depth + 1);
            } else if (!entry.isDirectory() && depth === patternParts.length - 1) {
              files.push(path.relative(this.contextRoot, path.join(dir, entry.name)));
            }
          }
        } else if (entry.name === currentPattern) {
          if (entry.isDirectory() && depth < patternParts.length - 1) {
            await searchDir(path.join(dir, entry.name), patternParts, depth + 1);
          } else if (!entry.isDirectory() && depth === patternParts.length - 1) {
            files.push(path.relative(this.contextRoot, path.join(dir, entry.name)));
          }
        }
      }
    };
    
    await searchDir(this.contextRoot, parts);
    return files;
  }

  /**
   * Expand template patterns
   */
  async expandTemplate(pattern) {
    // Handle patterns like "current/{current_file}"
    const files = [];
    
    if (pattern.includes('{current_file}')) {
      // Get current active file from task manager
      const activeFile = await this.getActiveFile();
      if (activeFile) {
        files.push(pattern.replace('{current_file}', activeFile));
      }
    }
    
    // Add more template expansions as needed
    
    return files;
  }

  /**
   * Get active file (stub)
   */
  async getActiveFile() {
    // In real implementation, would get from task manager
    return 'active.md';
  }

  /**
   * Track context load for metrics
   */
  async trackContextLoad(intent, files, tokens) {
    const { EnhancementAdvisor } = require('./enhancement-advisor');
    const advisor = new EnhancementAdvisor(this.contextRoot);
    await advisor.trackContextLoad(files.map(f => f.path), tokens);
  }

  /**
   * Show token usage statistics
   */
  async showStats() {
    const cache = JSON.parse(await fs.readFile(this.cachePath, 'utf8'));
    const rules = await this.loadRules();
    
    console.log('📦 Token Optimization Stats');
    console.log('========================');
    console.log(`Max tokens: ${this.maxTokens.toLocaleString()}`);
    console.log(`Target utilization: ${this.targetUtilization * 100}%`);
    console.log(`Reserved tokens: ${this.reservedTokens.toLocaleString()}`);
    console.log(`\nRules configured: ${rules.length}`);
    console.log(`Files cached: ${Object.keys(cache).length}`);
    
    // Show rule budgets
    console.log('\nRule Budgets:');
    for (const rule of rules.slice(0, 5)) {
      console.log(`  ${rule.name || rule.when}: ${(rule.max_tokens || 'default').toLocaleString()} tokens`);
    }
  }
}

module.exports = { TokenOptimizer };

// CLI interface
if (require.main === module) {
  const optimizer = new TokenOptimizer(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  (async () => {
    await optimizer.initialize();
    
    switch (command) {
      case 'load':
        const intent = args.join(' ') || 'default';
        const context = await optimizer.loadOptimizedContext(intent);
        console.log(`\nLoaded files:`);
        for (const file of context.files) {
          console.log(`  - ${file.path} (${file.tokens} tokens)`);
        }
        break;
        
      case 'stats':
        await optimizer.showStats();
        break;
        
      default:
        console.log('Usage: token-optimizer [load <intent>|stats]');
    }
  })();
}