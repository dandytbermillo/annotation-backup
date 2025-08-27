#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Knowledge Manager - Handles knowledge base with similarity detection and merging
 */
class KnowledgeManager {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.knowledgeRoot = path.join(contextRoot, 'knowledge');
    this.index = new Map();
    this.graph = new Map();
    this.vectorCache = new Map();
  }

  async initialize() {
    // Ensure knowledge directories exist
    const categories = ['patterns', 'errors', 'decisions', 'performance', 'general'];
    for (const cat of categories) {
      await fs.mkdir(path.join(this.knowledgeRoot, cat), { recursive: true });
    }
    
    // Load existing index
    await this.loadIndex();
    
    // Build knowledge graph
    await this.buildKnowledgeGraph();
  }

  /**
   * Add new learning with auto-categorization and similarity detection
   */
  async addLearning(content, metadata = {}) {
    // Detect category
    const category = this.detectCategory(content);
    
    // Generate embedding for similarity
    const embedding = this.generateEmbedding(content);
    
    // Find similar entries
    const similar = await this.findSimilar(embedding, 0.8);
    
    if (similar.length > 0) {
      // Merge with most similar
      const merged = await this.mergeKnowledge(similar[0], content, metadata);
      return { action: 'merged', id: similar[0].id, category };
    } else {
      // Add as new entry
      const id = this.generateId(content);
      const entry = {
        id,
        category,
        content,
        metadata: {
          ...metadata,
          created: new Date().toISOString(),
          embedding: embedding,
          usage: 0,
          confidence: 1.0
        }
      };
      
      await this.saveEntry(entry);
      await this.updateIndex(entry);
      await this.updateGraph(entry);
      
      return { action: 'added', id, category };
    }
  }

  /**
   * Detect category based on content
   */
  detectCategory(content) {
    const settings = require(path.join(this.contextRoot, 'config', 'settings.json'));
    const categories = settings.knowledge.categories;
    
    const scores = {};
    
    for (const [cat, config] of Object.entries(categories)) {
      scores[cat] = 0;
      for (const keyword of config.keywords) {
        if (content.toLowerCase().includes(keyword)) {
          scores[cat] += 1;
        }
      }
    }
    
    // Find highest scoring category
    let maxScore = 0;
    let bestCategory = 'general';
    
    for (const [cat, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestCategory = cat;
      }
    }
    
    return bestCategory;
  }

  /**
   * Generate embedding for content (simplified version)
   */
  generateEmbedding(content) {
    // Simple bag-of-words embedding
    // In production, use a proper embedding model
    const words = content.toLowerCase().split(/\s+/);
    const wordFreq = {};
    
    for (const word of words) {
      if (word.length > 3) { // Skip short words
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }
    
    // Convert to vector
    const vector = [];
    const sortedWords = Object.keys(wordFreq).sort();
    
    for (const word of sortedWords.slice(0, 100)) { // Top 100 words
      vector.push(wordFreq[word]);
    }
    
    // Normalize
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / magnitude);
  }

  /**
   * Find similar knowledge entries
   */
  async findSimilar(embedding, threshold = 0.8) {
    const similar = [];
    
    for (const [id, entry] of this.index) {
      if (entry.metadata.embedding) {
        const similarity = this.cosineSimilarity(embedding, entry.metadata.embedding);
        if (similarity >= threshold) {
          similar.push({ ...entry, similarity });
        }
      }
    }
    
    return similar.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Calculate cosine similarity between vectors
   */
  cosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) return 0;
    
    let dotProduct = 0;
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
    }
    
    return dotProduct; // Assuming normalized vectors
  }

  /**
   * Merge knowledge entries
   */
  async mergeKnowledge(existing, newContent, newMetadata) {
    // Combine content intelligently
    const mergedContent = this.intelligentMerge(existing.content, newContent);
    
    // Update metadata
    existing.content = mergedContent;
    existing.metadata.updated = new Date().toISOString();
    existing.metadata.mergeCount = (existing.metadata.mergeCount || 0) + 1;
    existing.metadata.confidence = Math.min(existing.metadata.confidence * 1.1, 5.0);
    
    // Merge metadata
    if (newMetadata.source) {
      existing.metadata.sources = existing.metadata.sources || [];
      existing.metadata.sources.push(newMetadata.source);
    }
    
    // Save updated entry
    await this.saveEntry(existing);
    await this.updateIndex(existing);
    
    return existing;
  }

  /**
   * Intelligent content merging
   */
  intelligentMerge(existing, new_content) {
    // Extract key points from both
    const existingPoints = this.extractKeyPoints(existing);
    const newPoints = this.extractKeyPoints(new_content);
    
    // Combine unique points
    const allPoints = new Set([...existingPoints, ...newPoints]);
    
    // Reconstruct content
    let merged = `# Knowledge Entry\n\n`;
    merged += `## Key Points\n`;
    
    for (const point of allPoints) {
      merged += `- ${point}\n`;
    }
    
    // Add examples if present
    const existingExamples = this.extractExamples(existing);
    const newExamples = this.extractExamples(new_content);
    
    if (existingExamples.length > 0 || newExamples.length > 0) {
      merged += `\n## Examples\n`;
      for (const example of [...existingExamples, ...newExamples]) {
        merged += `\n${example}\n`;
      }
    }
    
    // Add original content as context
    merged += `\n## Context\n`;
    merged += `### Previous Understanding\n${existing}\n`;
    merged += `### New Information\n${new_content}\n`;
    
    return merged;
  }

  /**
   * Extract key points from content
   */
  extractKeyPoints(content) {
    const points = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Look for bullet points, numbered lists, or key phrases
      if (line.match(/^[-*•]\s+/) || line.match(/^\d+\.\s+/) || line.includes(':')) {
        points.push(line.trim().replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, ''));
      }
    }
    
    return points;
  }

  /**
   * Extract code examples
   */
  extractExamples(content) {
    const examples = [];
    const codeBlockRegex = /```[\s\S]*?```/g;
    const matches = content.match(codeBlockRegex);
    
    if (matches) {
      examples.push(...matches);
    }
    
    return examples;
  }

  /**
   * Search knowledge base
   */
  async searchKnowledge(query, options = {}) {
    const queryEmbedding = this.generateEmbedding(query);
    const results = [];
    
    // Search by similarity
    const similar = await this.findSimilar(queryEmbedding, options.minScore || 0.3);
    
    // Apply weighting
    for (const item of similar) {
      let score = item.similarity;
      
      // Weight by recency
      const age = Date.now() - new Date(item.metadata.updated || item.metadata.created).getTime();
      const ageWeight = Math.exp(-age / (30 * 24 * 60 * 60 * 1000)); // Decay over 30 days
      score *= (1 + ageWeight * 0.5);
      
      // Weight by usage
      const usageWeight = Math.log(item.metadata.usage + 1) / 10;
      score *= (1 + usageWeight);
      
      // Weight by confidence
      score *= item.metadata.confidence || 1;
      
      results.push({ ...item, score });
    }
    
    // Sort by weighted score
    results.sort((a, b) => b.score - a.score);
    
    // Apply limit
    return results.slice(0, options.limit || 10);
  }

  /**
   * Build knowledge graph
   */
  async buildKnowledgeGraph() {
    this.graph.clear();
    
    for (const [id, entry] of this.index) {
      const node = {
        id,
        category: entry.category,
        title: this.extractTitle(entry.content),
        connections: new Set()
      };
      
      // Find connections based on shared concepts
      for (const [otherId, otherEntry] of this.index) {
        if (id !== otherId) {
          const similarity = this.conceptSimilarity(entry, otherEntry);
          if (similarity > 0.5) {
            node.connections.add({ id: otherId, weight: similarity });
          }
        }
      }
      
      this.graph.set(id, node);
    }
  }

  /**
   * Calculate concept similarity
   */
  conceptSimilarity(entry1, entry2) {
    // Extract concepts (simplified - in production use NLP)
    const concepts1 = this.extractConcepts(entry1.content);
    const concepts2 = this.extractConcepts(entry2.content);
    
    const intersection = concepts1.filter(c => concepts2.includes(c));
    const union = [...new Set([...concepts1, ...concepts2])];
    
    return intersection.length / union.length;
  }

  /**
   * Extract concepts from content
   */
  extractConcepts(content) {
    // Simple noun extraction (in production, use proper NLP)
    const words = content.toLowerCase().split(/\s+/);
    const concepts = [];
    
    const importantWords = words.filter(w => 
      w.length > 5 && 
      !['should', 'would', 'could', 'might', 'there', 'where', 'which'].includes(w)
    );
    
    return [...new Set(importantWords)];
  }

  /**
   * Extract title from content
   */
  extractTitle(content) {
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('#')) {
        return line.replace(/^#+\s+/, '');
      }
    }
    return content.substring(0, 50) + '...';
  }

  /**
   * Save knowledge entry
   */
  async saveEntry(entry) {
    const filename = `${entry.id}.json`;
    const filepath = path.join(this.knowledgeRoot, entry.category, filename);
    
    await fs.writeFile(filepath, JSON.stringify(entry, null, 2));
  }

  /**
   * Load knowledge index
   */
  async loadIndex() {
    this.index.clear();
    
    const categories = await fs.readdir(this.knowledgeRoot);
    
    for (const category of categories) {
      const categoryPath = path.join(this.knowledgeRoot, category);
      const stat = await fs.stat(categoryPath);
      
      if (stat.isDirectory()) {
        const files = await fs.readdir(categoryPath);
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const filepath = path.join(categoryPath, file);
            const content = await fs.readFile(filepath, 'utf8');
            const entry = JSON.parse(content);
            this.index.set(entry.id, entry);
          }
        }
      }
    }
  }

  /**
   * Update index with new entry
   */
  async updateIndex(entry) {
    this.index.set(entry.id, entry);
    
    // Update search index
    const indexPath = path.join(this.knowledgeRoot, 'index.json');
    const searchIndex = Array.from(this.index.values()).map(e => ({
      id: e.id,
      category: e.category,
      title: this.extractTitle(e.content),
      keywords: this.extractConcepts(e.content),
      updated: e.metadata.updated || e.metadata.created
    }));
    
    await fs.writeFile(indexPath, JSON.stringify(searchIndex, null, 2));
  }

  /**
   * Update knowledge graph
   */
  async updateGraph(entry) {
    // Add node to graph
    const node = {
      id: entry.id,
      category: entry.category,
      title: this.extractTitle(entry.content),
      connections: new Set()
    };
    
    // Find connections
    for (const [otherId, otherNode] of this.graph) {
      if (entry.id !== otherId) {
        const otherEntry = this.index.get(otherId);
        const similarity = this.conceptSimilarity(entry, otherEntry);
        
        if (similarity > 0.5) {
          node.connections.add({ id: otherId, weight: similarity });
          otherNode.connections.add({ id: entry.id, weight: similarity });
        }
      }
    }
    
    this.graph.set(entry.id, node);
  }

  /**
   * Generate unique ID
   */
  generateId(content) {
    const hash = crypto.createHash('md5').update(content).digest('hex');
    return `knowledge-${Date.now()}-${hash.substring(0, 8)}`;
  }

  /**
   * Get knowledge graph visualization data
   */
  async getGraphVisualization() {
    const nodes = [];
    const edges = [];
    
    for (const [id, node] of this.graph) {
      nodes.push({
        id,
        label: node.title,
        category: node.category,
        size: node.connections.size
      });
      
      for (const connection of node.connections) {
        edges.push({
          from: id,
          to: connection.id,
          weight: connection.weight
        });
      }
    }
    
    return { nodes, edges };
  }

  /**
   * Export knowledge base
   */
  async exportKnowledge(format = 'json') {
    const data = {
      version: '1.0',
      exported: new Date().toISOString(),
      entries: Array.from(this.index.values()),
      graph: await this.getGraphVisualization()
    };
    
    if (format === 'markdown') {
      return this.exportAsMarkdown(data);
    }
    
    return JSON.stringify(data, null, 2);
  }

  /**
   * Export as markdown
   */
  exportAsMarkdown(data) {
    let md = `# Knowledge Base Export\n\n`;
    md += `Exported: ${data.exported}\n`;
    md += `Total Entries: ${data.entries.length}\n\n`;
    
    // Group by category
    const byCategory = {};
    for (const entry of data.entries) {
      if (!byCategory[entry.category]) {
        byCategory[entry.category] = [];
      }
      byCategory[entry.category].push(entry);
    }
    
    for (const [category, entries] of Object.entries(byCategory)) {
      md += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;
      
      for (const entry of entries) {
        md += `### ${this.extractTitle(entry.content)}\n`;
        md += entry.content + '\n\n';
        md += `*Usage: ${entry.metadata.usage}, Confidence: ${entry.metadata.confidence}*\n\n`;
      }
    }
    
    return md;
  }
}

module.exports = { KnowledgeManager };