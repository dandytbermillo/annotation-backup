/**
 * Claude Task Handler - Uses Claude's intelligence for generating suggestions
 * This module creates a bridge to Claude Code's Task tool for intelligent content generation
 */

const { spawn } = require('child_process');
const path = require('path');

class ClaudeTaskHandler {
  constructor() {
    this.scriptPath = path.join(__dirname, '..', 'scripts', 'claude-task-executor.js');
  }

  /**
   * Generate intelligent suggestions for missing fields using Claude
   * @param {string} field - The missing field (e.g., 'acceptance_criteria', 'problem')
   * @param {string} documentContent - The full content of the INITIAL.md
   * @returns {Promise<Object>} Suggestion object with content and reason
   */
  async generateSuggestion(field, documentContent) {
    try {
      // Create a detailed prompt for Claude based on the field type
      const prompt = this.buildPrompt(field, documentContent);
      
      // Execute the Claude task script
      const result = await this.executeClaudeTask(prompt);
      
      // Format the result as a suggestion
      return this.formatSuggestion(field, result);
    } catch (error) {
      console.error(`Error generating suggestion for ${field}:`, error);
      // Fallback to a generic suggestion if Claude fails
      return this.getFallbackSuggestion(field);
    }
  }

  /**
   * Build a context-aware prompt for Claude
   */
  buildPrompt(field, documentContent) {
    const basePrompt = `You are helping complete a software feature specification document. 
    
Current document content:
${documentContent}

The field "${field}" is missing or empty. Please generate appropriate content for this field.

Requirements:
1. Analyze the existing content to understand the feature being described
2. Generate content that is specific and relevant to this exact feature
3. Use proper markdown formatting
4. Be concise but comprehensive
5. Include specific, testable items where applicable

Generate ONLY the content for the "${field}" section, including the section header.`;

    // Add field-specific guidance
    const fieldGuidance = {
      'acceptance_criteria': `
For acceptance criteria:
- Create specific, testable criteria based on the feature described
- Use checkbox format: - [ ] 
- Include functional, performance, and usability criteria
- Consider edge cases and error handling
- Make each criterion independently verifiable`,
      
      'problem': `
For problem statement:
- Clearly articulate the user pain point or business need
- Explain why the current state is insufficient
- Be specific about who is affected and how
- Quantify the impact if possible`,
      
      'goals': `
For goals:
- List clear, measurable objectives
- Align with the problem statement
- Use bullet points
- Focus on outcomes, not implementation details`,
      
      'references': `
For references:
- Include relevant documentation, standards, or guidelines
- Add links to similar implementations or inspiration
- Include technical specifications if applicable
- List any regulatory or compliance requirements`,
      
      'stakeholders': `
For stakeholders:
- List all groups affected by or interested in this feature
- Include both internal teams and external users
- Consider indirect stakeholders
- Use bullet points with clear role descriptions`,
      
      'feature': `
For feature field:
- Create a concise, descriptive feature slug
- Use lowercase with underscores
- Should be searchable and memorable
- Example: user_authentication, dark_mode, data_export`,
      
      'title': `
For title:
- Create a clear, descriptive title for the feature
- Should be human-readable and professional
- Capitalize appropriately
- Be specific but concise`
    };

    return basePrompt + (fieldGuidance[field.toLowerCase()] || '');
  }

  /**
   * Execute Claude task using a separate Node script
   */
  async executeClaudeTask(prompt) {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [this.scriptPath], {
        env: { ...process.env }
      });

      let output = '';
      let error = '';

      // Send the prompt to the script
      child.stdin.write(JSON.stringify({ prompt }));
      child.stdin.end();

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        error += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Claude task failed: ${error}`));
        } else {
          try {
            const result = JSON.parse(output);
            resolve(result);
          } catch (e) {
            // If not JSON, return raw output
            resolve({ content: output.trim() });
          }
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        child.kill();
        reject(new Error('Claude task timeout'));
      }, 30000);
    });
  }

  /**
   * Format Claude's response as a suggestion object
   */
  formatSuggestion(field, result) {
    const content = result.content || result;
    
    // Ensure the content has the proper section header
    let formattedContent = content;
    const sectionHeaders = {
      'acceptance_criteria': '## Acceptance Criteria',
      'problem': '## Problem',
      'goals': '## Goals',
      'references': '## References',
      'stakeholders': '## Stakeholders',
      'feature': '**Feature**:',
      'title': '**Title**:'
    };

    const expectedHeader = sectionHeaders[field.toLowerCase()];
    if (expectedHeader && !content.includes(expectedHeader)) {
      formattedContent = `${expectedHeader}\n\n${content}`;
    }

    return {
      field: field,
      section: this.getSection(field),
      content: formattedContent,
      reason: `Generated by Claude based on document context`,
      confidence: 0.95
    };
  }

  /**
   * Get section name for a field
   */
  getSection(field) {
    const sections = {
      'acceptance_criteria': 'Acceptance Criteria',
      'problem': 'Problem',
      'goals': 'Goals',
      'references': 'References',
      'stakeholders': 'Stakeholders',
      'feature': 'Feature',
      'title': 'Title'
    };
    return sections[field.toLowerCase()] || field;
  }

  /**
   * Fallback suggestion if Claude fails
   */
  getFallbackSuggestion(field) {
    const fallbacks = {
      'acceptance_criteria': {
        content: '## Acceptance Criteria\n\n- [ ] Feature meets functional requirements\n- [ ] User interface is intuitive\n- [ ] Performance is acceptable\n- [ ] Security best practices followed\n- [ ] Documentation is complete',
        reason: 'Generic criteria (Claude unavailable)'
      },
      'problem': {
        content: '## Problem\n\n[Describe the user problem or business need this feature addresses]',
        reason: 'Template (Claude unavailable)'
      },
      'goals': {
        content: '## Goals\n\n- [Primary objective]\n- [Secondary objective]\n- [Success metric]',
        reason: 'Template (Claude unavailable)'
      }
    };

    const fallback = fallbacks[field.toLowerCase()] || {
      content: `## ${this.getSection(field)}\n\n[Content to be added]`,
      reason: 'Template (Claude unavailable)'
    };

    return {
      field: field,
      section: this.getSection(field),
      content: fallback.content,
      reason: fallback.reason,
      confidence: 0.3
    };
  }
}

module.exports = ClaudeTaskHandler;