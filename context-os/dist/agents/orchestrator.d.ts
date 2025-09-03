/**
 * Orchestrator Agent - Main coordinator for Context-OS
 */
import { Agent, AgentContext, AgentResult, ValidationResult } from '../core/types';
export declare class Orchestrator extends Agent {
    private rl;
    private scaffolder;
    constructor(context: AgentContext);
    /**
     * Main execution flow
     */
    execute(): Promise<AgentResult>;
    /**
     * Validates the feature plan
     */
    validate(): ValidationResult;
    /**
     * Proposes a feature slug
     */
    private proposeSlug;
    /**
     * Handles validation failures
     */
    private handleValidationFailure;
    /**
     * Gets user confirmation
     */
    private getConfirmation;
    /**
     * Scaffolds the feature structure
     */
    private scaffold;
    /**
     * Helper to ask user questions
     */
    private askUser;
    /**
     * Logging helper
     */
    private log;
    /**
     * Cleanup resources
     */
    private cleanup;
    /**
     * Checks if we can proceed with an operation
     */
    checkStopConditions(): string[];
}
//# sourceMappingURL=orchestrator.d.ts.map