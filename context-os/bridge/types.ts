/**
 * Bridge Layer Type Definitions
 * Defines the contract between Claude Agent and Context-OS
 */

// Request from Context-OS to Claude
export interface ClaudeBridgeRequest {
  command: string;                    // The slash command or action
  context: 'minimal' | 'full';        // How much context to provide
  tools: ('Task' | 'WebSearch' | 'WebFetch' | 'Grep' | 'Read')[];
  parameters?: {
    feature?: string;
    issue?: string;
    severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    [key: string]: any;
  };
  timeout?: number;                   // Max time to wait for Claude
}

// Response from Claude to Context-OS
export interface ClaudeBridgeResponse {
  agent: string;                      // Which Claude agent responded
  status: 'success' | 'error' | 'partial';
  result: {
    findings: string[];                // What Claude discovered
    patterns?: string[];               // Patterns identified
    recommendations?: string[];        // Suggested actions
    confidence: number;                // 0-1 confidence score
    data?: any;                       // Agent-specific data
  };
  next?: {
    action: string;                    // What Context-OS should do next
    target: 'context-os' | 'claude' | 'user';
    parameters?: any;
  };
  metadata?: {
    duration: number;                  // Time taken
    tokensUsed?: number;              // Context consumed
    toolsUsed: string[];              // Which tools were invoked
  };
}

// Workflow definition
export interface HybridWorkflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  rollbackStrategy?: 'auto' | 'manual' | 'none';
}

export interface WorkflowStep {
  id: string;
  executor: 'claude' | 'context-os' | 'parallel';
  action: string;
  inputs?: any;
  outputs?: string[];                 // Expected output keys
  onError?: 'continue' | 'abort' | 'retry';
  retryCount?: number;
}

// Agent capabilities mapping
export interface AgentCapabilities {
  claude: {
    search: boolean;
    analyze: boolean;
    generate: boolean;
    validate: boolean;
  };
  contextOS: {
    scaffold: boolean;
    validate: boolean;
    classify: boolean;
    patch: boolean;
  };
}

// Command routing configuration
export interface CommandRoute {
  command: string;
  pattern: RegExp;
  claudeAgent?: string[];
  contextAgent?: string[];
  hybrid?: boolean;
  workflow?: string;                  // Reference to workflow ID
}

// Bridge state management
export interface BridgeState {
  sessionId: string;
  activeWorkflows: Map<string, WorkflowExecution>;
  commandHistory: CommandExecution[];
  agentStates: Map<string, any>;
}

export interface WorkflowExecution {
  workflowId: string;
  currentStep: number;
  status: 'running' | 'paused' | 'completed' | 'failed';
  startTime: Date;
  results: Map<string, any>;
}

export interface CommandExecution {
  command: string;
  timestamp: Date;
  request: ClaudeBridgeRequest;
  response: ClaudeBridgeResponse;
  duration: number;
}