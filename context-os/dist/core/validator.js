"use strict";
/**
 * Validation utilities for Context-OS
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Validator = void 0;
const types_1 = require("./types");
class Validator {
    static REQUIRED_FIELDS = [
        'title',
        'objective',
        'acceptanceCriteria',
        'implementationTasks'
    ];
    static SLUG_PATTERN = /^[a-z0-9_-]+$/;
    static MAX_SLUG_LENGTH = 50;
    static VALID_STATUSES = Object.values(types_1.Status);
    /**
     * Validates a feature plan
     */
    static validatePlan(plan) {
        const errors = [];
        const warnings = [];
        const missingFields = [];
        // Check required fields
        for (const field of this.REQUIRED_FIELDS) {
            if (!plan[field]) {
                missingFields.push(field);
                errors.push({
                    field,
                    message: `${field} is required`,
                    severity: 'error'
                });
            }
            else if (field === 'acceptanceCriteria' || field === 'implementationTasks') {
                const items = plan[field];
                if (!Array.isArray(items) || items.length === 0) {
                    errors.push({
                        field,
                        message: `${field} must have at least one item`,
                        severity: 'error'
                    });
                }
                else if (items.some(item => !item || item.includes('[TO BE FILLED]'))) {
                    errors.push({
                        field,
                        message: `${field} contains incomplete items`,
                        severity: 'error'
                    });
                }
            }
        }
        // Validate title
        if (plan.title) {
            if (plan.title.length < 3) {
                errors.push({
                    field: 'title',
                    message: 'Title must be at least 3 characters',
                    severity: 'error'
                });
            }
            if (plan.title.length > 100) {
                warnings.push('Title is very long (>100 characters)');
            }
        }
        // Validate slug if provided
        if (plan.slug) {
            if (!this.SLUG_PATTERN.test(plan.slug)) {
                errors.push({
                    field: 'slug',
                    message: 'Slug must contain only lowercase letters, numbers, hyphens, and underscores',
                    severity: 'error'
                });
            }
            if (plan.slug.length > this.MAX_SLUG_LENGTH) {
                errors.push({
                    field: 'slug',
                    message: `Slug must be no more than ${this.MAX_SLUG_LENGTH} characters`,
                    severity: 'error'
                });
            }
        }
        // Validate status
        if (plan.status && !this.VALID_STATUSES.includes(plan.status)) {
            errors.push({
                field: 'status',
                message: `Invalid status. Must be one of: ${this.VALID_STATUSES.join(', ')}`,
                severity: 'error'
            });
        }
        // Validate objective
        if (plan.objective) {
            if (plan.objective.length < 10) {
                errors.push({
                    field: 'objective',
                    message: 'Objective must be at least 10 characters',
                    severity: 'error'
                });
            }
            if (plan.objective.includes('[') && plan.objective.includes(']')) {
                errors.push({
                    field: 'objective',
                    message: 'Objective contains placeholder text',
                    severity: 'error'
                });
            }
        }
        // Check for optional but recommended fields
        if (!plan.author) {
            warnings.push('Author field is recommended');
        }
        if (!plan.successMetrics || plan.successMetrics?.length === 0) {
            warnings.push('Success metrics are recommended for tracking');
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            missingFields
        };
    }
    /**
     * Generates a valid slug from a title
     */
    static generateSlug(title) {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .substring(0, this.MAX_SLUG_LENGTH);
    }
    /**
     * Validates a feature slug
     */
    static validateSlug(slug) {
        const errors = [];
        if (!slug) {
            errors.push({
                field: 'slug',
                message: 'Slug is required',
                severity: 'error'
            });
        }
        else {
            if (!this.SLUG_PATTERN.test(slug)) {
                errors.push({
                    field: 'slug',
                    message: 'Invalid slug format',
                    severity: 'error'
                });
            }
            if (slug.length > this.MAX_SLUG_LENGTH) {
                errors.push({
                    field: 'slug',
                    message: 'Slug too long',
                    severity: 'error'
                });
            }
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings: [],
            missingFields: errors.length > 0 ? ['slug'] : []
        };
    }
    /**
     * Validates directory structure compliance
     */
    static validateStructure(basePath) {
        const errors = [];
        const warnings = [];
        const fs = require('fs');
        const path = require('path');
        const requiredDirs = [
            'reports',
            'implementation-details',
            'post-implementation-fixes'
        ];
        const requiredFiles = [
            'implementation.md',
            'post-implementation-fixes/README.md'
        ];
        // Check required directories
        for (const dir of requiredDirs) {
            const dirPath = path.join(basePath, dir);
            if (!fs.existsSync(dirPath)) {
                errors.push({
                    field: 'structure',
                    message: `Missing required directory: ${dir}`,
                    severity: 'error'
                });
            }
        }
        // Check required files
        for (const file of requiredFiles) {
            const filePath = path.join(basePath, file);
            if (!fs.existsSync(filePath)) {
                errors.push({
                    field: 'structure',
                    message: `Missing required file: ${file}`,
                    severity: 'error'
                });
            }
        }
        // Check for severity subdirectories
        const severities = ['critical', 'high', 'medium', 'low'];
        const fixesPath = path.join(basePath, 'post-implementation-fixes');
        if (fs.existsSync(fixesPath)) {
            for (const severity of severities) {
                const severityPath = path.join(fixesPath, severity);
                if (!fs.existsSync(severityPath)) {
                    warnings.push(`Missing severity directory: ${severity}`);
                }
            }
        }
        // Check for deprecated patterns
        const reportsFixesPath = path.join(basePath, 'reports', 'fixes');
        if (fs.existsSync(reportsFixesPath)) {
            errors.push({
                field: 'structure',
                message: 'Deprecated pattern found: reports/fixes/',
                severity: 'error'
            });
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            missingFields: []
        };
    }
    /**
     * Validates phase transitions
     */
    static validateStatusTransition(currentStatus, newStatus) {
        // Cannot go backward from COMPLETE
        if (currentStatus === types_1.Status.COMPLETE && newStatus !== types_1.Status.COMPLETE) {
            return false;
        }
        // Valid transitions
        const validTransitions = {
            [types_1.Status.PLANNED]: [types_1.Status.IN_PROGRESS, types_1.Status.BLOCKED],
            [types_1.Status.IN_PROGRESS]: [types_1.Status.TESTING, types_1.Status.BLOCKED, types_1.Status.ROLLBACK],
            [types_1.Status.TESTING]: [types_1.Status.COMPLETE, types_1.Status.IN_PROGRESS, types_1.Status.BLOCKED],
            [types_1.Status.COMPLETE]: [types_1.Status.COMPLETE],
            [types_1.Status.BLOCKED]: [types_1.Status.PLANNED, types_1.Status.IN_PROGRESS, types_1.Status.TESTING],
            [types_1.Status.ROLLBACK]: [types_1.Status.PLANNED, types_1.Status.BLOCKED]
        };
        return validTransitions[currentStatus]?.includes(newStatus) ?? false;
    }
}
exports.Validator = Validator;
//# sourceMappingURL=validator.js.map