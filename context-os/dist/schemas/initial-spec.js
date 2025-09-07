"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitialValidator = exports.InitialSpecSchema = exports.SCHEMA_VERSION = void 0;
exports.migrateSchema = migrateSchema;
// context-os/schemas/initial-spec.ts
const zod_1 = require("zod");
exports.SCHEMA_VERSION = '1.0.0';
// Field-level validators (deterministic, close to schema)
const sentenceCount = (min, max) => zod_1.z.string().refine(s => {
    const sentences = s.split(/[.!?]+/).filter(Boolean);
    return sentences.length >= min && sentences.length <= max;
}, `Must be ${min}-${max} sentences`);
const bulletPoints = (min, max, maxLength = 120) => zod_1.z.array(zod_1.z.string().max(maxLength)).min(min).max(max);
exports.InitialSpecSchema = zod_1.z.object({
    // Version for migration support
    schemaVersion: zod_1.z.literal(exports.SCHEMA_VERSION),
    // Required fields with strict validation
    featureSlug: zod_1.z.string().regex(/^[a-z0-9_]+$/, 'Lowercase letters, numbers, and underscores only'),
    title: zod_1.z.string().min(5).max(80),
    problem: sentenceCount(3, 6),
    goals: bulletPoints(3, 7, 100),
    acceptanceCriteria: bulletPoints(3, 7, 120),
    stakeholders: zod_1.z.array(zod_1.z.string()).min(2).max(6),
    // Optional fields
    nonGoals: bulletPoints(1, 5, 100).optional(),
    dependencies: zod_1.z.array(zod_1.z.string()).optional(),
    severity: zod_1.z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    metrics: bulletPoints(1, 5, 100).optional(),
    // Metadata
    createdAt: zod_1.z.string().datetime(),
    createdBy: zod_1.z.string().default('context-os-init'),
    sessionId: zod_1.z.string().uuid()
});
// Migration support for future schema versions
async function migrateSchema(data, fromVersion) {
    if (fromVersion === '1.0.0')
        return data;
    // Future migrations
    // if (fromVersion === '0.9.0') {
    //   data.schemaVersion = '1.0.0';
    //   data.severity = data.priority || 'medium';
    //   delete data.priority;
    //   return data;
    // }
    throw new Error(`Unknown schema version: ${fromVersion}`);
}
// Validation Helpers
class InitialValidator {
    static validateSentences(text) {
        const sentences = text.split(/[.!?]+/).filter(Boolean);
        const count = sentences.length;
        if (count < 3)
            return { valid: false, count, message: `Too short: ${count} sentences (min: 3)` };
        if (count > 6)
            return { valid: false, count, message: `Too long: ${count} sentences (max: 6)` };
        return { valid: true, count, message: `Perfect: ${count} sentences` };
    }
    static suggestImprovements(spec) {
        const suggestions = [];
        if (spec.goals?.length === 1) {
            suggestions.push('Consider adding 2-3 more specific goals');
        }
        if (spec.severity === 'critical' && !spec.metrics?.length) {
            suggestions.push('Critical features should include success metrics');
        }
        if (!spec.dependencies?.length) {
            suggestions.push('Consider listing any system dependencies');
        }
        return suggestions;
    }
}
exports.InitialValidator = InitialValidator;
//# sourceMappingURL=initial-spec.js.map