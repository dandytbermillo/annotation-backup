/**
 * Context Manager for Claude Code
 * Integrates with Claude's tools to provide intelligent context loading
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface ContextRule {
  name: string;
  when: any;
  load: string[];
  priority: number;
  maxTokens: number;
}

interface LoadedContext {
  file: string;
  content: string;
  tokens: number;
  rule: string;
}

export class ContextManager {
  private rulesPath = '.claude/context-os/rules';
  private contextPath = '.claude/context-os';
  private cache = new Map<string, LoadedContext>();
  private rules: ContextRule[] = [];
  
  constructor() {
    this.loadRules();
  }
  
  /**
   * Load context rules from JSON files
   */
  private loadRules() {
    try {
      // Load default rules
      const defaultRules = JSON.parse(
        fs.readFileSync(path.join(this.rulesPath, 'default.json'), 'utf-8')
      );
      this.rules.push(...defaultRules.rules);
      
      // Load custom rules
      const customPath = path.join(this.rulesPath, 'custom.json');
      if (fs.existsSync(customPath)) {
        const customRules = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
        this.rules.push(...customRules.rules);
      }
      
      // Sort by priority
      this.rules.sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('Failed to load context rules:', error);
    }
  }
  
  /**
   * Get relevant context based on current work
   */
  async getContext(options: {
    command?: string;
    currentFile?: string;
    keywords?: string[];
    maxTokens?: number;
  }): Promise<LoadedContext[]> {
    const maxTokens = options.maxTokens || 8000;
    const context: LoadedContext[] = [];
    let totalTokens = 0;
    
    // Evaluate which rules apply
    for (const rule of this.rules) {
      if (this.ruleMatches(rule, options)) {
        const files = await this.expandFiles(rule.load);
        
        for (const file of files) {
          if (totalTokens >= maxTokens) break;
          
          const loaded = await this.loadFile(file, rule.name);
          if (loaded && totalTokens + loaded.tokens <= maxTokens) {
            context.push(loaded);
            totalTokens += loaded.tokens;
          }
        }
      }
    }
    
    return context;
  }
  
  /**
   * Check if a rule matches current context
   */
  private ruleMatches(rule: ContextRule, options: any): boolean {
    const when = rule.when;
    
    if (when === 'always') return true;
    
    if (typeof when === 'object') {
      // Check command match
      if (when.command && options.command !== when.command) {
        return false;
      }
      
      // Check keywords
      if (when.keywords && options.keywords) {
        const matches = when.keywords.some((kw: string) => 
          options.keywords.some((k: string) => k.includes(kw))
        );
        if (!matches) return false;
      }
      
      // Check file pattern
      if (when.filePattern && options.currentFile) {
        const pattern = new RegExp(when.filePattern.replace('**/', '.*').replace('*', '[^/]*'));
        if (!pattern.test(options.currentFile)) return false;
      }
      
      // Handle OR conditions
      if (when.or) {
        return when.or.some((condition: any) => 
          this.ruleMatches({ ...rule, when: condition }, options)
        );
      }
    }
    
    return true;
  }
  
  /**
   * Expand file patterns to actual files
   */
  private async expandFiles(patterns: string[]): Promise<string[]> {
    const files: string[] = [];
    
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        // Glob pattern
        const matches = await glob(pattern, { cwd: process.cwd() });
        files.push(...matches);
      } else {
        // Direct file
        files.push(pattern);
      }
    }
    
    return files;
  }
  
  /**
   * Load a file and estimate tokens
   */
  private async loadFile(filePath: string, ruleName: string): Promise<LoadedContext | null> {
    try {
      // Check cache first
      if (this.cache.has(filePath)) {
        return this.cache.get(filePath)!;
      }
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const tokens = this.estimateTokens(content);
      
      const loaded: LoadedContext = {
        file: filePath,
        content,
        tokens,
        rule: ruleName
      };
      
      this.cache.set(filePath, loaded);
      return loaded;
    } catch (error) {
      console.error(`Failed to load ${filePath}:`, error);
      return null;
    }
  }
  
  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
  
  /**
   * Add learning to knowledge base
   */
  async addLearning(content: string, category?: string) {
    const timestamp = new Date().toISOString().split('T')[0];
    
    // Auto-detect category if not provided
    if (!category) {
      if (content.toLowerCase().includes('error') || content.toLowerCase().includes('fix')) {
        category = 'errors';
      } else if (content.toLowerCase().includes('pattern') || content.toLowerCase().includes('always')) {
        category = 'patterns';
      } else if (content.toLowerCase().includes('decided') || content.toLowerCase().includes('chose')) {
        category = 'decisions';
      } else {
        category = 'learned';
      }
    }
    
    // Append to appropriate file
    const targetFile = category === 'learned' 
      ? path.join(this.contextPath, 'knowledge', 'learned.md')
      : path.join(this.contextPath, 'knowledge', category, `${timestamp}.md`);
    
    const formattedContent = `\n### ${timestamp}: ${content.split('\n')[0]}\n${content}\n`;
    
    if (fs.existsSync(targetFile)) {
      fs.appendFileSync(targetFile, formattedContent);
    } else {
      fs.writeFileSync(targetFile, `# ${category.charAt(0).toUpperCase() + category.slice(1)}\n${formattedContent}`);
    }
    
    // Update index
    this.updateKnowledgeIndex();
  }
  
  /**
   * Update knowledge index for search
   */
  private updateKnowledgeIndex() {
    // In a real implementation, this would rebuild the search index
    console.log('Knowledge index updated');
  }
  
  /**
   * Search knowledge base
   */
  async searchKnowledge(query: string): Promise<any[]> {
    const results: any[] = [];
    const knowledgePath = path.join(this.contextPath, 'knowledge');
    
    // Simple grep-based search for now
    const files = await glob('**/*.md', { cwd: knowledgePath });
    
    for (const file of files) {
      const content = fs.readFileSync(path.join(knowledgePath, file), 'utf-8');
      if (content.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          file,
          snippet: this.extractSnippet(content, query),
          relevance: this.calculateRelevance(content, query)
        });
      }
    }
    
    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);
    
    return results.slice(0, 10); // Top 10 results
  }
  
  /**
   * Extract snippet around search term
   */
  private extractSnippet(content: string, query: string): string {
    const index = content.toLowerCase().indexOf(query.toLowerCase());
    const start = Math.max(0, index - 100);
    const end = Math.min(content.length, index + query.length + 100);
    return content.slice(start, end).trim();
  }
  
  /**
   * Calculate relevance score
   */
  private calculateRelevance(content: string, query: string): number {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const count = (lowerContent.match(new RegExp(lowerQuery, 'g')) || []).length;
    return count;
  }
}

// Export singleton instance
export const contextManager = new ContextManager();