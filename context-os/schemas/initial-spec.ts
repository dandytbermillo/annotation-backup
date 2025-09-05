// context-os/schemas/initial-spec.ts
import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';

// Field-level validators (deterministic, close to schema)
const sentenceCount = (min: number, max: number) => 
  z.string().refine(s => {
    const sentences = s.split(/[.!?]+/).filter(Boolean);
    return sentences.length >= min && sentences.length <= max;
  }, `Must be ${min}-${max} sentences`);

const bulletPoints = (min: number, max: number, maxLength = 120) =>
  z.array(z.string().max(maxLength)).min(min).max(max);

export const InitialSpecSchema = z.object({
  // Version for migration support
  schemaVersion: z.literal(SCHEMA_VERSION),
  
  // Required fields with strict validation
  featureSlug: z.string().regex(/^[a-z0-9_]+$/, 'Lowercase letters, numbers, and underscores only'),
  title: z.string().min(5).max(80),
  problem: sentenceCount(3, 6),
  goals: bulletPoints(3, 7, 100),
  acceptanceCriteria: bulletPoints(3, 7, 120),
  stakeholders: z.array(z.string()).min(2).max(6),
  
  // Optional fields
  nonGoals: bulletPoints(1, 5, 100).optional(),
  dependencies: z.array(z.string()).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  metrics: bulletPoints(1, 5, 100).optional(),
  
  // Metadata
  createdAt: z.string().datetime(),
  createdBy: z.string().default('context-os-init'),
  sessionId: z.string().uuid()
});

export type InitialSpec = z.infer<typeof InitialSpecSchema>;

// Migration support for future schema versions
export async function migrateSchema(data: any, fromVersion: string): Promise<InitialSpec> {
  if (fromVersion === '1.0.0') return data;
  
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
export class InitialValidator {
  static validateSentences(text: string): { valid: boolean; count: number; message: string } {
    const sentences = text.split(/[.!?]+/).filter(Boolean);
    const count = sentences.length;
    
    if (count < 3) return { valid: false, count, message: `Too short: ${count} sentences (min: 3)` };
    if (count > 6) return { valid: false, count, message: `Too long: ${count} sentences (max: 6)` };
    
    return { valid: true, count, message: `Perfect: ${count} sentences` };
  }
  
  static suggestImprovements(spec: Partial<InitialSpec>): string[] {
    const suggestions: string[] = [];
    
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