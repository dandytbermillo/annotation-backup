#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Knowledge Metadata Manager - Tracks confidence, provenance, and usage
 */
class KnowledgeMetadataManager {
  constructor(contextRoot) {
    this.contextRoot = contextRoot;
    this.metadataPath = path.join(contextRoot, 'knowledge', '.metadata');
    this.metadata = new Map();
  }

  async initialize() {
    await fs.mkdir(this.metadataPath, { recursive: true });
    await this.loadMetadata();
  }

  /**
   * Load all metadata
   */
  async loadMetadata() {
    try {
      const files = await fs.readdir(this.metadataPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.metadataPath, file), 'utf8');
          const metadata = JSON.parse(content);
          this.metadata.set(metadata.id, metadata);
        }
      }
    } catch (e) {
      // Directory doesn't exist yet
    }
  }

  /**
   * Create or update metadata for a knowledge entry
   */
  async updateMetadata(entryId, updates = {}) {
    const existing = this.metadata.get(entryId) || this.createDefaultMetadata(entryId);
    
    const metadata = {
      ...existing,
      ...updates,
      id: entryId,
      lastUpdated: new Date().toISOString()
    };
    
    // Update usage stats
    metadata.usage.count = (metadata.usage.count || 0) + (updates.incrementUsage ? 1 : 0);
    if (updates.incrementUsage) {
      metadata.usage.lastUsed = new Date().toISOString();
      metadata.usage.history.push({
        timestamp: metadata.usage.lastUsed,
        context: updates.usageContext || 'unknown'
      });
      
      // Keep only last 100 usage records
      if (metadata.usage.history.length > 100) {
        metadata.usage.history = metadata.usage.history.slice(-100);
      }
    }
    
    // Update confidence if provided
    if (updates.confidence !== undefined) {
      metadata.confidence.score = updates.confidence;
      metadata.confidence.lastEvaluated = new Date().toISOString();
      
      // Track confidence history
      metadata.confidence.history.push({
        timestamp: metadata.confidence.lastEvaluated,
        score: updates.confidence,
        reason: updates.confidenceReason || 'manual update'
      });
      
      // Keep only last 20 confidence updates
      if (metadata.confidence.history.length > 20) {
        metadata.confidence.history = metadata.confidence.history.slice(-20);
      }
    }
    
    // Update provenance
    if (updates.provenance) {
      metadata.provenance = {
        ...metadata.provenance,
        ...updates.provenance
      };
    }
    
    // Save metadata
    this.metadata.set(entryId, metadata);
    await this.saveMetadata(entryId, metadata);
    
    return metadata;
  }

  /**
   * Create default metadata structure
   */
  createDefaultMetadata(entryId) {
    return {
      id: entryId,
      created: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      confidence: {
        score: 1.0, // 0-5 scale
        factors: {
          usage: 0,
          age: 0,
          validation: 0,
          source: 1.0
        },
        lastEvaluated: new Date().toISOString(),
        history: []
      },
      provenance: {
        source: 'manual',
        author: process.env.USER || 'unknown',
        context: null,
        references: [],
        derivedFrom: [],
        validatedBy: []
      },
      usage: {
        count: 0,
        lastUsed: null,
        contexts: {},
        history: []
      },
      quality: {
        completeness: 'unknown', // complete, partial, stub
        accuracy: 'unverified', // verified, unverified, disputed
        relevance: 'unknown', // high, medium, low, obsolete
        lastReviewed: null,
        reviewedBy: null
      },
      relationships: {
        relatedTo: [],
        supersedes: [],
        supersededBy: [],
        conflictsWith: []
      },
      tags: [],
      version: 1
    };
  }

  /**
   * Calculate confidence score based on multiple factors
   */
  async calculateConfidence(entryId) {
    const metadata = this.metadata.get(entryId);
    if (!metadata) return 1.0;
    
    const factors = {
      usage: 0,
      age: 0,
      validation: 0,
      source: 1.0
    };
    
    // Usage factor (0-2 points)
    const usageCount = metadata.usage.count || 0;
    if (usageCount >= 10) factors.usage = 2.0;
    else if (usageCount >= 5) factors.usage = 1.5;
    else if (usageCount >= 2) factors.usage = 1.0;
    else if (usageCount >= 1) factors.usage = 0.5;
    
    // Age factor (0-1 point)
    const ageInDays = (Date.now() - new Date(metadata.created).getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays < 7) factors.age = 0.5; // Too new
    else if (ageInDays < 30) factors.age = 1.0; // Optimal
    else if (ageInDays < 90) factors.age = 0.8; // Getting old
    else if (ageInDays < 365) factors.age = 0.5; // Old
    else factors.age = 0.2; // Very old
    
    // Validation factor (0-1 point)
    if (metadata.quality.accuracy === 'verified') factors.validation = 1.0;
    else if (metadata.quality.accuracy === 'disputed') factors.validation = 0;
    else factors.validation = 0.5;
    
    // Source factor (0-1 point)
    if (metadata.provenance.source === 'automated') factors.source = 0.7;
    else if (metadata.provenance.source === 'imported') factors.source = 0.8;
    else if (metadata.provenance.source === 'team') factors.source = 1.2;
    else factors.source = 1.0; // manual
    
    // Calculate weighted score (0-5 scale)
    const totalScore = factors.usage + factors.age + factors.validation + factors.source;
    const normalizedScore = Math.min(5, Math.max(0, totalScore));
    
    // Update metadata
    await this.updateMetadata(entryId, {
      confidence: normalizedScore,
      confidenceReason: 'automated calculation',
      confidenceFactors: factors
    });
    
    return normalizedScore;
  }

  /**
   * Get provenance chain for an entry
   */
  async getProvenanceChain(entryId) {
    const chain = [];
    const visited = new Set();
    
    async function traverse(id) {
      if (visited.has(id)) return;
      visited.add(id);
      
      const metadata = this.metadata.get(id);
      if (!metadata) return;
      
      chain.push({
        id,
        source: metadata.provenance.source,
        author: metadata.provenance.author,
        created: metadata.created,
        confidence: metadata.confidence.score
      });
      
      // Traverse derived from
      for (const parentId of metadata.provenance.derivedFrom || []) {
        await traverse(parentId);
      }
    }
    
    await traverse(entryId);
    return chain;
  }

  /**
   * Find related entries
   */
  async findRelated(entryId, options = {}) {
    const metadata = this.metadata.get(entryId);
    if (!metadata) return [];
    
    const related = new Map();
    
    // Direct relationships
    for (const relatedId of metadata.relationships.relatedTo || []) {
      const relatedMeta = this.metadata.get(relatedId);
      if (relatedMeta) {
        related.set(relatedId, {
          ...relatedMeta,
          relationshipType: 'related',
          relevanceScore: 1.0
        });
      }
    }
    
    // Entries with same tags
    if (options.includeTags && metadata.tags.length > 0) {
      for (const [id, meta] of this.metadata) {
        if (id === entryId) continue;
        
        const commonTags = metadata.tags.filter(tag => meta.tags.includes(tag));
        if (commonTags.length > 0) {
          const relevance = commonTags.length / metadata.tags.length;
          if (!related.has(id) || related.get(id).relevanceScore < relevance) {
            related.set(id, {
              ...meta,
              relationshipType: 'shared_tags',
              commonTags,
              relevanceScore: relevance
            });
          }
        }
      }
    }
    
    // Entries from same author
    if (options.includeSameAuthor) {
      for (const [id, meta] of this.metadata) {
        if (id === entryId) continue;
        
        if (meta.provenance.author === metadata.provenance.author) {
          if (!related.has(id)) {
            related.set(id, {
              ...meta,
              relationshipType: 'same_author',
              relevanceScore: 0.5
            });
          }
        }
      }
    }
    
    // Sort by relevance and confidence
    const results = Array.from(related.values())
      .sort((a, b) => {
        const scoreA = a.relevanceScore * a.confidence.score;
        const scoreB = b.relevanceScore * b.confidence.score;
        return scoreB - scoreA;
      });
    
    return options.limit ? results.slice(0, options.limit) : results;
  }

  /**
   * Mark entry as validated
   */
  async validateEntry(entryId, validator, isValid = true, reason = '') {
    const metadata = this.metadata.get(entryId);
    if (!metadata) return null;
    
    const validation = {
      validator,
      timestamp: new Date().toISOString(),
      isValid,
      reason
    };
    
    metadata.provenance.validatedBy = metadata.provenance.validatedBy || [];
    metadata.provenance.validatedBy.push(validation);
    
    // Update quality
    if (isValid) {
      metadata.quality.accuracy = 'verified';
      metadata.quality.lastReviewed = validation.timestamp;
      metadata.quality.reviewedBy = validator;
    } else {
      metadata.quality.accuracy = 'disputed';
    }
    
    // Recalculate confidence
    await this.calculateConfidence(entryId);
    
    return metadata;
  }

  /**
   * Save metadata to disk
   */
  async saveMetadata(entryId, metadata) {
    const filename = entryId.replace(/[^a-zA-Z0-9-_]/g, '_') + '.json';
    const filepath = path.join(this.metadataPath, filename);
    await fs.writeFile(filepath, JSON.stringify(metadata, null, 2));
  }

  /**
   * Get usage statistics
   */
  async getUsageStats() {
    const stats = {
      totalEntries: this.metadata.size,
      byConfidence: { high: 0, medium: 0, low: 0 },
      byQuality: { verified: 0, unverified: 0, disputed: 0 },
      bySource: {},
      mostUsed: [],
      recentlyUsed: [],
      stale: []
    };
    
    const entries = Array.from(this.metadata.values());
    
    // Categorize by confidence
    for (const entry of entries) {
      if (entry.confidence.score >= 4) stats.byConfidence.high++;
      else if (entry.confidence.score >= 2) stats.byConfidence.medium++;
      else stats.byConfidence.low++;
      
      // By quality
      stats.byQuality[entry.quality.accuracy]++;
      
      // By source
      const source = entry.provenance.source;
      stats.bySource[source] = (stats.bySource[source] || 0) + 1;
    }
    
    // Most used (top 10)
    stats.mostUsed = entries
      .filter(e => e.usage.count > 0)
      .sort((a, b) => b.usage.count - a.usage.count)
      .slice(0, 10)
      .map(e => ({ id: e.id, count: e.usage.count, lastUsed: e.usage.lastUsed }));
    
    // Recently used (last 10)
    stats.recentlyUsed = entries
      .filter(e => e.usage.lastUsed)
      .sort((a, b) => new Date(b.usage.lastUsed) - new Date(a.usage.lastUsed))
      .slice(0, 10)
      .map(e => ({ id: e.id, lastUsed: e.usage.lastUsed }));
    
    // Stale entries (not used in 90 days)
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
    stats.stale = entries
      .filter(e => {
        const lastUsed = e.usage.lastUsed ? new Date(e.usage.lastUsed).getTime() : 0;
        const created = new Date(e.created).getTime();
        return Math.max(lastUsed, created) < ninetyDaysAgo;
      })
      .map(e => ({ id: e.id, lastActivity: e.usage.lastUsed || e.created }));
    
    return stats;
  }

  /**
   * Export metadata for backup or sharing
   */
  async exportMetadata(options = {}) {
    const entries = Array.from(this.metadata.values());
    
    // Filter if needed
    let filtered = entries;
    if (options.minConfidence) {
      filtered = filtered.filter(e => e.confidence.score >= options.minConfidence);
    }
    if (options.onlyVerified) {
      filtered = filtered.filter(e => e.quality.accuracy === 'verified');
    }
    
    // Remove sensitive data if requested
    if (options.anonymize) {
      filtered = filtered.map(e => ({
        ...e,
        provenance: {
          ...e.provenance,
          author: 'anonymous'
        },
        usage: {
          ...e.usage,
          history: []
        }
      }));
    }
    
    return {
      version: '1.0.0',
      exported: new Date().toISOString(),
      count: filtered.length,
      metadata: filtered
    };
  }
}

