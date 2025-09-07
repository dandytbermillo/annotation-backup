/**
 * Command Routing Configuration
 * Maps slash commands to appropriate agents and workflows
 */

// Normalize command by removing optional 'context-' prefix
function normalizeCommand(command) {
  return command.replace(/^\/context-/, '/');
}

const commandRoutes = [
  {
    command: '/execute',
    pattern: /^\/(context-)?execute\s+"([^"]+)"(.*)$/,
    claudeAgent: null,  // Pure Context-OS operation
    contextAgent: ['orchestrator.ts', 'scaffolder.ts'],
    hybrid: false,
    workflow: 'feature-creation',
    description: 'Creates compliant feature structure'
  },
  
  {
    command: '/fix',
    pattern: /^\/(context-)?fix\s+(.*)$/,  // More flexible pattern, parse args later
    claudeAgent: ['Task'],  // For root cause analysis
    contextAgent: ['classifier-agent.js', 'docfix.ts'],
    hybrid: true,
    workflow: 'intelligent-fix',
    description: 'Analyzes issue, classifies, and creates fix'
  },
  
  {
    command: '/validate',
    pattern: /^\/(context-)?validate\s+(\S+)?(\s+--strict)?$/,
    claudeAgent: null,  // Pure validation
    contextAgent: ['validate-doc-structure.sh'],
    hybrid: false,
    workflow: 'validation',
    description: 'Checks documentation compliance'
  },
  
  {
    command: '/review',
    pattern: /^\/review\s+(\S+)$/,
    claudeAgent: ['Task'],  // Semantic review
    contextAgent: ['verifier.ts', 'validator.ts'],
    hybrid: true,
    workflow: 'comprehensive-review',
    description: 'Code quality + compliance review'
  },
  
  {
    command: '/migrate',
    pattern: /^\/migrate\s+(\S+)\s+--to\s+(\S+)$/,
    claudeAgent: ['Task', 'WebSearch'],  // Understand + research
    contextAgent: ['migrator.ts'],
    hybrid: true,
    workflow: 'intelligent-migration',
    description: 'Migrates to new structure with intelligence'
  },
  
  {
    command: '/analyze',
    pattern: /^\/analyze\s+(\S+)$/,
    claudeAgent: ['Task'],  // Deep analysis
    contextAgent: null,  // Just analysis, no action
    hybrid: false,
    workflow: 'feature-analysis',
    description: 'Semantic analysis of feature'
  },
  
  {
    command: '/discover',
    pattern: /^\/discover\s+(issues|todos|patterns)(\s+--in\s+(\S+))?$/,
    claudeAgent: ['Task', 'Grep'],  // Find patterns
    contextAgent: ['classifier-agent.js'],  // Classify findings
    hybrid: true,
    workflow: 'discovery',
    description: 'Discovers issues/patterns and classifies them'
  },
  
  {
    command: '/generate',
    pattern: /^\/generate\s+(docs|tests|implementation)\s+--for\s+(\S+)$/,
    claudeAgent: ['Task'],  // Generate content
    contextAgent: ['doc-writer.ts', 'scaffolder.ts'],  // Structure it
    hybrid: true,
    workflow: 'content-generation',
    description: 'Generates and structures content'
  }
];

/**
 * Workflow definitions for hybrid operations
 */
const workflows = {
  'intelligent-fix': {
    steps: [
      { executor: 'claude', action: 'analyze-issue', tools: ['Task', 'Grep'] },
      { executor: 'context-os', action: 'classify-severity', agent: 'classifier-agent.js' },
      { executor: 'claude', action: 'suggest-fix', tools: ['Task'] },
      { executor: 'context-os', action: 'create-fix-doc', agent: 'fix-workflow.js' },
      { executor: 'context-os', action: 'validate', agent: 'validator.ts' }
    ]
  },
  
  'comprehensive-review': {
    steps: [
      { 
        executor: 'parallel', 
        actions: [
          { executor: 'claude', action: 'semantic-review', tools: ['Task'] },
          { executor: 'context-os', action: 'compliance-check', agent: 'validator.ts' }
        ]
      },
      { executor: 'context-os', action: 'combine-reports', agent: 'report-generator.js' }
    ]
  },
  
  'intelligent-migration': {
    steps: [
      { executor: 'claude', action: 'understand-current', tools: ['Task', 'Read'] },
      { executor: 'claude', action: 'research-best-practices', tools: ['WebSearch'] },
      { executor: 'context-os', action: 'plan-migration', agent: 'migrator.ts' },
      { executor: 'claude', action: 'validate-plan', tools: ['Task'] },
      { executor: 'context-os', action: 'execute-migration', agent: 'migrator.ts' },
      { executor: 'context-os', action: 'validate-result', agent: 'validator.ts' }
    ]
  },
  
  'discovery': {
    steps: [
      { executor: 'claude', action: 'search-patterns', tools: ['Task', 'Grep'] },
      { executor: 'context-os', action: 'classify-findings', agent: 'classifier-agent.js' },
      { executor: 'context-os', action: 'create-fixes', agent: 'fix-workflow.js' },
      { executor: 'context-os', action: 'generate-report', agent: 'report-generator.js' }
    ]
  }
};

/**
 * Decision matrix for agent selection
 */
const decisionMatrix = {
  // Task characteristics → Best agent
  'needs-semantic-understanding': 'claude',
  'needs-pattern-recognition': 'claude',
  'needs-web-research': 'claude',
  'needs-complex-search': 'claude',
  'needs-structure-creation': 'context-os',
  'needs-validation': 'context-os',
  'needs-classification': 'context-os',
  'needs-patch-generation': 'context-os',
  'needs-both': 'hybrid'
};

/**
 * Router class to handle command routing
 */
class CommandRouter {
  constructor() {
    this.routes = commandRoutes;
    this.workflows = workflows;
  }
  
  /**
   * Route a command to appropriate agents
   */
  route(command) {
    // Normalize command to handle both /context-* and /* forms
    const normalizedCmd = normalizeCommand(command);
    
    for (const route of this.routes) {
      const match = command.match(route.pattern);
      if (match) {
        return {
          command: route.command,
          matches: match.slice(1),  // Captured groups
          claudeAgent: route.claudeAgent,
          contextAgent: route.contextAgent,
          hybrid: route.hybrid,
          workflow: route.workflow ? this.workflows[route.workflow] : null,
          description: route.description
        };
      }
    }
    
    return {
      command: 'unknown',
      error: 'No matching route found'
    };
  }
  
  /**
   * Get execution plan for a command
   */
  getExecutionPlan(command) {
    const route = this.route(command);
    
    if (route.error) {
      return route;
    }
    
    const plan = {
      command: route.command,
      description: route.description,
      steps: []
    };
    
    if (route.workflow) {
      // Use predefined workflow
      plan.steps = route.workflow.steps;
    } else if (route.hybrid) {
      // Create hybrid plan
      plan.steps = [
        { executor: 'claude', agents: route.claudeAgent },
        { executor: 'context-os', agents: route.contextAgent }
      ];
    } else if (route.claudeAgent) {
      // Claude only
      plan.steps = [{ executor: 'claude', agents: route.claudeAgent }];
    } else if (route.contextAgent) {
      // Context-OS only
      plan.steps = [{ executor: 'context-os', agents: route.contextAgent }];
    }
    
    return plan;
  }
}

module.exports = {
  commandRoutes,
  workflows,
  decisionMatrix,
  CommandRouter
};