/**
 * Scaffolder - Creates feature directory structure and files
 */
import { FeaturePlan, FeatureStructure } from './types';
export declare class Scaffolder {
    private readonly baseDocsPath;
    /**
     * Creates the complete feature structure
     */
    createStructure(plan: FeaturePlan): Promise<FeatureStructure>;
    /**
     * Writes all files for the structure
     */
    writeFiles(structure: FeatureStructure): Promise<number>;
    /**
     * Generates implementation.md content
     */
    private generateImplementationMd;
    /**
     * Generates main report template
     */
    private generateMainReport;
    /**
     * Generates fixes README template
     */
    private generateFixesReadme;
    /**
     * Generates artifacts index
     */
    private generateArtifactsIndex;
    /**
     * Generates patches README
     */
    private generatePatchesReadme;
    /**
     * Gets status emoji
     */
    private getStatusEmoji;
}
//# sourceMappingURL=scaffolder.d.ts.map