module.exports = { KnowledgeMetadataManager };

// CLI interface
if (require.main === module) {
  const manager = new KnowledgeMetadataManager(path.join(__dirname, '..'));
  
  const command = process.argv[2];
  const args = process.argv.slice(3);
  
  (async () => {
    await manager.initialize();
    
    switch (command) {
      case 'stats':
        const stats = await manager.getUsageStats();
        console.log('Knowledge Statistics:');
        console.log(`  Total entries: ${stats.totalEntries}`);
        console.log(`  High confidence: ${stats.byConfidence.high}`);
        console.log(`  Verified: ${stats.byQuality.verified}`);
        console.log('\nMost used:');
        stats.mostUsed.forEach(e => {
          console.log(`  - ${e.id} (${e.count} uses)`);
        });
        break;
        
      case 'confidence':
        if (args.length === 0) {
          console.log('Usage: knowledge-metadata confidence <entry-id>');
          process.exit(1);
        }
        const score = await manager.calculateConfidence(args[0]);
        console.log(`Confidence score: ${score.toFixed(2)}/5.0`);
        break;
        
      case 'validate':
        if (args.length < 2) {
          console.log('Usage: knowledge-metadata validate <entry-id> <validator>');
          process.exit(1);
        }
        await manager.validateEntry(args[0], args[1], true);
        console.log('✓ Entry validated');
        break;
        
      case 'related':
        if (args.length === 0) {
          console.log('Usage: knowledge-metadata related <entry-id>');
          process.exit(1);
        }
        const related = await manager.findRelated(args[0], { includeTags: true, limit: 5 });
        console.log('Related entries:');
        related.forEach(e => {
          console.log(`  - ${e.id} (${e.relationshipType}, score: ${e.relevanceScore.toFixed(2)})`);
        });
        break;
        
      default:
        console.log('Usage: knowledge-metadata [stats|confidence|validate|related]');
    }
  })();
}