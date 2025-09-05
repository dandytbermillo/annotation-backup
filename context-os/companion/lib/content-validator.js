class ContentValidator {
  constructor() {
    this.requiredSections = [
      { name: 'title', pattern: /\*\*Title\*\*:\s*.+/i, weight: 1 },
      { name: 'feature', pattern: /\*\*Feature\*\*:\s*.+/i, weight: 1 },
      { name: 'problem', pattern: /##\s*Problem[\s\S]+?\S+/i, weight: 2 },
      { name: 'goals', pattern: /##\s*Goals[\s\S]+?(-|\*)\s*.+/i, weight: 2 },
      { name: 'acceptance_criteria', pattern: /##\s*Acceptance\s+Criteria[\s\S]+?(-|\*)\s*.+/i, weight: 2 },
      { name: 'stakeholders', pattern: /##\s*Stakeholders[\s\S]+?(-|\*)\s*.+/i, weight: 1 },
      { name: 'references', pattern: /##\s*(References|External\s+References)/i, weight: 1 }
    ];
  }

  validate(content) {
    const missing = [];
    const found = [];
    let totalWeight = 0;
    let earnedWeight = 0;
    
    // Remove YAML frontmatter if present
    let cleanContent = content;
    if (content.startsWith('---')) {
      const endOfYaml = content.indexOf('---', 3);
      if (endOfYaml !== -1) {
        cleanContent = content.substring(endOfYaml + 3).trim();
      }
    }
    
    // Normalize content to handle extra whitespace
    const normalizedContent = cleanContent.replace(/^\s+/gm, '').trim();
    console.log('Normalized content for validation:', normalizedContent.substring(0, 300));
    
    // Check each required section
    for (const section of this.requiredSections) {
      totalWeight += section.weight;
      
      if (section.pattern.test(normalizedContent)) {
        found.push(section.name);
        earnedWeight += section.weight;
      } else {
        missing.push(section.name);
      }
    }
    
    // Calculate readiness score (0-10)
    const readinessScore = Math.round((earnedWeight / totalWeight) * 10);
    
    // Check content quality
    const hasSubstantialContent = normalizedContent.length > 500;
    const hasMultipleGoals = (normalizedContent.match(/(-|\*)\s+.+/g) || []).length >= 3;
    const hasDetailedProblem = /##\s*Problem[\s\S]{100,}/i.test(normalizedContent);
    
    // Calculate confidence based on content quality
    let confidence = 0.5; // Base confidence
    if (hasSubstantialContent) confidence += 0.2;
    if (hasMultipleGoals) confidence += 0.15;
    if (hasDetailedProblem) confidence += 0.15;
    
    // Generate suggestions based on what's missing
    const suggestions = [];
    
    if (missing.includes('problem')) {
      suggestions.push('Add a detailed problem statement explaining the issue this feature solves');
    }
    if (missing.includes('goals')) {
      suggestions.push('List at least 3 specific goals this feature aims to achieve');
    }
    if (missing.includes('acceptance_criteria')) {
      suggestions.push('Define clear acceptance criteria that can be tested');
    }
    if (missing.includes('stakeholders')) {
      suggestions.push('Identify stakeholders who will be affected by this feature');
    }
    if (!hasMultipleGoals && !missing.includes('goals')) {
      suggestions.push('Consider adding more specific goals (currently has fewer than 3)');
    }
    if (!hasDetailedProblem && !missing.includes('problem')) {
      suggestions.push('Expand the problem statement with more context and details');
    }
    
    // Determine if ready for PRP
    const isReady = readinessScore >= 7 && missing.length <= 2;
    
    return {
      ok: missing.length === 0,
      missing_fields: missing,
      found_fields: found,
      readiness_score: readinessScore,
      confidence: confidence,
      suggestions: suggestions,
      warnings: missing.length > 0 ? [`Missing ${missing.length} required sections`] : [],
      reason: missing.length === 0 ? 'All required sections present' : `Missing: ${missing.join(', ')}`,
      prp_ready: isReady,
      stats: {
        total_sections: this.requiredSections.length,
        found_sections: found.length,
        content_length: content.length,
        list_items: (content.match(/(-|\*)\s+.+/g) || []).length
      }
    };
  }
}

module.exports = ContentValidator;