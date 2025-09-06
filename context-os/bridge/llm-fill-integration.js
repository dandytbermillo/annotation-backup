/**
 * LLM Fill Integration for Context-OS
 * 
 * Bridges the Intelligent Content Generator with the Context-OS system
 * for seamless intelligent field completion.
 */

const IntelligentContentGenerator = require('../agents/intelligent-content-generator');
const fs = require('fs');
const path = require('path');

class LLMFillIntegration {
  constructor(options = {}) {
    this.generator = new IntelligentContentGenerator({
      debug: options.debug || false,
      maxSuggestions: options.maxSuggestions || 5
    });
    
    this.supportedFields = [
      'acceptanceCriteria',
      'problem', 
      'goals',
      'stakeholders',
      'nonGoals',
      'dependencies',
      'risks',
      'successMetrics',
      'implementationTasks'
    ];
  }

  /**
   * Process LLM fill request from Context-OS
   */
  async processRequest(request) {
    try {
      const { 
        fieldName, 
        documentPath, 
        documentContent, 
        featureSlug,
        confidence = false,
        batch = false 
      } = request;

      // Validate field
      if (!batch && !this.supportedFields.includes(fieldName)) {
        throw new Error(`Unsupported field: ${fieldName}. Supported fields: ${this.supportedFields.join(', ')}`);
      }

      // Get document content
      let content = documentContent;
      if (!content && documentPath) {
        if (!fs.existsSync(documentPath)) {
          throw new Error(`Document not found: ${documentPath}`);
        }
        content = fs.readFileSync(documentPath, 'utf8');
      }

      if (!content) {
        throw new Error('No document content provided');
      }

      // Generate content
      let result;
      if (batch) {
        const fields = Array.isArray(fieldName) ? fieldName : this.supportedFields;
        result = await this.generator.generateBatch(fields, content);
      } else if (confidence) {
        result = await this.generator.generateWithConfidence(fieldName, content);
      } else {
        result = await this.generator.generateContent(fieldName, content);
      }

      // Format response for Context-OS
      return {
        status: 'success',
        featureSlug,
        fieldName,
        result,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      };

    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        featureSlug: request.featureSlug,
        fieldName: request.fieldName,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Interactive field completion for Context-OS companion
   */
  async interactiveFill(featureSlug, documentPath) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      console.log(`\n🤖 LLM Fill Assistant for: ${featureSlug}`);
      console.log(`📄 Document: ${documentPath}\n`);

      // Check if document exists
      if (!fs.existsSync(documentPath)) {
        throw new Error(`Document not found: ${documentPath}`);
      }

      // Show available fields
      console.log('Available fields:');
      this.supportedFields.forEach((field, index) => {
        console.log(`  ${index + 1}. ${field}`);
      });

      // Ask user to select field
      const choice = await this.askQuestion(rl, '\nSelect field number (or "all" for batch): ');
      
      let fieldName;
      let batch = false;
      
      if (choice.toLowerCase() === 'all') {
        batch = true;
        fieldName = this.supportedFields;
      } else {
        const fieldIndex = parseInt(choice) - 1;
        if (fieldIndex < 0 || fieldIndex >= this.supportedFields.length) {
          throw new Error('Invalid field selection');
        }
        fieldName = this.supportedFields[fieldIndex];
      }

      // Process request
      const request = {
        fieldName,
        documentPath,
        featureSlug,
        confidence: true,
        batch
      };

      console.log(`\n🔍 Analyzing document and generating suggestions...\n`);

      const response = await this.processRequest(request);

      if (response.status === 'error') {
        console.error(`❌ Error: ${response.error}`);
        return;
      }

      // Display results
      if (batch) {
        console.log('📋 Batch Results:\n');
        Object.entries(response.result).forEach(([field, data]) => {
          console.log(`\n📌 ${field}:`);
          if (data.suggestions && data.suggestions.length > 0) {
            data.suggestions.forEach((suggestion, index) => {
              console.log(`  ${index + 1}. ${suggestion}`);
            });
          } else if (data.error) {
            console.log(`  ❌ ${data.error}`);
          }
        });
      } else {
        console.log(`📌 Suggestions for ${fieldName}:\n`);
        if (response.result.suggestions && response.result.suggestions.length > 0) {
          response.result.suggestions.forEach((suggestion, index) => {
            console.log(`  ${index + 1}. ${suggestion}`);
          });
          console.log(`\n🎯 Confidence: ${Math.round(response.result.confidence * 100)}%`);
        } else {
          console.log('  No suggestions generated.');
        }
      }

      // Ask if user wants to save to file
      const save = await this.askQuestion(rl, '\nSave suggestions to file? (y/n): ');
      if (save.toLowerCase() === 'y') {
        await this.saveSuggestions(response, featureSlug, fieldName);
      }

    } catch (error) {
      console.error(`❌ Interactive fill error: ${error.message}`);
    } finally {
      rl.close();
    }
  }

