# Create PRP

## Feature file: $ARGUMENTS

Generate a complete PRP for general feature implementation with thorough research. Ensure context is passed to the AI agent to enable self-validation and iterative refinement. Read the feature file first to understand what needs to be created, how the examples provided help, and any other considerations.

The AI agent only gets the context you are appending to the PRP and training data. Assume the AI agent has access to the codebase and the same knowledge cutoff as you, so its important that your research findings are included or referenced in the PRP. The Agent has Websearch capabilities, so pass urls to documentation and examples.



## Core Principles for PRP Generation
- **Context is King**: Include all necessary context for one-pass success
- **Progressive Success**: Start simple, validate, then enhance
- **Validation First**: Test at every step before proceeding
- **Follow Global Rules**: Adhere to CLAUDE.md and project conventions
- **Minimize Dependencies**: Keep implementations lean and focused
  

### Authoritative Context
- Always load and comply with `CLAUDE.md` at the repo root.  
- Treat `CLAUDE.md` as **highest priority** over all other documentation.  
- PRPs must explicitly reference `CLAUDE.md` when defining conventions, coding rules, or scope guardrails.

## Research Process

1. **Codebase Analysis**
   - Search for similar features/patterns in the codebase
   - Identify files to reference in PRP
   - Note existing conventions to follow
   - Check test patterns for validation approach
   - Document dependency graph and integration points

2. **External Research**
   - Search for similar features/patterns online
   - Library documentation (include specific URLs with sections)
   - Implementation examples (GitHub/StackOverflow/blogs)
   - Best practices and common pitfalls
   - Performance benchmarks and optimization strategies

3. **User Clarification** (if needed)
   - Specific patterns to mirror and where to find them?
   - Integration requirements and where to find them?
   - Performance requirements and constraints?
   - Security considerations?

### Applicability Rules (read from `initial*.md` metadata)

- If `db_schema_changes: true`:
  - Require reversible migrations: `.up.sql` **and** `.down.sql`
  - Add migration validation gates (forward + rollback in CI)
  - Require docs update for DB diagrams / schema references

- If `targets` includes `electron` and `web`:
  - Require cross-platform validation gates (web + electron)
  - Require platform checks/guards in code (e.g., `isElectron()`)

- If `security_sensitive: true`:
  - Add security checklist + specific scans (e.g., dependency audit, authZ tests)

- If `performance_sensitive: true`:
  - Add explicit perf budgets, profiling steps, and perf gates in CI

- Always:
  - Include Feature Complexity Assessment (lightweight vs heavyweight PRP)
  - Include Confidence Score + Readiness

## PRP Generation

Using PRPs/templates/prp_base.md as template:

### Critical Context to Include and pass to the AI agent as part of the PRP
- **Documentation**: URLs with specific sections and version numbers
- **Code Examples**: Real snippets from codebase with file paths and line numbers
- **Gotchas**: Library quirks, version issues, known bugs
- **Patterns**: Existing approaches to follow with exact file references
- **Dependencies**: Complete dependency graph for the feature

### Environment Requirements Section (MUST INCLUDE)
- **Required Tools**: List with specific versions (e.g., Node 20.x, Postgres 15)
- **Environment Variables**: Complete list with example values
- **External Services**: APIs, databases, third-party services
- **Configuration Files**: Paths and purpose of each
- **Development Setup**: Exact commands to set up local environment

### Enhanced Success Criteria (Measurable)
- [ ] Feature functionality matches INITIAL.md requirements exactly
- [ ] All unit tests pass (specify test files)
- [ ] All integration tests pass (specify test files)
- [ ] No regression in existing functionality (list affected areas)
- [ ] Performance within acceptable bounds (specify metrics)
- [ ] Security requirements met (list specific checks)
- [ ] Documentation updated (list files to update)
  
- [ ] If `db_schema_changes: true`: reversible migrations provided (`.up.sql` and `.down.sql`) and tested
- [ ] If `targets: [web, electron]`: parity verified in both environments; platform guards in place
- [ ] If `security_sensitive: true`: security checks listed and passing
- [ ] If `performance_sensitive: true`: perf budgets defined and met


### Implementation Blueprint
- Start with pseudocode showing approach
- Reference real files for patterns
- Include error handling strategy
- Progressive implementation phases with validation gates
- Rollback plan for each phase

### Progressive Implementation Strategy
```markdown
## Implementation Phases
### Phase 1: Basic Functionality (Core Requirements)
- Minimal viable implementation
- Core feature only
- Basic unit tests
- Validation: [specific commands]
- Rollback: [exact steps]

### Phase 2: Enhanced Features (Additional Capabilities)
- Error handling
- Edge cases
- Integration tests
- Validation: [specific commands]
- Rollback: [exact steps]

### Phase 3: Production Readiness
- Performance optimization
- Security hardening
- Full test coverage
- Validation: [specific commands]
- Rollback: [exact steps]
```

### Detailed Task Breakdown
```markdown
## Task Breakdown
### Task 1: [Specific Task Name]
- Description: [What to do in detail]
- Files to modify: [Exact paths]
- Dependencies: [What must be done first]
- Validation: [How to verify success]
- Time estimate: [Hours]
- Potential blockers: [Known issues]

### Task 2: [Next Task Name]
- ... (same structure)
```

### Anti-Patterns to Avoid (CRITICAL)
- Creating new patterns when existing ones work
- Skipping validation steps
- Hardcoding configurable values
- Ignoring failing tests
- Missing error handling
- Assuming specific environments without checking
- Creating files unnecessarily
- Over-engineering simple features
- Violating project conventions in CLAUDE.md

