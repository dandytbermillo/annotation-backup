/**
 * Enhanced Bridge Layer Types with Expert Improvements
 * Strict contracts for Claude-Context-OS integration
 */
export type Tool = 'Task' | 'Grep' | 'Read' | 'WebSearch' | 'WebFetch' | 'Bash';
export interface Route {
    command: string;
    args: string[];
    claudeAgent?: boolean;
    contextAgent?: boolean;
    hybrid?: boolean;
    tools?: Tool[];
    dryRun?: boolean;
}
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
export interface ContextResult {
    status: 'ok' | 'error' | 'partial';
    changes?: string[];
    reportPath?: string;
    patchPath?: string;
    logs?: string[];
    rollback?: string;
}
export interface CombinedResult {
    status: 'ok' | 'error' | 'degraded';
    summary: string;
    artifacts: Record<string, string>;
    diffs?: string[];
    logs?: string[];
    telemetry?: {
        claudeDuration?: number;
        contextDuration?: number;
        totalDuration: number;
        tokensUsed?: number;
    };
}
export interface BudgetConfig {
    maxTokensPerCall: number;
    maxToolsPerCall: number;
    maxParallelCalls: number;
    maxRetries: number;
    timeoutMs: number;
    costAlertThreshold?: number;
}
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
//# sourceMappingURL=types-enhanced.d.ts.map