  /**
   * Save suggestions to file
   */
  async saveSuggestions(response, featureSlug, fieldName) {
    try {
      const outputDir = `context-os/output/${featureSlug}`;
      
      // Create output directory if it doesn't exist
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${fieldName}-suggestions-${timestamp}.json`;
      const filepath = path.join(outputDir, filename);

      fs.writeFileSync(filepath, JSON.stringify(response, null, 2));
      console.log(`💾 Suggestions saved to: ${filepath}`);

    } catch (error) {
      console.error(`❌ Save error: ${error.message}`);
    }
  }

  /**
   * Helper method for asking questions
   */
  askQuestion(rl, question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Context-OS bridge method - called by companion server
   */
  async handleBridgeRequest(req) {
    // Extract request data from Context-OS format
    const request = {
      fieldName: req.field,
      documentContent: req.content,
      featureSlug: req.slug,
      confidence: req.withConfidence || false,
      batch: req.batch || false
    };

    const response = await this.processRequest(request);

    // Format for Context-OS bridge response
    return {
      success: response.status === 'success',
      data: response.result,
      error: response.error,
      metadata: {
        field: request.fieldName,
        slug: request.featureSlug,
        timestamp: response.timestamp,
        version: '1.0.0'
      }
    };
  }

  /**
   * Get field information for Context-OS
   */
  getFieldInfo() {
    return this.supportedFields.map(field => ({
      name: field,
      displayName: this.getFieldDisplayName(field),
      description: this.getFieldDescription(field)
    }));
  }

  /**
   * Get human-readable field name
   */
  getFieldDisplayName(field) {
    const displayNames = {
      acceptanceCriteria: 'Acceptance Criteria',
      problem: 'Problem Statement',
      goals: 'Goals',
      stakeholders: 'Stakeholders',
      nonGoals: 'Non-Goals',
      dependencies: 'Dependencies',
      risks: 'Risks & Mitigations',
      successMetrics: 'Success Metrics',
      implementationTasks: 'Implementation Tasks'
    };

    return displayNames[field] || field;
  }

  /**
   * Get field description
   */
  getFieldDescription(field) {
    const descriptions = {
      acceptanceCriteria: 'Specific, testable criteria that define when the feature is complete',
      problem: 'Clear statement of the problem or need this feature addresses',
      goals: 'Primary objectives and outcomes this feature aims to achieve',
      stakeholders: 'People and teams affected by or involved in this feature',
      nonGoals: 'Explicitly excluded scope to prevent scope creep',
      dependencies: 'External requirements and prerequisites for this feature',
      risks: 'Potential challenges and mitigation strategies',
      successMetrics: 'Measurable indicators of feature success',
      implementationTasks: 'Specific development tasks required to implement the feature'
    };

    return descriptions[field] || `Content suggestions for ${field}`;
  }
}

// Export for use in Context-OS system
module.exports = LLMFillIntegration;

// CLI interface when run directly
if (require.main === module) {
  const integration = new LLMFillIntegration({ debug: true });
  
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node llm-fill-integration.js <feature-slug> <document-path>');
    console.log('       node llm-fill-integration.js interactive <feature-slug> <document-path>');
    process.exit(1);
  }

  if (args[0] === 'interactive') {
    const [, featureSlug, documentPath] = args;
    integration.interactiveFill(featureSlug, documentPath)
      .then(() => process.exit(0))
      .catch(error => {
        console.error('Error:', error.message);
        process.exit(1);
      });
  } else {
    console.log('Use "interactive" mode for full CLI experience');
    console.log('Example: node llm-fill-integration.js interactive calculator ../test-calculator-example.md');
    process.exit(1);
  }
}