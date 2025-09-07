/**
 * Bridge Layer Type Definitions
 * Defines the contract between Claude Agent and Context-OS
 */
export interface ClaudeBridgeRequest {
    command: string;
    context: 'minimal' | 'full';
    tools: ('Task' | 'WebSearch' | 'WebFetch' | 'Grep' | 'Read')[];
    parameters?: {
        feature?: string;
        issue?: string;
        severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
        [key: string]: any;
    };
    timeout?: number;
}
export interface ClaudeBridgeResponse {
    agent: string;
    status: 'success' | 'error' | 'partial';
    result: {
        findings: string[];
        patterns?: string[];
        recommendations?: string[];
        confidence: number;
        data?: any;
    };
    next?: {
        action: string;
        target: 'context-os' | 'claude' | 'user';
        parameters?: any;
    };
    metadata?: {
        duration: number;
        tokensUsed?: number;
        toolsUsed: string[];
    };
}
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
    outputs?: string[];
    onError?: 'continue' | 'abort' | 'retry';
    retryCount?: number;
}
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
export interface CommandRoute {
    command: string;
    pattern: RegExp;
    claudeAgent?: string[];
    contextAgent?: string[];
    hybrid?: boolean;
    workflow?: string;
}
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
//# sourceMappingURL=types.d.ts.map