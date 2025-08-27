#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Import new modules
const ContextCompressor = require('./context-compressor');
const IncrementalIndexer = require('./incremental-indexer');
const UsageTracker = require('./usage-tracker');
const SemanticAnalyzer = require('./semantic-analyzer');

/**
 * Core Context Manager - Handles all context operations with smart enhancements
 */
class ContextManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.contextRoot = path.join(projectRoot, '.claude', 'context-os');
    this.settings = null;
    this.currentContext = new Map();
    this.tokenCount = 0;
    this.cache = new Map();
    
    // Initialize new modules
    this.compressor = new ContextCompressor();
    this.indexer = new IncrementalIndexer(this.contextRoot);
    this.usageTracker = new UsageTracker(this.contextRoot);
    this.semanticAnalyzer = new SemanticAnalyzer();
  }

  async initialize() {
    // Load settings
    const settingsPath = path.join(this.contextRoot, 'config', 'settings.json');
    this.settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    
    // Ensure required directories exist
    const dirs = ['current', 'knowledge', 'tasks', 'cache', 'team'];
    for (const dir of dirs) {
      await fs.mkdir(path.join(this.contextRoot, dir), { recursive: true });
    }
    
    // Initialize new modules
    await this.indexer.initialize();
    await this.usageTracker.initialize();
    
    // Load current task if exists
    await this.loadCurrentTask();
  }

  /**
   * Smart context loading with all enhancements
   */
  async loadContext(pattern, options = {}) {
    const maxTokens = options.maxTokens || this.settings.core.max_context_tokens;
    const useSmartLoading = options.smart !== false;
    
    // Save context info for usage tracking
    await this.usageTracker.saveCurrentContext([], pattern);
    
    // Clear current context
    this.currentContext.clear();
    this.tokenCount = 0;
    
    if (useSmartLoading) {
      // Use incremental indexer for fast file discovery
      const indexResult = await this.indexer.queryIndex(pattern, maxTokens * 0.7);
      const baseFiles = indexResult.files.map(f => path.join(this.projectRoot, f.path));
      
      // Add semantically related files
      const semanticFiles = new Set(baseFiles);
      for (const file of baseFiles.slice(0, 5)) { // Analyze top 5 files
        const related = await this.semanticAnalyzer.findRelatedFiles(file);
        related.forEach(f => semanticFiles.add(f));
      }
      
      // Add usage-based suggestions
      const suggestions = await this.usageTracker.suggestFiles(Array.from(semanticFiles), pattern);
      suggestions.forEach(f => semanticFiles.add(path.join(this.projectRoot, f)));
      
      // Load and compress files
      for (const file of semanticFiles) {
        if (this.tokenCount >= maxTokens) break;
        
        try {
          const content = await fs.readFile(file, 'utf8');
          const compressed = options.compress !== false ? 
            this.compressor.compressFile(content, file) : content;
          
          const tokens = this.estimateTokens(compressed);
          if (this.tokenCount + tokens <= maxTokens) {
            this.currentContext.set(file, compressed);
            this.tokenCount += tokens;
          }
        } catch (e) {
          // Skip files that can't be read
        }
      }
    } else {
      // Fall back to original rule-based loading
      const rules = await this.getContextRules(pattern);
      
      for (const rule of rules) {
        if (this.tokenCount >= maxTokens) break;
        
        const files = await this.resolvePattern(rule.pattern);
        for (const file of files) {
          if (this.tokenCount >= maxTokens) break;
          
          const content = await this.loadFile(file, maxTokens - this.tokenCount);
          if (content) {
            this.currentContext.set(file, content);
            this.tokenCount += this.estimateTokens(content);
          }
        }
      }
    }
    
    // Add relevant knowledge
    if (options.includeKnowledge !== false) {
      await this.addRelevantKnowledge(pattern, maxTokens - this.tokenCount);
    }
    
    // Update usage tracker with loaded files
    const loadedFiles = Array.from(this.currentContext.keys());
    await this.usageTracker.saveCurrentContext(loadedFiles, pattern);
    
    return {
      files: loadedFiles,
      tokenCount: this.tokenCount,
      context: this.formatContext(),
      compressed: options.compress !== false
    };
  }

  /**
   * Get context loading rules based on pattern
   */
  async getContextRules(pattern) {
    // Check for custom rules
    const rulesPath = path.join(this.contextRoot, 'config', 'context-rules.json');
    try {
      const customRules = JSON.parse(await fs.readFile(rulesPath, 'utf8'));
      const matchingRules = customRules.rules.filter(r => 
        r.pattern.test(pattern) || r.keywords.some(k => pattern.includes(k))
      );
      if (matchingRules.length > 0) return matchingRules;
    } catch (e) {
      // No custom rules
    }
    
    // Default rules based on pattern
    const rules = [];
    
    // Always include project context
    rules.push({ pattern: 'CLAUDE.md', priority: 1 });
    rules.push({ pattern: '.claude/context-os/project.md', priority: 2 });
    
    // Pattern-specific rules
    if (pattern.includes('auth')) {
      rules.push({ pattern: '**/auth/**/*.{ts,tsx,js,jsx}', priority: 3 });
      rules.push({ pattern: '.claude/context-os/knowledge/patterns/auth/*.md', priority: 4 });
    }
    
    if (pattern.includes('test') || pattern.includes('debug')) {
      rules.push({ pattern: '**/*.test.{ts,tsx,js,jsx}', priority: 3 });
      rules.push({ pattern: '.claude/context-os/knowledge/errors/*.md', priority: 4 });
    }
    
    if (pattern.includes('postgres') || pattern.includes('db')) {
      rules.push({ pattern: 'migrations/*.sql', priority: 3 });
      rules.push({ pattern: 'lib/db/**/*.ts', priority: 4 });
    }
    
    // Current task context
    rules.push({ pattern: '.claude/context-os/current/*.md', priority: 5 });
    
    return rules.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Resolve file patterns to actual files
   */
  async resolvePattern(pattern) {
    // Handle special patterns
    if (pattern.startsWith('.claude/')) {
      return [path.join(this.projectRoot, pattern)];
    }
    
    // Use glob for file patterns
    const glob = require('glob');
    return new Promise((resolve, reject) => {
      glob(pattern, { cwd: this.projectRoot, ignore: '**/node_modules/**' }, (err, files) => {
        if (err) reject(err);
        else resolve(files.map(f => path.join(this.projectRoot, f)));
      });
    });
  }

  /**
   * Load file with token limit
   */
  async loadFile(filePath, tokenLimit) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const tokens = this.estimateTokens(content);
      
      if (tokens <= tokenLimit) {
        return content;
      }
      
      // Chunk file if too large
      if (this.settings.core.token_optimization.enabled) {
        return this.chunkContent(content, tokenLimit);
      }
      
      // Simple truncation
      const ratio = tokenLimit / tokens;
      return content.substring(0, Math.floor(content.length * ratio));
    } catch (e) {
      console.error(`Failed to load ${filePath}: ${e.message}`);
      return null;
    }
  }

  /**
   * Add relevant knowledge based on pattern
   */
  async addRelevantKnowledge(pattern, tokenLimit) {
    const knowledgeManager = require('./knowledge-manager');
    const km = new knowledgeManager.KnowledgeManager(this.contextRoot);
    
    const relevant = await km.searchKnowledge(pattern, {
      limit: 10,
      minScore: 0.5
    });
    
    let tokensUsed = 0;
    for (const item of relevant) {
      if (tokensUsed >= tokenLimit) break;
      
      const tokens = this.estimateTokens(item.content);
      if (tokensUsed + tokens <= tokenLimit) {
        this.currentContext.set(item.path, item.content);
        tokensUsed += tokens;
      }
    }
    
    this.tokenCount += tokensUsed;
  }

  /**
   * Estimate token count (rough approximation)
   */
  estimateTokens(text) {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Chunk content intelligently
   */
  chunkContent(content, tokenLimit) {
    const lines = content.split('\n');
    const chunks = [];
    let currentChunk = [];
    let currentTokens = 0;
    
    for (const line of lines) {
      const lineTokens = this.estimateTokens(line);
      if (currentTokens + lineTokens > tokenLimit / 2) {
        chunks.push(currentChunk.join('\n'));
        currentChunk = [line];
        currentTokens = lineTokens;
      } else {
        currentChunk.push(line);
        currentTokens += lineTokens;
      }
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join('\n'));
    }
    
    // Return most relevant chunk (for now, just the first)
    // TODO: Implement relevance scoring
    return chunks[0] || '';
  }

  /**
   * Format context for output
   */
  formatContext() {
    const formatted = [];
    
    for (const [file, content] of this.currentContext) {
      formatted.push(`\n--- File: ${path.relative(this.projectRoot, file)} ---\n${content}`);
    }
    
    return formatted.join('\n\n');
  }

  /**
   * Create a new task
   */
  async createTask(name, type = 'feature') {
    const taskId = this.generateTaskId(name);
    const taskPath = path.join(this.contextRoot, 'current', `${taskId}.md`);
    
    // Get template
    const template = await this.getTaskTemplate(type);
    const content = template.replace(/\{\{name\}\}/g, name)
                           .replace(/\{\{date\}\}/g, new Date().toISOString())
                           .replace(/\{\{type\}\}/g, type);
    
    await fs.writeFile(taskPath, content);
    
    // Update current task
    await this.setCurrentTask(taskId);
    
    return { id: taskId, path: taskPath };
  }

  /**
   * Get task template
   */
  async getTaskTemplate(type) {
    const templatePath = path.join(this.contextRoot, 'templates', `task-${type}.md`);
    try {
      return await fs.readFile(templatePath, 'utf8');
    } catch (e) {
      // Default template
      return `# {{name}}

Type: {{type}}
Created: {{date}}
Status: Active

## Description
<!-- Describe the task -->

## Requirements
<!-- List requirements -->

## Approach
<!-- Describe your approach -->

## Notes
<!-- Add notes as you work -->

## Learnings
<!-- Document what you learn -->
`;
    }
  }

  /**
   * Generate task ID
   */
  generateTaskId(name) {
    const slug = name.toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '');
    const hash = crypto.createHash('md5').update(name).digest('hex').substring(0, 6);
    return `${slug}-${hash}`;
  }

  /**
   * Set current task
   */
  async setCurrentTask(taskId) {
    const statePath = path.join(this.contextRoot, 'state.json');
    let state = {};
    
    try {
      state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    } catch (e) {
      // No state yet
    }
    
    state.currentTask = taskId;
    state.lastModified = new Date().toISOString();
    
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Load current task
   */
  async loadCurrentTask() {
    try {
      const statePath = path.join(this.contextRoot, 'state.json');
      const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
      
      if (state.currentTask) {
        const taskPath = path.join(this.contextRoot, 'current', `${state.currentTask}.md`);
        const content = await fs.readFile(taskPath, 'utf8');
        this.currentContext.set(taskPath, content);
        this.tokenCount += this.estimateTokens(content);
      }
    } catch (e) {
      // No current task
    }
  }

  /**
   * Switch context to different task
   */
  async switchTask(taskId) {
    // Save current context
    await this.saveContext();
    
    // Clear current context
    this.currentContext.clear();
    this.tokenCount = 0;
    
    // Load new task
    await this.setCurrentTask(taskId);
    await this.loadCurrentTask();
    
    // Load task-specific context
    await this.loadContext(taskId);
  }

  /**
   * Save current context
   */
  async saveContext() {
    if (this.currentContext.size === 0) return;
    
    const snapshot = {
      timestamp: new Date().toISOString(),
      files: Array.from(this.currentContext.keys()),
      tokenCount: this.tokenCount
    };
    
    const snapshotPath = path.join(this.contextRoot, 'cache', `snapshot-${Date.now()}.json`);
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
  }

  /**
   * Get usage metrics
   */
  async getMetrics() {
    const metricsPath = path.join(this.contextRoot, 'metrics.json');
    try {
      return JSON.parse(await fs.readFile(metricsPath, 'utf8'));
    } catch (e) {
      return {
        contextSwitches: 0,
        knowledgeReuse: 0,
        tasksCompleted: 0,
        averageTokens: 0
      };
    }
  }

  /**
   * Update metrics
   */
  async updateMetrics(updates) {
    const metrics = await this.getMetrics();
    Object.assign(metrics, updates);
    
    const metricsPath = path.join(this.contextRoot, 'metrics.json');
    await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  }
  
  /**
   * Track usage after task completion
   */
  async trackTaskCompletion(modifiedFiles) {
    try {
      // Get the last saved context
      const lastContextPath = path.join(this.contextRoot, 'cache', 'last-context.json');
      const lastContext = JSON.parse(await fs.readFile(lastContextPath, 'utf8'));
      
      // Track usage
      const result = await this.usageTracker.trackUsage(
        lastContext.files,
        modifiedFiles,
        lastContext.task,
        {
          duration: Date.now() - lastContext.timestamp,
          tokenCount: this.tokenCount
        }
      );
      
      console.log(`📊 Usage tracked: ${result.usefulFiles.length} useful files, ${result.wastedFiles.length} wasted`);
      
      // Update metrics
      await this.updateMetrics({
        contextSwitches: (await this.getMetrics()).contextSwitches + 1,
        knowledgeReuse: result.usefulFiles.length / lastContext.files.length
      });
      
      return result;
    } catch (e) {
      console.warn('Could not track usage:', e.message);
      return null;
    }
  }
  
  /**
   * Get context loading statistics
   */
  async getContextStats() {
    return {
      indexStats: this.indexer.getStats(),
      usageStats: this.usageTracker.getStats(),
      compressionEstimate: {
        javascript: this.compressor.estimateCompressionRatio('.js'),
        typescript: this.compressor.estimateCompressionRatio('.ts'),
        python: this.compressor.estimateCompressionRatio('.py')
      }
    };
  }
}

module.exports = { ContextManager };