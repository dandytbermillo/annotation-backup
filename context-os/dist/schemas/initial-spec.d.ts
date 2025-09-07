import { z } from 'zod';
export declare const SCHEMA_VERSION = "1.0.0";
export declare const InitialSpecSchema: any;
export type InitialSpec = z.infer<typeof InitialSpecSchema>;
export declare function migrateSchema(data: any, fromVersion: string): Promise<InitialSpec>;
export declare class InitialValidator {
    static validateSentences(text: string): {
        valid: boolean;
        count: number;
        message: string;
    };
    static suggestImprovements(spec: Partial<InitialSpec>): string[];
}
//# sourceMappingURL=initial-spec.d.ts.map