/**
 * PlanFillerAgent - Assists in completing missing fields in implementation plans
 */
import { Agent, AgentContext, AgentResult, ValidationResult } from '../core/types';
export declare class PlanFillerAgent extends Agent {
    private rl;
    constructor(context: AgentContext);
    /**
     * Fills missing fields in the plan interactively
     */
    execute(): Promise<AgentResult>;
    /**
     * Validates the current plan
     */
    validate(): ValidationResult;
    /**
     * Fills a specific field
     */
    private fillField;
    /**
     * Gets prompt text for a field
     */
    private getFieldPrompt;
    /**
     * Asks for a single line input
     */
    private askSingleLine;
    /**
     * Asks for multi-line input
     */
    private askMultiLine;
    /**
     * Asks for a list of items
     */
    private askList;
    /**
     * Asks for status selection
     */
    private askStatus;
    /**
     * Cleanup resources
     */
    private cleanup;
    /**
     * Provides suggestions for common fields
     */
    getSuggestions(field: string): string[];
}
//# sourceMappingURL=plan-filler.d.ts.map