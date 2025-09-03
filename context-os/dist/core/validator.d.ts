/**
 * Validation utilities for Context-OS
 */
import { FeaturePlan, ValidationResult, Status } from './types';
export declare class Validator {
    private static readonly REQUIRED_FIELDS;
    private static readonly SLUG_PATTERN;
    private static readonly MAX_SLUG_LENGTH;
    private static readonly VALID_STATUSES;
    /**
     * Validates a feature plan
     */
    static validatePlan(plan: Partial<FeaturePlan>): ValidationResult;
    /**
     * Generates a valid slug from a title
     */
    static generateSlug(title: string): string;
    /**
     * Validates a feature slug
     */
    static validateSlug(slug: string): ValidationResult;
    /**
     * Validates directory structure compliance
     */
    static validateStructure(basePath: string): ValidationResult;
    /**
     * Validates phase transitions
     */
    static validateStatusTransition(currentStatus: Status, newStatus: Status): boolean;
}
//# sourceMappingURL=validator.d.ts.map