### Implementation Guardrails
- Start with minimal viable implementation
- Validate each component before proceeding
- Use existing patterns from: [list specific files]
- Test incrementally with: [specific commands]
- Check for regressions with: [specific commands]
- Security scan with: [specific commands]

### Expected Challenges and Mitigations
- Challenge: [Specific technical challenge]
  - Mitigation: [How to handle it]
  - Fallback: [Alternative approach]
- Challenge: [Another challenge]
  - Mitigation: [How to handle it]
  - Fallback: [Alternative approach]

### Risk Assessment (BMAD-inspired)
- **Technical Debt Impact**: [1-9] - How much debt does this add?
- **Integration Complexity**: [1-9] - How complex is integration?
- **Regression Potential**: [1-9] - Risk of breaking existing features
- **Performance Impact**: [1-9] - Potential performance degradation
- **Security Risk**: [1-9] - Security implications
- **Mitigation Strategies**: [List specific approaches for high-risk items]

## Project-Specific Gotchas
- [ ] Always include both `.up.sql` and `.down.sql` migration files
- [ ] Always include both `.up.sql` and `.down.sql` migration files
- [ ] Don’t hardcode configurable values (use env vars or config files)
- [ ] Always update documentation when adding new PRP phases
- [ ] PRPs must include Confidence Score + Readiness assessment
- [ ] When using Yjs, always specify awareness handling

### Validation Gates (Must be Executable)
```bash
# For TypeScript/JavaScript projects
# Syntax/Style
npm run lint
npm run type-check

# Unit Tests
npm run test

 
# E2E Tests
npm run test:e2e

# Performance Tests
npm run test:perf

# Security Scan
npm audit
```

### Context Artifacts to Generate
- Implementation checklist with specific file references
- Dependency graph showing what depends on this feature
- Integration points documentation
- Test coverage report
- Performance baseline metrics

### Agent Handoff Checklist
- [ ] All URLs and documentation links verified working
- [ ] Code examples tested in isolation
- [ ] Error scenarios documented with examples
- [ ] Next agent has all required context
- [ ] No ambiguous references or assumptions

*** CRITICAL AFTER YOU ARE DONE RESEARCHING AND EXPLORING THE CODEBASE BEFORE YOU START WRITING THE PRP ***

*** ULTRATHINK ABOUT THE PRP AND PLAN YOUR APPROACH THEN START WRITING THE PRP ***

## Output

1. First check if a PRP already exists for this feature:
   - If initial.md is passed, look for PRPs/*postgres*.md or PRPs/*persistence*.md
   - If a PRP exists with similar name, UPDATE that file instead of creating new
   - Show a message: "Updating existing PRP: {filename}"
   - Increment version number in the PRP

2. If no existing PRP found:
   - Save as: `PRPs/{feature-name}.md`
   - Use consistent naming from the feature file name
   - Follow snake_case naming convention

3. Version tracking:
   - Add a version number at the top of the PRP
   - Include timestamp of last update
   - Example: `version: 2 | last_updated: 2024-01-15`
   - Include brief changelog if updating

## Special Notes
- If validation fails, use error patterns in the PRP to fix and retry
- Mark items under ## Previously Missing (now converted to PRP) to track features that have been addressed in past PRPs
- Keep snake_case naming across all generated PRP files for uniformity
- Include rollback procedures for every major change
- Document any assumptions made during research

## Quality Checklist
- [ ] All necessary context included for one-pass implementation
- [ ] Validation gates are executable by AI without modification
- [ ] References existing patterns with specific file paths
- [ ] Clear implementation path with progressive phases
- [ ] Error handling documented for all components
- [ ] PRP tasks and scope match exactly with the source initial feature file
- [ ] Anti-patterns explicitly listed
- [ ] Success criteria are measurable and specific
- [ ] Environment requirements are complete
- [ ] Risk assessment completed
- [ ] Confidence Score included with readiness indicators
- [ ] Rollback procedures documented


### Context Rules for Parsing `initial*.md`
- Actionable: Only items listed under `## MISSING / TO IMPLEMENT`
- Non-actionable: Items under `## IMPLEMENTED` or `## Previously Missing (now converted to PRP)`
- Preserve history: Keep non-actionable sections intact for traceability
- If `## Previously Missing (now converted to PRP)` is found, link to the corresponding PRP file instead of regenerating
- Update `## Previously Missing` section when completing items

## Multi-Level Validation Strategy
1. **Pre-Implementation Validation**
   - [ ] Architecture compatibility verified
   - [ ] Dependencies available and compatible
   - [ ] No conflicts with existing features
   - [ ] Security implications reviewed

2. **During Implementation Validation**
   - [ ] Each task validated before moving to next
   - [ ] Continuous integration tests passing
   - [ ] No regression in existing features
   - [ ] Performance metrics within bounds

3. **Post-Implementation Validation**
   - [ ] All success criteria met
   - [ ] Documentation complete
   - [ ] Integration tests passing
   - [ ] User acceptance criteria verified

## Confidence Scoring and Readiness Assessment
At the end of every PRP generation, output:

### Confidence Score (1-10)
- Definition: LLM's confidence that the feature can be implemented successfully in a single pass
- Factors: Context completeness, clarity of requirements, complexity, dependencies

### Readiness Indicators
- **Green Light (8-10)**: Ready for implementation
- **Yellow Light (5-7)**: May need clarification on specific points
- **Red Light (1-4)**: Requires significant additional research or user input

### Missing Information
If confidence < 8, explicitly list:
- What information is missing
- Why it's important
- How to obtain it

Remember: The goal is one-pass implementation success through comprehensive context.