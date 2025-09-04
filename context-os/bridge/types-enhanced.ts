/**
 * Enhanced Bridge Layer Types with Expert Improvements
 * Strict contracts for Claude-Context-OS integration
 */

// Tool types - exactly what Claude can use
export type Tool = 'Task' | 'Grep' | 'Read' | 'WebSearch' | 'WebFetch' | 'Bash';

// Route definition - what gets executed where
export interface Route {
  command: string;
  args: string[];
  claudeAgent?: boolean;
  contextAgent?: boolean;
  hybrid?: boolean;
  tools?: Tool[];
  dryRun?: boolean;  // Safety: default true for writes
}

// Claude request - what we send to Claude
export interface ClaudeRequest {
  task: string;
  context?: Record<string, unknown>;
  tools: Tool[];
  budget?: {
    maxTokens?: number;
    maxTools?: number;
    timeoutMs?: number;
  };
}

// Claude result - what Claude returns (strict schema)
export interface ClaudeResult {
  status: 'ok' | 'error' | 'degraded';
  findings?: string[];
  recommendations?: string[];
  confidence?: number;
  logs?: string[];
  metadata?: {
    tokensUsed: number;
    toolsInvoked: Tool[];
    duration: number;
  };
}

// Context-OS result - what our agents return
export interface ContextResult {
  status: 'ok' | 'error' | 'partial';
  changes?: string[];
  reportPath?: string;
  patchPath?: string;  // CRITICAL: always return patch, never silent edits
  logs?: string[];
  rollback?: string;    // How to undo if needed
}

// Combined result - merged output for hybrid commands
export interface CombinedResult {
  status: 'ok' | 'error' | 'degraded';
  summary: string;
  artifacts: Record<string, string>;  // Paths to generated files
  diffs?: string[];     // Visual diffs for review
  logs?: string[];
  telemetry?: {
    claudeDuration?: number;
    contextDuration?: number;
    totalDuration: number;
    tokensUsed?: number;
  };
}

// Budget configuration - prevent runaway costs
export interface BudgetConfig {
  maxTokensPerCall: number;    // Cap Claude tokens
  maxToolsPerCall: number;      // Limit tool invocations
  maxParallelCalls: number;     // Concurrency limit
  maxRetries: number;           // Retry limit
  timeoutMs: number;            // Global timeout
  costAlertThreshold?: number; // Alert if cost exceeds
}

// Telemetry event - for observability
export interface TelemetryEvent {
  timestamp: string;
  sessionId: string;
  command: string;
  route: string;
  tools: Tool[];
  tokenEstimate?: number;
  duration: number;
  exitStatus: 'success' | 'failure' | 'degraded';
  error?: string;
  artifacts?: string[];
}