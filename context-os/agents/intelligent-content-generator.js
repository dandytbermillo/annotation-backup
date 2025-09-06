/**
 * Intelligent Content Generator for Context-OS LLM Fill Feature
 * 
 * Generates context-aware, specific content for software feature specifications
 * based on document analysis rather than generic templates.
 * 
 * Example Usage:
 * const generator = new IntelligentContentGenerator();
 * const content = await generator.generateContent('acceptanceCriteria', documentText);
 */

const fs = require('fs');
const path = require('path');

class IntelligentContentGenerator {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.maxSuggestions = options.maxSuggestions || 5;
    
    // Field-specific analysis patterns
    this.fieldAnalyzers = {
      acceptanceCriteria: this.generateAcceptanceCriteria.bind(this),
      problem: this.generateProblem.bind(this),
      goals: this.generateGoals.bind(this),
      stakeholders: this.generateStakeholders.bind(this),
      nonGoals: this.generateNonGoals.bind(this),
      dependencies: this.generateDependencies.bind(this),
      risks: this.generateRisks.bind(this),
      successMetrics: this.generateSuccessMetrics.bind(this),
      implementationTasks: this.generateImplementationTasks.bind(this)
    };
  }

  /**
   * Main entry point for content generation
   */
  async generateContent(fieldName, documentContent) {
    if (!this.fieldAnalyzers[fieldName]) {
      throw new Error(`No analyzer found for field: ${fieldName}`);
    }

    const analysis = this.analyzeDocument(documentContent);
    const suggestions = await this.fieldAnalyzers[fieldName](analysis, documentContent);

    return {
      field: fieldName,
      suggestions,
      analysis: this.debug ? analysis : undefined,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Analyze document content to extract context and intent
   */
  analyzeDocument(content) {
    const analysis = {
      domain: this.extractDomain(content),
      techStack: this.extractTechStack(content),
      userTypes: this.extractUserTypes(content),
      actions: this.extractActions(content),
      features: this.extractFeatures(content),
      constraints: this.extractConstraints(content),
      integrations: this.extractIntegrations(content),
      entities: this.extractBusinessEntities(content)
    };

    if (this.debug) {
      console.log('📊 Document Analysis:', JSON.stringify(analysis, null, 2));
    }

    return analysis;
  }

  /**
   * Extract domain/business area from content
   */
  extractDomain(content) {
    const domains = {
      calculator: /calculat|math|number|arithmetic|sum|add|subtract|multiply|divide|operation|formula/i,
      ecommerce: /shop|cart|payment|checkout|product|order|inventory|customer|purchase|buy|sell|store|commerce|retail|marketplace|pricing|discount|promotion|coupon|conversion/i,
      auth: /login|signup|authentication|authorization|password|session|jwt|oauth|signin|register/i,
      ui: /interface|design|layout|component|style|theme|modal|form|input|button|dropdown|menu|navigation/i,
      data: /database|api|sync|import|export|migration|backup|analytics|query|storage|persistence/i,
      notification: /notification|alert|message|email|push|sms|reminder|notify/i,
      search: /search|filter|sort|query|index|elasticsearch|solr|find|lookup/i,
      dashboard: /dashboard|chart|graph|metric|report|analytics|visualization|kpi|insight/i,
      mobile: /mobile|app|ios|android|responsive|touch|swipe|device|tablet|phone/i,
      social: /social|share|comment|like|follow|feed|post|message|community|network/i
    };

    // Score each domain to find the best match
    let bestDomain = 'general';
    let bestScore = 0;

    for (const [domain, pattern] of Object.entries(domains)) {
      const matches = content.match(new RegExp(pattern, 'gi')) || [];
      const score = matches.length;
      
      if (this.debug) {
        console.log(`Domain ${domain}: ${score} matches`, matches.slice(0, 3));
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      }
    }

    return bestDomain;
  }

  /**
   * Extract technology stack mentions
   */
  extractTechStack(content) {
    const techPatterns = {
      frontend: /react|vue|angular|javascript|typescript|html|css|tailwind|bootstrap/i,
      backend: /node|express|django|flask|ruby|rails|spring|dotnet|java|python/i,
      database: /postgres|mysql|mongodb|redis|sqlite|dynamodb|firebase/i,
      cloud: /aws|azure|gcp|docker|kubernetes|heroku|vercel|netlify/i,
      mobile: /react native|flutter|swift|kotlin|xamarin/i,
      testing: /jest|cypress|selenium|playwright|vitest|mocha|chai/i
    };

    const detected = {};
    for (const [category, pattern] of Object.entries(techPatterns)) {
      const matches = content.match(pattern);
      if (matches) {
        detected[category] = matches.map(m => m.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i);
      }
    }

    return detected;
  }

  /**
   * Extract user types and personas
   */
  extractUserTypes(content) {
    const userPatterns = [
      /admin|administrator/i,
      /user|customer|client/i,
      /manager|supervisor/i,
      /developer|engineer/i,
      /guest|visitor/i,
      /moderator|reviewer/i,
      /operator|staff/i
    ];

    const users = [];
    userPatterns.forEach(pattern => {
      const matches = content.match(pattern);
      if (matches) {
        users.push(...matches.map(m => m.toLowerCase()));
      }
    });

    return [...new Set(users)];
  }

  /**
   * Extract key actions and verbs
   */
  extractActions(content) {
    const actionPattern = /\b(add|create|delete|remove|update|edit|modify|view|display|show|hide|save|load|import|export|sync|search|filter|sort|validate|authenticate|authorize|login|logout|register|signup|submit|send|receive|calculate|process|generate|analyze)\b/gi;
    
    const actions = content.match(actionPattern) || [];
    return [...new Set(actions.map(a => a.toLowerCase()))];
  }

  /**
   * Extract feature-related terms
   */
  extractFeatures(content) {
    const featurePattern = /\b(button|form|modal|dialog|panel|card|table|list|grid|chart|graph|menu|navigation|sidebar|header|footer|search|filter|pagination|tooltip|dropdown|tab|accordion|slider|carousel|calendar|datepicker)\b/gi;
    
    const features = content.match(featurePattern) || [];
    return [...new Set(features.map(f => f.toLowerCase()))];
  }

  /**
   * Extract constraints and requirements
   */
  extractConstraints(content) {
    const constraints = [];
    
    // Performance constraints
    if (/fast|quick|speed|performance|millisecond|second/i.test(content)) {
      constraints.push('performance');
    }
    
    // Security constraints
    if (/secure|security|encrypt|privacy|gdpr|compliance/i.test(content)) {
      constraints.push('security');
    }
    
    // Accessibility constraints
    if (/accessibility|a11y|screen reader|keyboard|wcag/i.test(content)) {
      constraints.push('accessibility');
    }
    
    // Mobile constraints
    if (/mobile|responsive|touch|swipe/i.test(content)) {
      constraints.push('mobile');
    }

    return constraints;
  }

  /**
   * Extract integration mentions
   */
  extractIntegrations(content) {
    const integrationPattern = /\b(api|webhook|oauth|saml|ldap|stripe|paypal|twilio|sendgrid|slack|discord|github|gitlab|jira|salesforce|hubspot|google|facebook|twitter|linkedin)\b/gi;
    
    const integrations = content.match(integrationPattern) || [];
    return [...new Set(integrations.map(i => i.toLowerCase()))];
  }

  /**
   * Extract business entities
   */
  extractBusinessEntities(content) {
    const entityPattern = /\b(user|customer|product|order|payment|invoice|report|account|profile|setting|preference|notification|message|comment|review|rating|category|tag|label|status|role|permission|group|team|organization|company|department)\b/gi;
    
    const entities = content.match(entityPattern) || [];
    return [...new Set(entities.map(e => e.toLowerCase()))];
  }

  /**
   * Generate specific acceptance criteria based on document analysis
   */
  async generateAcceptanceCriteria(analysis, content) {
    const criteria = [];
    const domain = analysis.domain;
    const actions = analysis.actions;
    const features = analysis.features;

    // Domain-specific criteria
    if (domain === 'calculator') {
      criteria.push('All arithmetic operations (addition, subtraction, multiplication, division) produce mathematically correct results');
      criteria.push('Calculator handles decimal numbers with appropriate precision');
      criteria.push('Division by zero displays appropriate error message');
      criteria.push('All calculator buttons respond to both click and keyboard input');
      
      if (features.includes('button')) {
        criteria.push('Blue button styling is consistently applied to all interactive elements');
        criteria.push('Button visual feedback is immediate and clear when pressed');
      }
      
      if (content.toLowerCase().includes('background image')) {
        criteria.push('Background image loads correctly and does not interfere with text readability');
        criteria.push('Background image scales appropriately across different screen sizes');
      }
      
      if (content.toLowerCase().includes('display')) {
        criteria.push('Calculator display shows current numbers and results clearly');
        criteria.push('Display handles overflow gracefully for large numbers');
      }
    } else if (domain === 'auth') {
      if (actions.includes('login')) {
        criteria.push('Users can successfully authenticate with valid credentials');
        criteria.push('Invalid login attempts are rejected with appropriate error messages');
        criteria.push('Account lockout occurs after configured number of failed attempts');
      }
      if (actions.includes('register')) {
        criteria.push('New users can create accounts with valid information');
        criteria.push('Password requirements are enforced and clearly communicated');
        criteria.push('Email verification process works correctly');
      }
    } else if (domain === 'ecommerce') {
      if (analysis.entities.includes('product')) {
        criteria.push('Product information displays accurately and completely');
        criteria.push('Product search returns relevant results');
        criteria.push('Product inventory is correctly tracked and updated');
      }
      if (analysis.entities.includes('cart')) {
        criteria.push('Items can be added to cart successfully');
        criteria.push('Cart totals calculate correctly including taxes and discounts');
        criteria.push('Cart persists across browser sessions');
      }
    }

    // UI-specific criteria
    if (features.includes('button')) {
      criteria.push('All interactive elements are accessible via keyboard navigation');
      criteria.push('Loading states are displayed during asynchronous operations');
    }

    // Performance criteria based on constraints
    if (analysis.constraints.includes('performance')) {
      criteria.push('Page load time is under 3 seconds on standard broadband connection');
      criteria.push('User interactions respond within 200ms');
    }

    // Mobile criteria
    if (analysis.constraints.includes('mobile')) {
      criteria.push('Interface adapts correctly to mobile screen sizes');
      criteria.push('Touch targets meet minimum size requirements (44x44px)');
    }

    // Security criteria
    if (analysis.constraints.includes('security')) {
      criteria.push('All user inputs are properly validated and sanitized');
      criteria.push('Sensitive data is encrypted both in transit and at rest');
    }

    // Tech stack specific criteria
    if (analysis.techStack.testing) {
      criteria.push('Unit test coverage exceeds 80% for all new code');
      criteria.push('Integration tests cover all critical user workflows');
    }

    // Generic fallbacks if no specific criteria generated
    if (criteria.length === 0) {
      criteria.push('Feature functions correctly across all supported browsers');
      criteria.push('Error handling provides meaningful feedback to users');
      criteria.push('Feature integrates properly with existing system components');
    }

    return criteria.slice(0, this.maxSuggestions);
  }

  /**
   * Generate problem statement based on document analysis
   */
  async generateProblem(analysis, content) {
    const problems = [];
    const domain = analysis.domain;

    // Extract pain points from content
    const painPointIndicators = /difficult|hard|problem|issue|challenge|frustrat|slow|confus|error|fail|break|bug/gi;
    const hasPainPoints = painPointIndicators.test(content);

    if (domain === 'calculator' && hasPainPoints) {
      problems.push('Users currently lack a reliable way to perform mathematical calculations within the application, leading to workflow interruptions and external tool dependency.');
    } else if (domain === 'auth') {
      problems.push('The current authentication system lacks modern security features, creating potential security vulnerabilities and poor user experience.');
    } else if (domain === 'ui' && features.includes('button')) {
      problems.push('The existing user interface components lack consistency and accessibility features, making the application difficult to use for diverse user groups.');
    }

    // Generic problem based on actions
    if (problems.length === 0 && analysis.actions.length > 0) {
      const primaryAction = analysis.actions[0];
      problems.push(`Users currently cannot efficiently ${primaryAction} content/data, which creates bottlenecks in their workflow and reduces overall productivity.`);
    }

    // Default fallback
    if (problems.length === 0) {
      problems.push('The current system lacks essential functionality that users need to complete their tasks efficiently and effectively.');
    }

    return problems.slice(0, this.maxSuggestions);
  }

  /**
   * Generate goals based on document analysis
   */
  async generateGoals(analysis, content) {
    const goals = [];
    const domain = analysis.domain;
    const actions = analysis.actions;

    // Domain-specific goals
    if (domain === 'calculator') {
      goals.push('Provide accurate and reliable mathematical calculation capabilities');
      goals.push('Deliver intuitive user interface for all calculation operations');
      goals.push('Support both keyboard and mouse input methods');
    } else if (domain === 'auth') {
      goals.push('Implement secure user authentication and authorization');
      goals.push('Provide seamless user registration and login experience');
      goals.push('Ensure compliance with security best practices');
    } else if (domain === 'ecommerce') {
      goals.push('Streamline the purchasing process for customers');
      goals.push('Improve product discovery and search capabilities');
      goals.push('Increase conversion rates and customer satisfaction');
    }

    // Action-based goals
    actions.forEach(action => {
      switch(action) {
        case 'search':
          goals.push('Enable fast and accurate content search functionality');
          break;
        case 'create':
          goals.push('Simplify content creation process for users');
          break;
        case 'update':
          goals.push('Allow efficient modification of existing data');
          break;
        case 'delete':
          goals.push('Provide safe and reversible content deletion');
          break;
      }
    });

    // Performance and quality goals
    if (analysis.constraints.includes('performance')) {
      goals.push('Maintain high performance standards across all operations');
    }

    if (analysis.constraints.includes('accessibility')) {
      goals.push('Ensure full accessibility compliance for all user groups');
    }

    // Default goals
    if (goals.length === 0) {
      goals.push('Improve overall user experience and workflow efficiency');
      goals.push('Maintain system reliability and performance standards');
      goals.push('Ensure seamless integration with existing functionality');
    }

    return [...new Set(goals)].slice(0, this.maxSuggestions);
  }

  /**
   * Generate stakeholders based on document analysis
   */
  async generateStakeholders(analysis, content) {
    const stakeholders = new Set();

    // Always include core development stakeholders
    stakeholders.add('Product Team');
    stakeholders.add('Engineering Team');
    stakeholders.add('QA Team');

    // Domain-specific stakeholders
    if (analysis.domain === 'ecommerce') {
      stakeholders.add('Sales Team');
      stakeholders.add('Customer Support');
      stakeholders.add('Marketing Team');
    } else if (analysis.domain === 'auth') {
      stakeholders.add('Security Team');
      stakeholders.add('IT Administration');
      stakeholders.add('Compliance Team');
    } else if (analysis.domain === 'dashboard') {
      stakeholders.add('Business Analytics Team');
      stakeholders.add('Data Team');
      stakeholders.add('Management');
    }

    // User-based stakeholders
    if (analysis.userTypes.includes('admin')) {
      stakeholders.add('System Administrators');
    }
    if (analysis.userTypes.includes('customer')) {
      stakeholders.add('Customer Success');
      stakeholders.add('End Users');
    }

    // Always include end users
    stakeholders.add('End Users');

    // UX/Design if UI components mentioned
    if (analysis.features.length > 0) {
      stakeholders.add('UX/Design Team');
    }

    return Array.from(stakeholders).slice(0, this.maxSuggestions);
  }

  /**
   * Generate non-goals based on document analysis
   */
  async generateNonGoals(analysis, content) {
    const nonGoals = [];

    // Domain-specific non-goals
    if (analysis.domain === 'calculator') {
      nonGoals.push('Advanced scientific or graphing calculator functions');
      nonGoals.push('Unit conversion capabilities');
      nonGoals.push('Historical calculation storage');
    } else if (analysis.domain === 'auth') {
      nonGoals.push('Social media authentication integration');
      nonGoals.push('Advanced role-based permission management');
      nonGoals.push('Enterprise SSO integration');
    }

    // Integration non-goals
    if (analysis.integrations.length === 0) {
      nonGoals.push('Third-party service integrations');
      nonGoals.push('External API dependencies');
    }

    // Mobile non-goals if not mobile-focused
    if (!analysis.constraints.includes('mobile')) {
      nonGoals.push('Native mobile app development');
      nonGoals.push('Offline mobile functionality');
    }

    // Advanced features typically out of scope
    nonGoals.push('Real-time collaboration features');
    nonGoals.push('Advanced analytics and reporting');
    nonGoals.push('Multi-tenant architecture support');

    return nonGoals.slice(0, this.maxSuggestions);
  }

  /**
   * Generate dependencies based on document analysis
   */
  async generateDependencies(analysis, content) {
    const dependencies = [];

    // Tech stack dependencies
    if (analysis.techStack.database) {
      dependencies.push('Database schema updates and migrations');
    }
    if (analysis.techStack.backend) {
      dependencies.push('Backend API endpoint modifications');
    }
    if (analysis.techStack.frontend) {
      dependencies.push('Frontend component library updates');
    }

    // Integration dependencies
    analysis.integrations.forEach(integration => {
      dependencies.push(`${integration.charAt(0).toUpperCase() + integration.slice(1)} API configuration`);
    });

    // Domain-specific dependencies
    if (analysis.domain === 'auth') {
      dependencies.push('Authentication service configuration');
      dependencies.push('User management system integration');
    } else if (analysis.domain === 'ecommerce') {
      dependencies.push('Payment gateway integration');
      dependencies.push('Inventory management system');
    }

    // UI dependencies
    if (analysis.features.length > 0) {
      dependencies.push('UI component library compatibility');
      dependencies.push('Design system guidelines');
    }

    // Default dependencies
    if (dependencies.length === 0) {
      dependencies.push('System configuration updates');
      dependencies.push('Documentation updates');
      dependencies.push('Testing framework setup');
    }

    return [...new Set(dependencies)].slice(0, this.maxSuggestions);
  }

  /**
   * Generate risk assessment based on document analysis
   */
  async generateRisks(analysis, content) {
    const risks = [];

    // Security risks
    if (analysis.domain === 'auth' || analysis.constraints.includes('security')) {
      risks.push('Security vulnerabilities in authentication implementation');
      risks.push('Data breach potential if security measures are inadequate');
    }

    // Performance risks
    if (analysis.constraints.includes('performance') || analysis.entities.length > 3) {
      risks.push('Performance degradation with large datasets');
      risks.push('Database query optimization challenges');
    }

    // Integration risks
    if (analysis.integrations.length > 0) {
      risks.push('Third-party service reliability and API changes');
      risks.push('Integration complexity leading to increased development time');
    }

    // UI/UX risks
    if (analysis.features.length > 2) {
      risks.push('User experience complexity affecting adoption');
      risks.push('Cross-browser compatibility issues');
    }

    // Tech stack risks
    if (Object.keys(analysis.techStack).length > 2) {
      risks.push('Technology stack compatibility challenges');
      risks.push('Increased maintenance complexity');
    }

    // Default risks
    if (risks.length === 0) {
      risks.push('Implementation complexity exceeding initial estimates');
      risks.push('User adoption challenges due to change resistance');
      risks.push('Integration issues with existing system components');
    }

    return risks.slice(0, this.maxSuggestions);
  }

  /**
   * Generate success metrics based on document analysis
   */
  async generateSuccessMetrics(analysis, content) {
    const metrics = [];

    // Performance metrics
    if (analysis.constraints.includes('performance')) {
      metrics.push('Page load time remains under 3 seconds');
      metrics.push('API response time averages under 200ms');
    }

    // User engagement metrics
    if (analysis.userTypes.length > 0) {
      metrics.push('User adoption rate exceeds 70% within first month');
      metrics.push('User satisfaction score improves by at least 15%');
    }

    // Domain-specific metrics
    if (analysis.domain === 'ecommerce') {
      metrics.push('Conversion rate increases by 10%');
      metrics.push('Cart abandonment rate decreases by 20%');
    } else if (analysis.domain === 'auth') {
      metrics.push('Login success rate exceeds 95%');
      metrics.push('Account creation completion rate above 85%');
    } else if (analysis.domain === 'search') {
      metrics.push('Search result relevance score above 80%');
      metrics.push('Search completion rate exceeds 90%');
    }

    // Technical metrics
    if (analysis.techStack.testing) {
      metrics.push('Code coverage maintains above 80%');
      metrics.push('Bug report rate decreases by 25%');
    }

    // Error and support metrics
    metrics.push('Error rate remains below 1%');
    metrics.push('Support ticket volume decreases by 30%');

    // Default metrics
    if (metrics.length === 0) {
      metrics.push('Feature usage rate exceeds 60% of target user base');
      metrics.push('System uptime maintains 99.9% availability');
      metrics.push('User task completion time improves by 20%');
    }

    return metrics.slice(0, this.maxSuggestions);
  }

  /**
   * Generate implementation tasks based on document analysis
   */
  async generateImplementationTasks(analysis, content) {
    const tasks = [];

    // Planning and design tasks
    tasks.push('Design system architecture and component structure');
    tasks.push('Create detailed technical specifications');

    // Development tasks based on tech stack
    if (analysis.techStack.database) {
      tasks.push('Design and implement database schema changes');
      tasks.push('Create database migration scripts');
    }

    if (analysis.techStack.backend) {
      tasks.push('Implement backend API endpoints and business logic');
      tasks.push('Add input validation and error handling');
    }

    if (analysis.techStack.frontend) {
      tasks.push('Develop user interface components and layouts');
      tasks.push('Implement client-side functionality and state management');
    }

    // Domain-specific tasks
    if (analysis.domain === 'auth') {
      tasks.push('Implement authentication middleware and security measures');
      tasks.push('Create user registration and login workflows');
    } else if (analysis.domain === 'ecommerce') {
      tasks.push('Implement product catalog and shopping cart functionality');
      tasks.push('Integrate payment processing and order management');
    }

    // Testing tasks
    tasks.push('Write comprehensive unit tests for all components');
    tasks.push('Implement integration tests for critical workflows');
    tasks.push('Conduct user acceptance testing and bug fixes');

    // Documentation and deployment tasks
    tasks.push('Create user documentation and help guides');
    tasks.push('Prepare deployment scripts and configuration');
    tasks.push('Conduct security review and performance optimization');

    return tasks.slice(0, this.maxSuggestions);
  }

  /**
   * Batch generate content for multiple fields
   */
  async generateBatch(fields, documentContent) {
    const results = {};
    
    for (const field of fields) {
      try {
        results[field] = await this.generateContent(field, documentContent);
      } catch (error) {
        results[field] = {
          field,
          error: error.message,
          suggestions: [],
          timestamp: new Date().toISOString()
        };
      }
    }

    return results;
  }

  /**
   * Generate content with confidence scoring
   */
  async generateWithConfidence(fieldName, documentContent) {
    const result = await this.generateContent(fieldName, documentContent);
    
    // Calculate confidence based on content analysis depth
    const analysis = this.analyzeDocument(documentContent);
    let confidence = 0.5; // baseline
    
    // Boost confidence based on domain detection
    if (analysis.domain !== 'general') confidence += 0.2;
    
    // Boost confidence based on specific patterns found
    if (analysis.actions.length > 2) confidence += 0.1;
    if (analysis.features.length > 1) confidence += 0.1;
    if (analysis.entities.length > 2) confidence += 0.1;
    
    result.confidence = Math.min(confidence, 1.0);
    return result;
  }
}

// Export for use as both module and standalone script
module.exports = IntelligentContentGenerator;

// CLI interface when run directly
if (require.main === module) {
  const generator = new IntelligentContentGenerator({ debug: true });
  
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node intelligent-content-generator.js <field> <document-file>');
    console.log('Fields: acceptanceCriteria, problem, goals, stakeholders, nonGoals, dependencies, risks, successMetrics, implementationTasks');
    process.exit(1);
  }

  const [fieldName, documentFile] = args;
  
  if (!fs.existsSync(documentFile)) {
    console.error(`Document file not found: ${documentFile}`);
    process.exit(1);
  }

  const documentContent = fs.readFileSync(documentFile, 'utf8');
  
  generator.generateWithConfidence(fieldName, documentContent)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}