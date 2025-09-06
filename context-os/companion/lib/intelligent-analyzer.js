/**
 * Intelligent Document Analyzer
 * Provides real AI-powered analysis of document content to generate context-aware suggestions
 */

class IntelligentAnalyzer {
  constructor() {
    this.domainPatterns = {
      calculator: {
        keywords: ['calculator', 'calculation', 'arithmetic', 'compute', 'math', 'number', 'operation', 'equals', 'plus', 'minus', 'multiply', 'divide'],
        features: ['buttons', 'display', 'clear', 'decimal', 'operations'],
        weight: 0
      },
      editor: {
        keywords: ['editor', 'text', 'write', 'edit', 'document', 'typing', 'content', 'format', 'highlight', 'syntax'],
        features: ['paste', 'copy', 'cut', 'save', 'undo', 'redo', 'highlight'],
        weight: 0
      },
      authentication: {
        keywords: ['login', 'auth', 'signin', 'signup', 'password', 'user', 'account', 'security', 'oauth', 'jwt'],
        features: ['form', 'validation', 'session', 'token', 'redirect'],
        weight: 0
      },
      ecommerce: {
        keywords: ['shop', 'cart', 'product', 'checkout', 'payment', 'order', 'inventory', 'customer', 'purchase'],
        features: ['catalog', 'pricing', 'shipping', 'discount', 'review'],
        weight: 0
      },
      dashboard: {
        keywords: ['dashboard', 'analytics', 'metrics', 'chart', 'graph', 'visualization', 'report', 'data'],
        features: ['widgets', 'filters', 'export', 'realtime', 'aggregation'],
        weight: 0
      },
      form: {
        keywords: ['form', 'input', 'field', 'validation', 'submit', 'textarea', 'checkbox', 'radio', 'select'],
        features: ['validation', 'submission', 'fields', 'error handling'],
        weight: 0
      },
      music: {
        keywords: ['music', 'audio', 'player', 'song', 'track', 'playlist', 'play', 'pause', 'volume', 'sound', 'media', 'mp3', 'streaming', 'shuffle', 'repeat'],
        features: ['playback', 'controls', 'queue', 'equalizer', 'library', 'album', 'artist'],
        weight: 0
      },
      weather: {
        keywords: ['weather', 'temperature', 'forecast', 'climate', 'rain', 'snow', 'wind', 'humidity', 'pressure', 'celsius', 'fahrenheit'],
        features: ['map', 'radar', 'alerts', 'hourly', 'daily', 'location'],
        weight: 0
      },
      chat: {
        keywords: ['chat', 'message', 'conversation', 'thread', 'reply', 'send', 'receive', 'notification', 'typing', 'presence', 'online'],
        features: ['emoji', 'attachments', 'reactions', 'mentions', 'channels', 'direct'],
        weight: 0
      },
      todo: {
        keywords: ['todo', 'task', 'checklist', 'complete', 'priority', 'deadline', 'due', 'reminder', 'category', 'tag'],
        features: ['create', 'update', 'delete', 'filter', 'sort', 'archive'],
        weight: 0
      }
    };
  }

