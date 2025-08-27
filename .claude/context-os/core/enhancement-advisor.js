#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

/**
 * Progressive Enhancement Advisor - Analyzes usage and suggests improvements
 */
class EnhancementAdvisor {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.metricsPath = path.join(contextRoot, 'cache', 'metrics.json');
    this.suggestionsPath = path.join(contextRoot, 'cache', 'suggestions.json');
    this.thresholds = {
      fileCount: 10,
      totalLines: 2000,
      contextSize: 10000,
      mergeConflicts: 3,
      searchCount: 20,
      taskSwitchTime: 300000, // 5 minutes
      knowledgeAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    };
  }

  async initialize() {
    await fs.mkdir(path.join(this.contextRoot, 'cache'), { recursive: true });
    
    // Initialize metrics if not exists
    try {
      await fs.access(this.metricsPath);
    } catch {
      await this.initializeMetrics();
    }
  }

  async initializeMetrics() {
    const initialMetrics = {
      fileCount: 0,
      totalLines: 0,
      avgContextSize: 0,
      mergeConflicts: 0,
      searchCount: 0,
      taskSwitches: [],
      knowledgeSearches: [],
      contextLoads: [],
      lastAnalysis: new Date().toISOString()
    };
    
    await fs.writeFile(this.metricsPath, JSON.stringify(initialMetrics, null, 2));
  }

  /**
   * Analyze current usage and provide suggestions
   */
  async analyzeUsage() {
    const metrics = await this.collectMetrics();
    const suggestions = [];
    
    // Check file organization
    if (metrics.fileCount > this.thresholds.fileCount) {
      suggestions.push({
        issue: 'Growing file count',
        description: `Your context has ${metrics.fileCount} files (${metrics.totalLines} lines)`,
        severity: 'medium',
        solution: 'Enable auto-organization to keep context manageable',
        command: 'context organize enable',
        benefit: 'Reduces cognitive load and improves file discovery'
      });
    }
    
    // Check context size
    if (metrics.avgContextSize > this.thresholds.contextSize) {
      suggestions.push({
        issue: 'Large context size',
        description: `Average context size is ${Math.round(metrics.avgContextSize)} tokens`,
        severity: 'high',
        solution: 'Enable smart context loading to optimize token usage',
        command: 'context optimize enable',
        benefit: 'Preserves more context window for actual work'
      });
    }
    
    // Check merge conflicts
    if (metrics.mergeConflicts > this.thresholds.mergeConflicts) {
      suggestions.push({
        issue: 'Frequent merge conflicts',
        description: `${metrics.mergeConflicts} conflicts in current/ directory`,
        severity: 'high',
        solution: 'Enable branch-specific task files',
        command: 'context config set tasks.branch_specific true',
        benefit: 'Eliminates task conflicts between branches'
      });
    }
    
    // Check knowledge search patterns
    if (metrics.searchCount > this.thresholds.searchCount) {
      suggestions.push({
        issue: 'Frequent knowledge searches',
        description: `${metrics.searchCount} searches in last week`,
        severity: 'low',
        solution: 'Build knowledge graph for faster access',
        command: 'context knowledge build-graph',
        benefit: 'Instant knowledge discovery through visual graph'
      });
    }
    
    // Check task switching
    if (metrics.avgTaskSwitchTime > this.thresholds.taskSwitchTime) {
      suggestions.push({
        issue: 'Slow task switching',
        description: `Average switch time: ${Math.round(metrics.avgTaskSwitchTime / 1000)}s`,
        severity: 'medium',
        solution: 'Enable task context caching',
        command: 'context config set tasks.cache_context true',
        benefit: 'Instant context restoration when switching tasks'
      });
    }
    
    // Check knowledge freshness
    if (metrics.oldKnowledgeCount > 0) {
      suggestions.push({
        issue: 'Stale knowledge entries',
        description: `${metrics.oldKnowledgeCount} entries older than 30 days`,
        severity: 'low',
        solution: 'Review and update old knowledge',
        command: 'context knowledge review --age 30d',
        benefit: 'Keeps knowledge base relevant and accurate'
      });
    }
    
    // Team collaboration suggestion
    if (metrics.fileCount > 20 && !metrics.teamEnabled) {
      suggestions.push({
        issue: 'Growing project complexity',
        description: 'Project is large enough to benefit from team features',
        severity: 'info',
        solution: 'Enable team collaboration features',
        command: 'context team enable',
        benefit: 'Share patterns and coordinate with team members'
      });
    }
    
    // Save suggestions
    await this.saveSuggestions(suggestions, metrics);
    
    return suggestions;
  }

  /**
   * Collect usage metrics
   */
  async collectMetrics() {
    const metrics = JSON.parse(await fs.readFile(this.metricsPath, 'utf8'));
    
    // Count files and lines
    const currentDir = path.join(this.contextRoot, 'current');
    const knowledgeDir = path.join(this.contextRoot, 'knowledge');
    
    metrics.fileCount = await this.countFiles(this.contextRoot);
    metrics.totalLines = await this.countLines(this.contextRoot);
    
    // Calculate average context size
    if (metrics.contextLoads.length > 0) {
      const recent = metrics.contextLoads.slice(-10);
      metrics.avgContextSize = recent.reduce((sum, load) => sum + load.tokens, 0) / recent.length;
    }
    
    // Count merge conflicts (from git)
    try {
      const conflicts = execSync('git status --porcelain | grep "^UU" | wc -l').toString().trim();
      metrics.mergeConflicts = parseInt(conflicts) || 0;
    } catch {
      metrics.mergeConflicts = 0;
    }
    
    // Calculate average task switch time
    if (metrics.taskSwitches.length > 1) {
      const switches = metrics.taskSwitches.slice(-10);
      let totalTime = 0;
      for (let i = 1; i < switches.length; i++) {
        totalTime += switches[i].duration;
      }
      metrics.avgTaskSwitchTime = totalTime / (switches.length - 1);
    } else {
      metrics.avgTaskSwitchTime = 0;
    }
    
    // Count old knowledge
    metrics.oldKnowledgeCount = await this.countOldKnowledge();
    
    // Check if team is enabled
    metrics.teamEnabled = await this.isTeamEnabled();
    
    // Update last analysis
    metrics.lastAnalysis = new Date().toISOString();
    await fs.writeFile(this.metricsPath, JSON.stringify(metrics, null, 2));
    
    return metrics;
  }

  /**
   * Count files recursively
   */
  async countFiles(dir, count = 0) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          count++;
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          count = await this.countFiles(path.join(dir, entry.name), count);
        }
      }
    } catch {}
    
    return count;
  }

  /**
   * Count total lines
   */
  async countLines(dir, lines = 0) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const content = await fs.readFile(path.join(dir, entry.name), 'utf8');
          lines += content.split('\n').length;
        } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
          lines = await this.countLines(path.join(dir, entry.name), lines);
        }
      }
    } catch {}
    
    return lines;
  }

  /**
   * Count old knowledge entries
   */
  async countOldKnowledge() {
    const knowledgeDir = path.join(this.contextRoot, 'knowledge');
    let oldCount = 0;
    const thirtyDaysAgo = Date.now() - this.thresholds.knowledgeAge;
    
    const checkDir = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.json')) {
            const stats = await fs.stat(path.join(dir, entry.name));
            if (stats.mtime.getTime() < thirtyDaysAgo) {
              oldCount++;
            }
          } else if (entry.isDirectory()) {
            await checkDir(path.join(dir, entry.name));
          }
        }
      } catch {}
    };
    
    await checkDir(knowledgeDir);
    return oldCount;
  }

  /**
   * Check if team features are enabled
   */
  async isTeamEnabled() {
    try {
      await fs.access(path.join(this.contextRoot, 'team', 'team.yaml'));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Track context load
   */
  async trackContextLoad(files, tokens) {
    const metrics = JSON.parse(await fs.readFile(this.metricsPath, 'utf8'));
    
    metrics.contextLoads.push({
      timestamp: new Date().toISOString(),
      files: files.length,
      tokens
    });
    
    // Keep only last 100 loads
    if (metrics.contextLoads.length > 100) {
      metrics.contextLoads = metrics.contextLoads.slice(-100);
    }
    
    await fs.writeFile(this.metricsPath, JSON.stringify(metrics, null, 2));
  }

  /**
   * Track task switch
   */
  async trackTaskSwitch(fromTask, toTask, duration) {
    const metrics = JSON.parse(await fs.readFile(this.metricsPath, 'utf8'));
    
    metrics.taskSwitches.push({
      timestamp: new Date().toISOString(),
      from: fromTask,
      to: toTask,
      duration
    });
    
    // Keep only last 50 switches
    if (metrics.taskSwitches.length > 50) {
      metrics.taskSwitches = metrics.taskSwitches.slice(-50);
    }
    
    await fs.writeFile(this.metricsPath, JSON.stringify(metrics, null, 2));
  }

  /**
   * Track knowledge search
   */
  async trackKnowledgeSearch(query, resultCount) {
    const metrics = JSON.parse(await fs.readFile(this.metricsPath, 'utf8'));
    
    metrics.knowledgeSearches.push({
      timestamp: new Date().toISOString(),
      query,
      resultCount
    });
    metrics.searchCount++;
    
    // Keep only last 100 searches
    if (metrics.knowledgeSearches.length > 100) {
      metrics.knowledgeSearches = metrics.knowledgeSearches.slice(-100);
    }
    
    await fs.writeFile(this.metricsPath, JSON.stringify(metrics, null, 2));
  }

  /**
   * Save suggestions
   */
  async saveSuggestions(suggestions, metrics) {
    const data = {
      timestamp: new Date().toISOString(),
      metrics: {
        fileCount: metrics.fileCount,
        totalLines: metrics.totalLines,
        avgContextSize: metrics.avgContextSize,
        mergeConflicts: metrics.mergeConflicts,
        searchCount: metrics.searchCount
      },
      suggestions,
      implemented: []
    };
    
    await fs.writeFile(this.suggestionsPath, JSON.stringify(data, null, 2));
  }

  /**
   * Get current suggestions
   */
  async getSuggestions() {
    try {
      const data = JSON.parse(await fs.readFile(this.suggestionsPath, 'utf8'));
      return data.suggestions.filter(s => !data.implemented.includes(s.command));
    } catch {
      return [];
    }
  }

  /**
   * Mark suggestion as implemented
   */
  async markImplemented(command) {
    try {
      const data = JSON.parse(await fs.readFile(this.suggestionsPath, 'utf8'));
      if (!data.implemented.includes(command)) {
        data.implemented.push(command);
        await fs.writeFile(this.suggestionsPath, JSON.stringify(data, null, 2));
      }
    } catch {}
  }

  /**
   * Show status with suggestions
   */
  async showStatus() {
    const suggestions = await this.getSuggestions();
    const metrics = JSON.parse(await fs.readFile(this.metricsPath, 'utf8'));
    
    console.log('📊 Context OS Status');
    console.log('==================');
    console.log(`Files: ${metrics.fileCount}`);
    console.log(`Lines: ${metrics.totalLines}`);
    console.log(`Avg Context: ${Math.round(metrics.avgContextSize || 0)} tokens`);
    console.log(`Searches: ${metrics.searchCount} this week`);
    console.log('');
    
    if (suggestions.length > 0) {
      console.log('💡 Suggestions:');
      for (const suggestion of suggestions) {
        console.log(`\n[${suggestion.severity}] ${suggestion.issue}`);
        console.log(`  ${suggestion.description}`);
        console.log(`  ➤ ${suggestion.solution}`);
        console.log(`  Run: ${suggestion.command}`);
      }
    } else {
      console.log('✓ Your context is well-optimized!');
    }
  }
}

module.exports = { EnhancementAdvisor };

// CLI interface
if (require.main === module) {
  const advisor = new EnhancementAdvisor(path.join(__dirname, '..'));
  
  (async () => {
    await advisor.initialize();
    
    const command = process.argv[2];
    
    switch (command) {
      case 'analyze':
        await advisor.analyzeUsage();
        await advisor.showStatus();
        break;
      case 'status':
        await advisor.showStatus();
        break;
      default:
        console.log('Usage: enhancement-advisor [analyze|status]');
    }
  })();
}