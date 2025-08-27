#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Usage Tracker - Learns from actual file usage to improve context selection
 */
class UsageTracker {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.logPath = path.join(contextRoot, 'cache', 'usage-log.json');
    this.patternsPath = path.join(contextRoot, 'cache', 'usage-patterns.json');
    this.lastContextPath = path.join(contextRoot, 'cache', 'last-context.json');
    this.patterns = new Map();
    this.fileScores = new Map();
    this.cooccurrence = new Map();
  }
  
  async initialize() {
    await fs.mkdir(path.join(this.contextRoot, 'cache'), { recursive: true });
    await this.loadPatterns();
    await this.loadScores();
  }
  
  async loadPatterns() {
    try {
      const data = await fs.readFile(this.patternsPath, 'utf8');
      const parsed = JSON.parse(data);
      this.patterns = new Map(Object.entries(parsed.patterns || {}));
      this.cooccurrence = new Map(Object.entries(parsed.cooccurrence || {}));
    } catch (e) {
      // No patterns yet
    }
  }
  
  async loadScores() {
    try {
      const data = await fs.readFile(this.logPath, 'utf8');
      const logs = JSON.parse(data);
      
      // Calculate file usefulness scores
      for (const entry of logs) {
        for (const file of entry.loaded) {
          const score = this.fileScores.get(file) || { loaded: 0, used: 0 };
          score.loaded++;
          if (entry.modified.includes(file)) {
            score.used++;
          }
          this.fileScores.set(file, score);
        }
      }
    } catch (e) {
      // No logs yet
    }
  }
  
  /**
   * Track which files were loaded and which were actually modified
   */
  async trackUsage(loadedFiles, modifiedFiles, task, metadata = {}) {
    const entry = {
      timestamp: Date.now(),
      task,
      loaded: loadedFiles,
      modified: modifiedFiles,
      usefulness: this.calculateUsefulness(loadedFiles, modifiedFiles),
      duration: metadata.duration,
      tokenCount: metadata.tokenCount
    };
    
    // Append to log
    await this.appendLog(entry);
    
    // Update patterns
    await this.updatePatterns(entry);
    
    // Update co-occurrence matrix
    await this.updateCooccurrence(modifiedFiles);
    
    // Save patterns
    await this.savePatterns();
    
    return {
      tracked: true,
      usefulFiles: modifiedFiles.filter(f => loadedFiles.includes(f)),
      wastedFiles: loadedFiles.filter(f => !modifiedFiles.includes(f))
    };
  }
  
  /**
   * Save current context for later tracking
   */
  async saveCurrentContext(files, task) {
    const context = {
      files,
      task,
      timestamp: Date.now()
    };
    
    await fs.writeFile(this.lastContextPath, JSON.stringify(context, null, 2));
  }
  
  /**
   * Calculate usefulness scores for loaded files
   */
  calculateUsefulness(loadedFiles, modifiedFiles) {
    const scores = {};
    
    for (const file of loadedFiles) {
      if (modifiedFiles.includes(file)) {
        scores[file] = 1.0; // Directly modified = highly useful
      } else {
        // Check if file is related to modified files
        let relationScore = 0;
        for (const modFile of modifiedFiles) {
          if (this.areRelated(file, modFile)) {
            relationScore = Math.max(relationScore, 0.5);
          }
        }
        scores[file] = relationScore;
      }
    }
    
    return scores;
  }
  
  /**
   * Check if two files are related
   */
  areRelated(file1, file2) {
    // Same directory
    if (path.dirname(file1) === path.dirname(file2)) return true;
    
    // Test file relationship
    const base1 = path.basename(file1).replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/, '');
    const base2 = path.basename(file2).replace(/\.(test|spec)\.(js|ts|jsx|tsx)$/, '');
    if (base1 === base2) return true;
    
    // Component and style relationship
    if (file1.replace(/\.(jsx?|tsx?)$/, '') === file2.replace(/\.(css|scss|less)$/, '')) return true;
    
    return false;
  }
  
  /**
   * Update usage patterns
   */
  async updatePatterns(entry) {
    // Update file pair patterns
    const usefulFiles = entry.modified.filter(f => entry.loaded.includes(f));
    
    for (let i = 0; i < usefulFiles.length; i++) {
      for (let j = i + 1; j < usefulFiles.length; j++) {
        const pair = [usefulFiles[i], usefulFiles[j]].sort().join('|');
        this.patterns.set(pair, (this.patterns.get(pair) || 0) + 1);
      }
    }
    
    // Update task patterns
    const taskKey = `task:${this.normalizeTask(entry.task)}`;
    const taskFiles = this.patterns.get(taskKey) || [];
    for (const file of usefulFiles) {
      if (!taskFiles.includes(file)) {
        taskFiles.push(file);
      }
    }
    this.patterns.set(taskKey, taskFiles);
  }
  
  /**
   * Update co-occurrence matrix
   */
  async updateCooccurrence(modifiedFiles) {
    for (let i = 0; i < modifiedFiles.length; i++) {
      const file1 = modifiedFiles[i];
      const coMap = this.cooccurrence.get(file1) || {};
      
      for (let j = 0; j < modifiedFiles.length; j++) {
        if (i !== j) {
          const file2 = modifiedFiles[j];
          coMap[file2] = (coMap[file2] || 0) + 1;
        }
      }
      
      this.cooccurrence.set(file1, coMap);
    }
  }
  
  /**
   * Suggest files based on current context
   */
  async suggestFiles(currentFiles, task = null) {
    const suggestions = new Map();
    
    // Pattern-based suggestions
    for (const file of currentFiles) {
      // Find files that often appear together
      const coMap = this.cooccurrence.get(file) || {};
      for (const [relatedFile, count] of Object.entries(coMap)) {
        if (!currentFiles.includes(relatedFile)) {
          suggestions.set(relatedFile, (suggestions.get(relatedFile) || 0) + count);
        }
      }
      
      // Check pair patterns
      for (const [pair, count] of this.patterns) {
        if (pair.includes('|') && pair.includes(file)) {
          const [file1, file2] = pair.split('|');
          const otherFile = file1 === file ? file2 : file1;
          if (!currentFiles.includes(otherFile)) {
            suggestions.set(otherFile, (suggestions.get(otherFile) || 0) + count);
          }
        }
      }
    }
    
    // Task-based suggestions
    if (task) {
      const taskKey = `task:${this.normalizeTask(task)}`;
      const taskFiles = this.patterns.get(taskKey) || [];
      for (const file of taskFiles) {
        if (!currentFiles.includes(file)) {
          suggestions.set(file, (suggestions.get(file) || 0) + 10); // Higher weight for task matches
        }
      }
    }
    
    // Score-based filtering
    const scoredSuggestions = [];
    for (const [file, weight] of suggestions) {
      const score = this.fileScores.get(file);
      if (score && score.used > 0) {
        const usefulness = score.used / score.loaded;
        scoredSuggestions.push({
          file,
          weight,
          usefulness,
          finalScore: weight * usefulness
        });
      }
    }
    
    // Sort by final score
    scoredSuggestions.sort((a, b) => b.finalScore - a.finalScore);
    
    return scoredSuggestions.slice(0, 10).map(s => s.file);
  }
  
  /**
   * Get file usefulness score
   */
  getFileScore(file) {
    const score = this.fileScores.get(file);
    if (!score || score.loaded === 0) return 0;
    return score.used / score.loaded;
  }
  
  /**
   * Normalize task string for pattern matching
   */
  normalizeTask(task) {
    return task
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
  
  /**
   * Append to usage log
   */
  async appendLog(entry) {
    let logs = [];
    try {
      const data = await fs.readFile(this.logPath, 'utf8');
      logs = JSON.parse(data);
    } catch (e) {
      // No logs yet
    }
    
    logs.push(entry);
    
    // Keep only last 1000 entries
    if (logs.length > 1000) {
      logs = logs.slice(-1000);
    }
    
    await fs.writeFile(this.logPath, JSON.stringify(logs, null, 2));
  }
  
  /**
   * Save patterns to disk
   */
  async savePatterns() {
    const data = {
      patterns: Object.fromEntries(this.patterns),
      cooccurrence: Object.fromEntries(this.cooccurrence),
      updated: new Date().toISOString()
    };
    
    await fs.writeFile(this.patternsPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * Get usage statistics
   */
  getStats() {
    const stats = {
      totalFiles: this.fileScores.size,
      totalPatterns: this.patterns.size,
      avgUsefulness: 0,
      mostUseful: [],
      leastUseful: []
    };
    
    // Calculate average usefulness
    let totalUsefulness = 0;
    const fileUsefulnessArray = [];
    
    for (const [file, score] of this.fileScores) {
      if (score.loaded > 0) {
        const usefulness = score.used / score.loaded;
        totalUsefulness += usefulness;
        fileUsefulnessArray.push({ file, usefulness, loaded: score.loaded });
      }
    }
    
    stats.avgUsefulness = totalUsefulness / fileUsefulnessArray.length;
    
    // Sort by usefulness
    fileUsefulnessArray.sort((a, b) => b.usefulness - a.usefulness);
    
    // Get most and least useful files (with minimum load count)
    stats.mostUseful = fileUsefulnessArray
      .filter(f => f.loaded >= 3)
      .slice(0, 10)
      .map(f => ({ file: f.file, usefulness: f.usefulness }));
    
    stats.leastUseful = fileUsefulnessArray
      .filter(f => f.loaded >= 3)
      .slice(-10)
      .map(f => ({ file: f.file, usefulness: f.usefulness }));
    
    return stats;
  }
  
  /**
   * Prune old or irrelevant patterns
   */
  async prunePatterns() {
    const prunedPatterns = new Map();
    const prunedCooccurrence = new Map();
    
    // Keep only patterns with sufficient occurrences
    for (const [pattern, count] of this.patterns) {
      if (count >= 2) {
        prunedPatterns.set(pattern, count);
      }
    }
    
    // Keep only co-occurrences with sufficient count
    for (const [file, coMap] of this.cooccurrence) {
      const prunedCoMap = {};
      for (const [relatedFile, count] of Object.entries(coMap)) {
        if (count >= 2) {
          prunedCoMap[relatedFile] = count;
        }
      }
      if (Object.keys(prunedCoMap).length > 0) {
        prunedCooccurrence.set(file, prunedCoMap);
      }
    }
    
    this.patterns = prunedPatterns;
    this.cooccurrence = prunedCooccurrence;
    
    await this.savePatterns();
  }
}

module.exports = UsageTracker;