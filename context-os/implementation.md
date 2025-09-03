# Context-OS Implementation Guide

**Version**: 1.0.0  
**Last Updated**: 2025-09-03  
**Status**: 🚧 IN PROGRESS

## Overview

Context-OS is a lightweight agent-based orchestration layer that ensures compliant, safe, and intelligent documentation workflows. It enforces the Documentation Process Guide v1.4.5 through automated validation, scaffolding, and workflow management.

## Architecture

```
context-os/
├── implementation.md          # This file
├── tech-stack.md             # Technology choices
├── coding-style.md           # Coding conventions
├── agents/                   # Agent implementations
│   ├── orchestrator.ts       # Main coordinator
│   ├── plan-filler.ts        # Interactive plan completion
│   ├── verifier.ts           # Test execution & artifacts
│   ├── classifier.ts         # Severity classification
│   └── doc-writer.ts         # Documentation generation
├── core/                     # Core utilities
│   ├── validator.ts          # Plan & structure validation
│   ├── scaffolder.ts         # Directory creation
│   └── types.ts              # Type definitions
├── templates/                # Document templates
│   ├── implementation.md     # Feature plan template
│   ├── report.md            # Main report template
│   └── fix.md               # Fix report template
└── index.ts                  # Main entry point
```

## Agent Responsibilities

### Orchestrator Agent
**Primary Role**: Coordination and routing
- Parses user requests
- Proposes feature slugs  
- Validates plans against requirements
- Manages confirmation gates
- Routes to appropriate agents
- Enforces stop conditions

### PlanFillerAgent  
**Primary Role**: Plan completion
- Identifies missing required fields
- Asks focused questions
- Validates responses
- Updates plan incrementally
- Ensures compliance before proceeding

### VerifierAgent
**Primary Role**: Test execution
- Runs test commands safely
- Captures output and artifacts
- Stores results in proper locations
- Validates test results
- Updates status markers

### ClassifierAgent
**Primary Role**: Severity assignment
- Analyzes metrics and impact
- Applies Rule 5 severity criteria
- Considers environment multipliers
- Documents justification
- Ensures consistent classification

### DocWriterAgent
**Primary Role**: Documentation generation
- Creates fix reports
- Updates README indexes
- Maintains links and references
- Follows templates strictly
- Preserves phase boundaries

## Core Workflows

### 1. Feature Creation Workflow

```typescript
Request → Parse → Validate → Confirm → Scaffold → Complete
         ↓
    Missing Fields?
         ↓
    PlanFillerAgent
```

### 2. Fix Documentation Workflow

```typescript
Bug Report → Check Status → Classify → Create Fix → Update Index
                              ↓
                        ClassifierAgent
```

### 3. Verification Workflow

```typescript
Test Request → Validate Safe → Execute → Capture → Store
                                  ↓
                            VerifierAgent
```

## Validation Rules

### Required Plan Fields
1. Feature Slug
2. Status
3. Objective  
4. Acceptance Criteria
5. Implementation Tasks

### Valid Status Values
- 📝 PLANNED
- 🚧 IN PROGRESS
- 🧪 TESTING
- ✅ COMPLETE
- ❌ BLOCKED
- 🔄 ROLLBACK

### Stop Conditions
The system MUST stop when:
1. Plan fields are missing or invalid
2. User declines confirmation
3. Write would be outside feature folder
4. Attempt to modify implementation-details after COMPLETE
5. Severity classification lacks metrics
6. Any security concern is detected

## State Machine

```
INIT → PARSING → VALIDATING → CONFIRMING → SCAFFOLDING → COMPLETE
         ↓           ↓            ↓            ↓
       ERROR      BLOCKED      CANCELLED    FAILED
```

## Directory Creation Rules

### Standard Structure
```
docs/proposal/<feature_slug>/
├── implementation.md                    # Plan (never renamed)
├── reports/
│   └── <slug>-Implementation-Report.md  # Main report
├── implementation-details/
│   └── artifacts/
│       └── INDEX.md
├── post-implementation-fixes/
│   ├── README.md                       # Mandatory index
│   ├── critical/
│   ├── high/
│   ├── medium/
│   └── low/
└── patches/
    └── README.md
```

## Integration Points

### With Documentation Process Guide
- Enforces all 8 active rules
- Creates Rule 1 directory structure
- Generates Rule 2 TOC-style reports
- Validates Rule 7 status values
- Implements Rule 8 patches structure

### With Validation Script
```bash
# After any Context-OS operation
./scripts/validate-doc-structure.sh
# Should always return 0 errors
```

### With TodoWrite Tool
- Updates task status during operations
- Tracks feature progress
- Links to created documentation

## Error Handling

### User Errors
- Missing information → PlanFillerAgent
- Invalid slug → Suggest alternatives
- Declined confirmation → Clean exit

### System Errors  
- File permissions → Clear error message
- Existing feature → Offer merge or new slug
- Network issues → Retry with backoff

### Validation Errors
- Missing fields → List and offer to fill
- Invalid status → Show valid options
- Structure violations → Prevent and explain

## Security Considerations

1. **File System Access**
   - Only write within docs/proposal/
   - Validate all paths before operations
   - No execution of user-provided code

2. **Command Execution**
   - Whitelist allowed commands
   - Sanitize all inputs
   - Run in sandboxed environment

3. **Data Validation**
   - Validate all user inputs
   - Escape special characters
   - Prevent injection attacks

## Testing Strategy

### Unit Tests
- Each agent tested independently
- Validation logic coverage
- Error handling paths

### Integration Tests
- Full workflow execution
- Agent communication
- File system operations

### Compliance Tests
- Generated structure validation
- Documentation Process Guide adherence
- Status transition rules

## Performance Targets

- Feature creation: <30 seconds
- Plan validation: <1 second
- Structure scaffolding: <5 seconds
- Compliance check: <2 seconds

## Future Enhancements

1. **Web UI** - Browser-based interface
2. **CI/CD Integration** - GitHub Actions, GitLab CI
3. **Multi-language Support** - Beyond English
4. **Analytics Dashboard** - Usage metrics and compliance rates
5. **Plugin System** - Custom agents and validators

## Maintenance

### Versioning
- Semantic versioning (MAJOR.MINOR.PATCH)
- Breaking changes in MAJOR only
- Backward compatibility maintained

### Updates
- Documentation Process Guide changes → Update validators
- New rules → Add enforcement logic
- Bug fixes → Patch releases

### Monitoring
- Log all operations
- Track success/failure rates
- Monitor performance metrics

---

**Note**: This implementation guide is the authoritative source for Context-OS behavior. All agents must comply with these specifications.