  /**
   * Analyze document content to understand context
   */
  analyzeDocument(content) {
    const lowerContent = content.toLowerCase();
    
    // Reset weights
    Object.keys(this.domainPatterns).forEach(domain => {
      this.domainPatterns[domain].weight = 0;
    });
    
    // Score each domain based on keyword matches
    Object.entries(this.domainPatterns).forEach(([domain, pattern]) => {
      pattern.keywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = lowerContent.match(regex);
        if (matches) {
          this.domainPatterns[domain].weight += matches.length * 2;
        }
      });
      
      pattern.features.forEach(feature => {
        if (lowerContent.includes(feature)) {
          this.domainPatterns[domain].weight += 1;
        }
      });
    });
    
    // Find primary domain
    const primaryDomain = Object.entries(this.domainPatterns)
      .sort((a, b) => b[1].weight - a[1].weight)[0][0];
    
    // Extract specific features from content
    const specificFeatures = this.extractFeatures(content);
    
    // Detect technical stack
    const techStack = this.detectTechStack(content);
    
    // Detect UI/UX elements
    const uiElements = this.detectUIElements(content);
    
    return {
      primaryDomain,
      domainWeights: Object.entries(this.domainPatterns).reduce((acc, [domain, pattern]) => {
        acc[domain] = pattern.weight;
        return acc;
      }, {}),
      specificFeatures,
      techStack,
      uiElements,
      hasColorScheme: this.detectColorScheme(content),
      hasPersistence: this.detectPersistence(content),
      hasRealtime: this.detectRealtime(content),
      businessEntities: this.extractBusinessEntities(content),
      userTypes: this.extractUserTypes(content)
    };
  }

  extractFeatures(content) {
    const features = [];
    const lines = content.split('\n');
    
    lines.forEach(line => {
      // Look for bullet points or numbered lists
      const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)/);
      const numberMatch = line.match(/^[\s]*\d+\.\s+(.+)/);
      
      if (bulletMatch) {
        features.push(bulletMatch[1].trim());
      } else if (numberMatch) {
        features.push(numberMatch[1].trim());
      }
      
      // Look for feature keywords
      const featureMatch = line.match(/feature[s]?:\s*(.+)/i);
      if (featureMatch) {
        features.push(featureMatch[1].trim());
      }
    });
    
    return features;
  }

  detectTechStack(content) {
    const tech = [];
    const lowerContent = content.toLowerCase();
    
    const technologies = {
      'React': ['react', 'jsx', 'hooks', 'usestate', 'useeffect'],
      'Vue': ['vue', 'v-model', 'v-if', 'v-for'],
      'Angular': ['angular', 'ng-', '@component'],
      'Node.js': ['node', 'express', 'npm', 'package.json'],
      'PostgreSQL': ['postgres', 'postgresql', 'pg', 'sql'],
      'MongoDB': ['mongodb', 'mongoose', 'collection'],
      'TypeScript': ['typescript', 'interface', 'type', '.ts'],
      'Python': ['python', 'django', 'flask', 'pip'],
      'Docker': ['docker', 'container', 'dockerfile'],
      'Kubernetes': ['kubernetes', 'k8s', 'kubectl', 'pod']
    };
    
    Object.entries(technologies).forEach(([name, keywords]) => {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        tech.push(name);
      }
    });
    
    return tech;
  }

  detectUIElements(content) {
    const elements = [];
    const lowerContent = content.toLowerCase();
    
    const uiPatterns = {
      'buttons': ['button', 'btn', 'click'],
      'forms': ['form', 'input', 'field'],
      'modals': ['modal', 'dialog', 'popup'],
      'navigation': ['nav', 'menu', 'sidebar'],
      'tables': ['table', 'grid', 'row', 'column'],
      'cards': ['card', 'tile', 'panel'],
      'charts': ['chart', 'graph', 'visualization']
    };
    
    Object.entries(uiPatterns).forEach(([element, keywords]) => {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        elements.push(element);
      }
    });
    
    return elements;
  }

  detectColorScheme(content) {
    const lowerContent = content.toLowerCase();
    const colors = ['blue', 'red', 'green', 'dark', 'light', 'theme', 'color', 'style', 'design', 'palette'];
    return colors.some(color => lowerContent.includes(color));
  }

  detectPersistence(content) {
    const lowerContent = content.toLowerCase();
    const persistenceKeywords = ['save', 'persist', 'store', 'database', 'cache', 'local storage', 'session'];
    return persistenceKeywords.some(keyword => lowerContent.includes(keyword));
  }

  detectRealtime(content) {
    const lowerContent = content.toLowerCase();
    const realtimeKeywords = ['real-time', 'realtime', 'live', 'websocket', 'push', 'stream', 'sync'];
    return realtimeKeywords.some(keyword => lowerContent.includes(keyword));
  }

  extractBusinessEntities(content) {
    const entities = [];
    const lowerContent = content.toLowerCase();
    
    const businessTerms = {
      'users': ['user', 'customer', 'client', 'member'],
      'products': ['product', 'item', 'service', 'offering'],
      'orders': ['order', 'purchase', 'transaction', 'sale'],
      'payments': ['payment', 'billing', 'invoice', 'subscription'],
      'content': ['content', 'article', 'post', 'document'],
      'analytics': ['analytics', 'metrics', 'report', 'statistics']
    };
    
    Object.entries(businessTerms).forEach(([entity, keywords]) => {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        entities.push(entity);
      }
    });
    
    return entities;
  }

  extractUserTypes(content) {
    const users = [];
    const lowerContent = content.toLowerCase();
    
    const userPatterns = {
      'administrators': ['admin', 'administrator', 'superuser'],
      'customers': ['customer', 'buyer', 'shopper'],
      'developers': ['developer', 'engineer', 'programmer'],
      'managers': ['manager', 'supervisor', 'lead'],
      'end users': ['end user', 'user', 'visitor'],
      'support staff': ['support', 'help desk', 'customer service']
    };
    
    Object.entries(userPatterns).forEach(([userType, keywords]) => {
      if (keywords.some(keyword => lowerContent.includes(keyword))) {
        users.push(userType);
      }
    });
    
    return users.length > 0 ? users : ['end users'];
  }

  /**
   * Generate content for a specific field based on analysis
   */
  generateFieldContent(field, analysis, context) {
    const { primaryDomain, specificFeatures, techStack, uiElements, 
            hasColorScheme, hasPersistence, hasRealtime, 
            businessEntities, userTypes } = analysis;
    
    switch(field.toLowerCase()) {
      case 'acceptance_criteria':
        return this.generateAcceptanceCriteria(analysis, context);
      case 'problem':
        return this.generateProblemStatement(analysis, context);
      case 'goals':
        return this.generateGoals(analysis, context);
      case 'references':
        return this.generateReferences(analysis, context);
      case 'stakeholders':
        return this.generateStakeholders(analysis, context);
      default:
        return `## ${field}\n\n[Intelligent content for ${field} based on ${primaryDomain} domain]`;
    }
  }

  generateAcceptanceCriteria(analysis, context) {
    let criteria = '## Acceptance Criteria\n\n';
    const { primaryDomain, specificFeatures, techStack, uiElements, 
            hasColorScheme, hasPersistence, hasRealtime } = analysis;
    
    // Domain-specific criteria
    if (primaryDomain === 'calculator') {
      criteria += '### Core Functionality\n';
      criteria += '- [ ] All arithmetic operations (+, -, ×, ÷) produce mathematically correct results\n';
      criteria += '- [ ] Calculator correctly follows order of operations (PEMDAS/BODMAS)\n';
      criteria += '- [ ] Decimal calculations maintain appropriate precision (at least 10 decimal places)\n';
      criteria += '- [ ] Large numbers are handled without overflow (up to JavaScript MAX_SAFE_INTEGER)\n';
      criteria += '- [ ] Division by zero displays a clear error message ("Cannot divide by zero")\n';
      criteria += '- [ ] Consecutive operations work correctly (e.g., 2 + 3 + 4 = 9)\n';
      
      if (hasColorScheme) {
        criteria += '\n### Visual Design\n';
        criteria += '- [ ] Blue color scheme is consistently applied across all buttons\n';
        criteria += '- [ ] Button hover states provide visual feedback\n';
        criteria += '- [ ] Active/pressed button states are visually distinct\n';
      }
      
      if (uiElements.includes('buttons')) {
        criteria += '\n### User Interface\n';
        criteria += '- [ ] All calculator buttons are clickable and responsive\n';
        criteria += '- [ ] Keyboard input is supported for all operations (0-9, +, -, *, /, Enter, Escape)\n';
        criteria += '- [ ] Display updates in real-time as users input numbers\n';
        criteria += '- [ ] Clear (C) button resets the entire calculation\n';
        criteria += '- [ ] Clear Entry (CE) button clears only the current input\n';
      }
    } else if (primaryDomain === 'editor') {
      criteria += '### Text Editing\n';
      criteria += '- [ ] Users can type and see text appear immediately in the editor\n';
      criteria += '- [ ] Cursor positioning works correctly with mouse clicks\n';
      criteria += '- [ ] Text selection works with click-and-drag\n';
      criteria += '- [ ] Keyboard navigation (arrow keys, Home, End) works correctly\n';
      
      if (specificFeatures.some(f => f.toLowerCase().includes('highlight'))) {
        criteria += '- [ ] Syntax highlighting correctly identifies code elements\n';
        criteria += '- [ ] Highlighting updates in real-time as code is typed\n';
      }
      
      if (hasPersistence) {
        criteria += '\n### Data Persistence\n';
        criteria += '- [ ] Content is auto-saved every 30 seconds\n';
        criteria += '- [ ] Manual save button persists content immediately\n';
        criteria += '- [ ] Saved content persists across browser sessions\n';
        criteria += '- [ ] Recovery mechanism exists for unsaved changes\n';
      }
    } else if (primaryDomain === 'music') {
      criteria += '### Audio Playback\n';
      criteria += '- [ ] Play button starts audio playback immediately\n';
      criteria += '- [ ] Pause button stops playback and maintains current position\n';
      criteria += '- [ ] Audio resumes from correct position after pause\n';
      criteria += '- [ ] Volume control adjusts audio level from 0-100%\n';
      criteria += '- [ ] Mute/unmute toggle works correctly\n';
      
      if (specificFeatures.some(f => f.toLowerCase().includes('playlist'))) {
        criteria += '\n### Playlist Management\n';
        criteria += '- [ ] Songs can be added to playlist\n';
        criteria += '- [ ] Playlist order can be rearranged via drag-and-drop\n';
        criteria += '- [ ] Next/previous track navigation works correctly\n';
        criteria += '- [ ] Current playing track is visually highlighted\n';
      }
      
      if (specificFeatures.some(f => f.toLowerCase().includes('shuffle'))) {
        criteria += '- [ ] Shuffle mode randomizes playback order\n';
        criteria += '- [ ] Shuffle can be toggled on/off during playback\n';
      }
      
      if (specificFeatures.some(f => f.toLowerCase().includes('repeat'))) {
        criteria += '- [ ] Repeat mode options work (repeat one/all/off)\n';
        criteria += '- [ ] Visual indicator shows current repeat mode\n';
      }
      
      criteria += '\n### User Interface\n';
      criteria += '- [ ] Progress bar shows current playback position\n';
      criteria += '- [ ] Clicking progress bar seeks to that position\n';
      criteria += '- [ ] Current time and total duration are displayed\n';
      criteria += '- [ ] Album artwork is displayed when available\n';
    } else if (primaryDomain === 'ecommerce') {
      criteria += '### Shopping Cart\n';
      criteria += '- [ ] Products can be added to cart with single click\n';
      criteria += '- [ ] Cart updates immediately when items are added/removed\n';
      criteria += '- [ ] Quantity can be adjusted for each cart item\n';
      criteria += '- [ ] Cart total is calculated correctly including taxes and shipping\n';
      criteria += '- [ ] Cart persists across browser sessions\n';
      
      criteria += '\n### Checkout Process\n';
      criteria += '- [ ] Checkout flow has clear progress indicators\n';
      criteria += '- [ ] Form validation provides helpful error messages\n';
      criteria += '- [ ] Multiple payment methods are supported\n';
      criteria += '- [ ] Order confirmation is displayed after successful purchase\n';
    }
    
    // Add feature-specific criteria
    if (specificFeatures.length > 0) {
      criteria += '\n### Specific Features\n';
      specificFeatures.slice(0, 5).forEach(feature => {
        if (!criteria.includes(feature)) {
          criteria += `- [ ] ${feature}\n`;
        }
      });
    }
    
    // Technology-specific criteria
    if (techStack.length > 0) {
      criteria += '\n### Technical Requirements\n';
      if (techStack.includes('React')) {
        criteria += '- [ ] Component re-renders are optimized (React.memo where appropriate)\n';
      }
      if (techStack.includes('TypeScript')) {
        criteria += '- [ ] No TypeScript compilation errors\n';
        criteria += '- [ ] Type coverage is at least 90%\n';
      }
      if (techStack.includes('PostgreSQL')) {
        criteria += '- [ ] Database queries are optimized with proper indexes\n';
        criteria += '- [ ] Connection pooling is implemented\n';
      }
    }
    
    // Standard criteria
    criteria += '\n### General Requirements\n';
    criteria += '- [ ] Feature works in Chrome, Firefox, Safari, and Edge\n';
    criteria += '- [ ] Mobile responsive design (320px to 1920px viewport)\n';
    criteria += '- [ ] Page load time is under 3 seconds\n';
    criteria += '- [ ] Accessibility: WCAG 2.1 AA compliance\n';
    criteria += '- [ ] All user actions provide appropriate feedback\n';
    
    return criteria;
  }

  generateProblemStatement(analysis, context) {
    const { primaryDomain, businessEntities, userTypes } = analysis;
    let problem = '## Problem\n\n';
    
    if (primaryDomain === 'calculator') {
      problem += `Users need a reliable and intuitive calculator for performing mathematical operations within the application. `;
      problem += `Current solutions either lack the required functionality, have poor user experience, or don't integrate well with the existing system. `;
      problem += `${userTypes.join(' and ')} require a calculator that not only performs accurate calculations but also provides a visually appealing interface that matches the application's design language.`;
    } else if (primaryDomain === 'editor') {
      problem += `Content creators and ${userTypes.join(', ')} need a powerful text editing solution that goes beyond basic input fields. `;
      problem += `The current text input methods lack essential features like syntax highlighting, proper formatting preservation, and reliable auto-save functionality. `;
      problem += `This limitation significantly impacts productivity, especially when working with code or lengthy documents, leading to data loss and user frustration.`;
    } else if (primaryDomain === 'ecommerce') {
      problem += `Online shoppers are experiencing friction in the purchasing process, leading to cart abandonment rates above industry average. `;
      problem += `The current ${businessEntities.join(' and ')} system lacks modern e-commerce features that customers expect. `;
      problem += `This results in lost revenue, decreased customer satisfaction, and competitive disadvantage in the market.`;
    } else {
      problem += `${userTypes.join(' and ')} are facing challenges with the current implementation of ${context.title || 'this feature'}. `;
      if (businessEntities.length > 0) {
        problem += `The existing system for managing ${businessEntities.join(', ')} is inadequate for current needs. `;
      }
      problem += `These limitations create workflow inefficiencies, increase error rates, and negatively impact user satisfaction. `;
      problem += `A comprehensive solution is needed to address these pain points and improve overall system effectiveness.`;
    }
    
    return problem;
  }

  generateGoals(analysis, context) {
    const { primaryDomain, specificFeatures, hasRealtime, hasPersistence, techStack } = analysis;
    let goals = '## Goals\n\n';
    
    // Primary goals based on domain
    goals += '### Primary Objectives\n';
    if (primaryDomain === 'calculator') {
      goals += '- Deliver 100% accurate mathematical calculations\n';
      goals += '- Provide an intuitive, frustration-free user interface\n';
      goals += '- Achieve sub-100ms response time for all operations\n';
    } else if (primaryDomain === 'editor') {
      goals += '- Enable efficient content creation and editing\n';
      goals += '- Prevent data loss through robust auto-save\n';
      goals += '- Support professional developer workflows\n';
    } else if (primaryDomain === 'ecommerce') {
      goals += '- Increase conversion rate by 15%\n';
      goals += '- Reduce cart abandonment by 20%\n';
      goals += '- Improve average order value by 10%\n';
    } else {
      goals += `- Successfully implement ${context.title || 'core functionality'}\n`;
      goals += '- Improve user satisfaction scores by 25%\n';
      goals += '- Reduce support tickets by 30%\n';
    }
    
    // Feature-specific goals
    if (specificFeatures.length > 0) {
      goals += '\n### Feature Goals\n';
      specificFeatures.slice(0, 3).forEach(feature => {
        goals += `- Fully implement and optimize: ${feature}\n`;
      });
    }
    
    // Technical goals
    if (techStack.length > 0) {
      goals += '\n### Technical Goals\n';
      goals += '- Achieve 95% code coverage with unit tests\n';
      goals += '- Maintain performance budget (Core Web Vitals)\n';
      goals += '- Ensure zero critical security vulnerabilities\n';
    }
    
    if (hasRealtime) {
      goals += '- Deliver real-time updates with <100ms latency\n';
    }
    
    if (hasPersistence) {
      goals += '- Guarantee 99.9% data durability\n';
    }
    
    return goals;
  }

  generateReferences(analysis, context) {
    const { primaryDomain, techStack } = analysis;
    let refs = '## References\n\n';
    
    // Domain-specific references
    refs += '### Domain Resources\n';
    if (primaryDomain === 'calculator') {
      refs += '- IEEE 754 Standard for Floating-Point Arithmetic\n';
      refs += '- MDN: Number.MAX_SAFE_INTEGER documentation\n';
      refs += '- Calculator UI Best Practices (Nielsen Norman Group)\n';
    } else if (primaryDomain === 'editor') {
      refs += '- Monaco Editor API Documentation\n';
      refs += '- CodeMirror Integration Guide\n';
      refs += '- W3C ContentEditable Specification\n';
    } else if (primaryDomain === 'ecommerce') {
      refs += '- Baymard Institute E-commerce UX Guidelines\n';
      refs += '- PCI DSS Compliance Requirements\n';
      refs += '- Stripe/PayPal Integration Documentation\n';
    }
    
    // Tech stack references
    if (techStack.length > 0) {
      refs += '\n### Technical Documentation\n';
      techStack.forEach(tech => {
        refs += `- ${tech} Official Documentation\n`;
      });
    }
    
    // Standard references
    refs += '\n### Standards & Guidelines\n';
    refs += '- WCAG 2.1 Accessibility Guidelines\n';
    refs += '- OWASP Security Best Practices\n';
    refs += '- Google Core Web Vitals\n';
    refs += '- ISO 9241-11: Usability Guidelines\n';
    
    return refs;
  }

  generateStakeholders(analysis, context) {
    const { userTypes, businessEntities } = analysis;
    let stakeholders = '## Stakeholders\n\n';
    
    stakeholders += '### Primary Stakeholders\n';
    userTypes.forEach(userType => {
      stakeholders += `- **${userType.charAt(0).toUpperCase() + userType.slice(1)}** - Primary users who will directly interact with the feature\n`;
    });
    
    stakeholders += '\n### Development Team\n';
    stakeholders += '- **Product Owner** - Defines requirements and acceptance criteria\n';
    stakeholders += '- **UX/UI Designers** - Create user interface and interaction design\n';
    stakeholders += '- **Frontend Developers** - Implement client-side functionality\n';
    stakeholders += '- **Backend Developers** - Build server-side logic and APIs\n';
    stakeholders += '- **QA Engineers** - Ensure quality through comprehensive testing\n';
    
    stakeholders += '\n### Business Stakeholders\n';
    if (businessEntities.includes('payments')) {
      stakeholders += '- **Finance Team** - Oversees payment processing and reconciliation\n';
    }
    if (businessEntities.includes('analytics')) {
      stakeholders += '- **Data Analytics Team** - Tracks metrics and KPIs\n';
    }
    stakeholders += '- **Customer Support** - Handles user inquiries and issues\n';
    stakeholders += '- **DevOps Team** - Manages deployment and infrastructure\n';
    stakeholders += '- **Security Team** - Ensures compliance and security standards\n';
    
    return stakeholders;
  }
}

module.exports = IntelligentAnalyzer;