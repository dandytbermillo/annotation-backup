/**
 * VerifierAgent - Handles test execution and artifact collection
 */
import { Agent, AgentResult, ValidationResult } from '../core/types';
export declare class VerifierAgent extends Agent {
    private readonly allowedCommands;
    /**
     * Executes verification tests
     */
    execute(command?: string): Promise<AgentResult>;
    /**
     * Validates the agent can run
     */
    validate(): ValidationResult;
    /**
     * Checks if a command is safe to run
     */
    private isCommandSafe;
    /**
     * Detects the test command to use
     */
    private detectTestCommand;
    /**
     * Runs a command and captures output
     */
    private runCommand;
    /**
     * Saves test artifacts
     */
    private saveArtifacts;
    /**
     * Updates the artifacts index
     */
    private updateArtifactsIndex;
    /**
     * Runs specific verification checks
     */
    runChecks(): Promise<AgentResult>;
    private checkStructure;
    private checkDependencies;
    private checkLinting;
    private checkTypes;
}
//# sourceMappingURL=verifier.d.ts.map