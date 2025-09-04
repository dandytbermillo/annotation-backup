/**
 * Semantic Pre-check Module
 * Validates command relevance before invoking Claude to save tokens
 */

class SemanticPrecheck {
  constructor() {
    // Command patterns that should always use Claude
    this.claudeRequired = [
      /analyze/i,
      /review/i,
      /understand/i,
      /explain/i,
      /suggest/i,
      /improve/i
    ];
    
    // Patterns that never need Claude
    this.claudeNotNeeded = [
      /^\/validate/,
      /^\/execute.*--slug/,  // Has explicit slug
      /^\/status/,
      /^\/list/
    ];
    
    // Feature existence cache
    this.featureCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }
  
  /**
   * Pre-check if Claude is needed for this command
   */
  async shouldUseClaude(command, context = {}) {
    const checks = {
      needed: false,
      reason: null,
      confidence: 0,
      suggestions: []
    };
    
    // Check explicit patterns
    if (this.claudeNotNeeded.some(p => p.test(command))) {
      checks.reason = 'Command can be handled locally';
      checks.confidence = 1.0;
      return checks;
    }
    
    if (this.claudeRequired.some(p => p.test(command))) {
      checks.needed = true;
      checks.reason = 'Command requires semantic analysis';
      checks.confidence = 0.9;
      return checks;
    }
    
    // Check for ambiguous inputs
    const ambiguityScore = this.calculateAmbiguity(command);
    if (ambiguityScore > 0.7) {
      checks.needed = true;
      checks.reason = 'Command is ambiguous, Claude can help clarify';
      checks.confidence = ambiguityScore;
      checks.suggestions.push('Consider being more specific to avoid Claude invocation');
    }
    
    // Check for feature existence
    const featureMatch = command.match(/--feature\s+(\S+)/);
    if (featureMatch) {
      const exists = await this.checkFeatureExists(featureMatch[1]);
      if (!exists) {
        checks.suggestions.push(`Feature '${featureMatch[1]}' not found locally`);
        checks.needed = true;
        checks.reason = 'Claude may help identify correct feature name';
        checks.confidence = 0.6;
      }
    }
    
    return checks;
  }
  
  /**
   * Calculate ambiguity score (0-1, higher = more ambiguous)
   */
  calculateAmbiguity(command) {
    let score = 0;
    
    // Check for vague terms
    const vagueTerms = ['something', 'stuff', 'thing', 'whatever', 'maybe', 'probably'];
    vagueTerms.forEach(term => {
      if (command.includes(term)) score += 0.2;
    });
    
    // Check for missing required arguments
    if (command.includes('--feature') && !command.match(/--feature\s+\S+/)) {
      score += 0.3;
    }
    
    // Check for typos (simple heuristic)
    const words = command.split(/\s+/);
    const misspelledCount = words.filter(w => this.looksMisspelled(w)).length;
    score += (misspelledCount / words.length) * 0.5;
    
    return Math.min(score, 1.0);
  }
  
  /**
   * Simple misspelling detection
   */
  looksMisspelled(word) {
    // Common command words that should be spelled correctly
    const commonWords = ['execute', 'validate', 'feature', 'issue', 'apply', 'strict'];
    
    // Check for close matches (Levenshtein distance)
    return commonWords.some(correct => {
      const distance = this.levenshteinDistance(word.toLowerCase(), correct);
      return distance > 0 && distance <= 2; // Close but not exact
    });
  }
  
  /**
   * Calculate Levenshtein distance between two strings
   */
  levenshteinDistance(a, b) {
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }
  
  /**
   * Check if feature exists (with caching)
   */
  async checkFeatureExists(slug) {
    // Check cache first
    const cached = this.featureCache.get(slug);
    if (cached && Date.now() - cached.time < this.cacheTimeout) {
      return cached.exists;
    }
    
    // Check filesystem
    const fs = require('fs');
    const path = require('path');
    const featurePath = path.join('../docs/proposal', slug);
    const exists = fs.existsSync(featurePath);
    
    // Update cache
    this.featureCache.set(slug, {
      exists,
      time: Date.now()
    });
    
    return exists;
  }
  
  /**
   * Generate token savings report
   */
  generateSavingsReport(precheckResults) {
    const avgTokensPerClaudeCall = 500; // Estimate
    const tokenPrice = 0.000015; // Per token estimate
    
    if (!precheckResults.needed) {
      return {
        tokensSaved: avgTokensPerClaudeCall,
        costSaved: avgTokensPerClaudeCall * tokenPrice,
        reason: precheckResults.reason
      };
    }
    
    return {
      tokensSaved: 0,
      costSaved: 0,
      reason: 'Claude invocation necessary'
    };
  }
}

module.exports = { SemanticPrecheck };