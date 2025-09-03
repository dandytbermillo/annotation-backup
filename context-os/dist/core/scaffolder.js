"use strict";
/**
 * Scaffolder - Creates feature directory structure and files
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scaffolder = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
class Scaffolder {
    baseDocsPath = 'docs/proposal';
    /**
     * Creates the complete feature structure
     */
    async createStructure(plan) {
        const slug = plan.slug;
        const basePath = path.join(this.baseDocsPath, slug);
        // Define directories to create
        const directories = [
            basePath,
            path.join(basePath, 'reports'),
            path.join(basePath, 'implementation-details'),
            path.join(basePath, 'implementation-details', 'artifacts'),
            path.join(basePath, 'post-implementation-fixes'),
            path.join(basePath, 'post-implementation-fixes', 'critical'),
            path.join(basePath, 'post-implementation-fixes', 'high'),
            path.join(basePath, 'post-implementation-fixes', 'medium'),
            path.join(basePath, 'post-implementation-fixes', 'low'),
            path.join(basePath, 'patches'),
            path.join(basePath, 'test_scripts'),
            path.join(basePath, 'test_pages'),
            path.join(basePath, 'supporting_files')
        ];
        // Create all directories
        for (const dir of directories) {
            await fs.ensureDir(dir);
        }
        // Define files to create
        const files = [
            {
                path: path.join(basePath, 'implementation.md'),
                content: this.generateImplementationMd(plan)
            },
            {
                path: path.join(basePath, 'reports', `${slug}-Implementation-Report.md`),
                content: this.generateMainReport(plan)
            },
            {
                path: path.join(basePath, 'post-implementation-fixes', 'README.md'),
                content: this.generateFixesReadme(plan)
            },
            {
                path: path.join(basePath, 'implementation-details', 'artifacts', 'INDEX.md'),
                content: this.generateArtifactsIndex()
            },
            {
                path: path.join(basePath, 'patches', 'README.md'),
                content: this.generatePatchesReadme()
            }
        ];
        return {
            basePath,
            slug,
            directories,
            files
        };
    }
    /**
     * Writes all files for the structure
     */
    async writeFiles(structure) {
        let count = 0;
        for (const file of structure.files) {
            await fs.writeFile(file.path, file.content, 'utf8');
            count++;
        }
        return count;
    }
    /**
     * Generates implementation.md content
     */
    generateImplementationMd(plan) {
        const lines = [
            `# ${plan.title}`,
            '',
            `**Feature Slug**: ${plan.slug}`,
            `**Date**: ${plan.date || new Date().toISOString().split('T')[0]}`,
            `**Status**: ${this.getStatusEmoji(plan.status)} ${plan.status}`
        ];
        if (plan.author) {
            lines.push(`**Author**: ${plan.author}`);
        }
        lines.push('', '## Objective', '', plan.objective);
        if (plan.background) {
            lines.push('', '## Background', '', plan.background);
        }
        lines.push('', '## Acceptance Criteria', '');
        for (const criterion of plan.acceptanceCriteria) {
            lines.push(`- [ ] ${criterion}`);
        }
        lines.push('', '## Implementation Tasks', '');
        for (const task of plan.implementationTasks) {
            lines.push(`- [ ] ${task}`);
        }
        if (plan.technicalApproach) {
            lines.push('', '## Technical Approach', '', plan.technicalApproach);
        }
        if (plan.dependencies && plan.dependencies.length > 0) {
            lines.push('', '## Dependencies', '');
            for (const dep of plan.dependencies) {
                lines.push(`- ${dep}`);
            }
        }
        if (plan.risks && plan.risks.length > 0) {
            lines.push('', '## Risks & Mitigations', '');
            for (const risk of plan.risks) {
                lines.push(`- ${risk}`);
            }
        }
        if (plan.successMetrics && plan.successMetrics.length > 0) {
            lines.push('', '## Success Metrics', '');
            for (const metric of plan.successMetrics) {
                lines.push(`- ${metric}`);
            }
        }
        if (plan.outOfScope && plan.outOfScope.length > 0) {
            lines.push('', '## Out of Scope', '');
            for (const item of plan.outOfScope) {
                lines.push(`- ${item}`);
            }
        }
        if (plan.notes) {
            lines.push('', '## Notes', '', plan.notes);
        }
        return lines.join('\n');
    }
    /**
     * Generates main report template
     */
    generateMainReport(plan) {
        const title = plan.title;
        const date = plan.date || new Date().toISOString().split('T')[0];
        const statusEmoji = this.getStatusEmoji(plan.status);
        return `# ${title} Implementation Report

**Implementation Plan**: [implementation.md](../implementation.md)
**Date Started**: ${date}
**Date Completed**: TBD
**Status**: ${statusEmoji} ${plan.status}

## Executive Summary
[2-3 sentences maximum once complete]

## Scope of Implementation
- **What Was Planned**: See [implementation.md](../implementation.md)
- **What Was Delivered**: TBD

## Quick Status
⏳ Implementation starting

## Key Metrics
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| TBD | TBD | TBD | TBD |

## Documentation Index

### 📋 Implementation Details
[Links only - no descriptions]
- [Technical documentation will be linked here]

### 🧪 Testing & Validation
⏳ Tests pending
[→ Test results will be linked here]

### 📝 Code Changes
**Files Modified**: TBD
**Lines Changed**: TBD
[→ File list will be linked here]

## Acceptance Criteria ✓
[See implementation.md for criteria]

---
<!-- Phase boundary: Everything above = implementation, below = post-implementation -->

## Post-Implementation Fixes
[→ View all fixes and statistics](../post-implementation-fixes/README.md)

### Recent Fixes
[No fixes yet - feature in progress]`;
    }
    /**
     * Generates fixes README template
     */
    generateFixesReadme(plan) {
        const title = plan.title;
        const date = plan.date || new Date().toISOString().split('T')[0];
        return `# Post-Implementation Fixes Index

**Feature**: ${title}
**Last Updated**: ${date}
**Total Fixes**: 0
**Severity Breakdown**: 🔴 Critical: 0 | 🟠 High: 0 | 🟡 Medium: 0 | 🟢 Low: 0

## 🔴 Critical Issues (Immediate Action Required)
*Definition: Data loss, security, prod down, >50% perf degradation*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No critical issues* | | | | | |

## 🟠 High Priority (Within 24 Hours)
*Definition: Memory leak >25%/day, 25-50% perf, >10% users affected*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No high priority issues* | | | | | |

## 🟡 Medium Priority (Within 1 Week)
*Definition: 10-25% perf degradation, UX disrupted, non-critical broken*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No medium priority issues* | | | | | |

## 🟢 Low Priority (As Time Permits)
*Definition: <10% perf impact, cosmetic, code quality*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No low priority issues* | | | | | |

## Fix Patterns & Lessons Learned
To be updated as fixes are implemented.

## Statistics
- **Average Time to Fix**: TBD
- **Most Affected Environment**: TBD
- **Root Cause Distribution**: TBD`;
    }
    /**
     * Generates artifacts index
     */
    generateArtifactsIndex() {
        return `# Artifacts Index

**Purpose**: Store test results, logs, and verification outputs
**Last Updated**: ${new Date().toISOString().split('T')[0]}

## Artifact Manifest

| File | Description | Date Added |
|------|-------------|------------|
| *No artifacts yet* | | |

## Categories

### Test Results
- Unit test outputs
- Integration test results
- Performance benchmarks

### Logs
- Application logs
- Error logs
- Debug traces

### Verification
- Command outputs
- API responses
- Database queries

## Usage
1. Run tests/commands
2. Capture output to text files
3. Add entry to this index
4. Reference from main report`;
    }
    /**
     * Generates patches README
     */
    generatePatchesReadme() {
        return `# Patches Directory

**Purpose**: Store code patches for review or cross-repo coordination
**Format**: Git format-patch files
**Naming**: YYYY-MM-DD-descriptive-name.patch

## Available Patches

| Date | Patch File | Description | Status |
|------|------------|-------------|--------|
| *No patches yet* | | | |

## How to Apply Patches

\`\`\`bash
# Check patch before applying
git apply --check patch-file.patch

# Apply patch
git apply patch-file.patch

# Or use git am for commits
git am < patch-file.patch
\`\`\`

## Creating Patches

\`\`\`bash
# Create patch from last commit
git format-patch -1 HEAD

# Create patch from specific commits
git format-patch <commit-hash>^..<commit-hash>

# Create patch with specific name
git format-patch -1 HEAD --stdout > 2025-09-03-feature-fix.patch
\`\`\``;
    }
    /**
     * Gets status emoji
     */
    getStatusEmoji(status) {
        const emojis = {
            'PLANNED': '📝',
            'IN_PROGRESS': '🚧',
            'TESTING': '🧪',
            'COMPLETE': '✅',
            'BLOCKED': '❌',
            'ROLLBACK': '🔄'
        };
        return emojis[status] || '📋';
    }
}
exports.Scaffolder = Scaffolder;
//# sourceMappingURL=scaffolder.js.map