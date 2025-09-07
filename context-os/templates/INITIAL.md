# [Feature Title]

## Metadata
**Feature Slug**: [auto-generated-from-title]  
**Author**: [Your name]  
**Created Date**: YYYY-MM-DD  
**Status**: 📝 PLANNED  
**Priority**: [critical | high | medium | low]  
**Estimated Risk**: [high | medium | low]  
**Target Branch**: feat/[feature-slug]  
**Iteration Count**: 0  

---

## SUMMARY
[One paragraph executive summary. What is being built and why? Maximum 3-4 sentences.]

---

## MOTIVATION / WHY
[Explain the business or technical reasons for this feature]
- Problem statement
- Current limitations
- Expected benefits
- User impact

---

## SCOPE

### In Scope
- [Specific deliverable 1]
- [Specific deliverable 2]
- [Specific deliverable 3]

### Out of Scope
- [Explicitly excluded item 1]
- [Explicitly excluded item 2]
- [Future enhancement reserved for later]

---

## ACCEPTANCE CRITERIA
- [ ] [Specific, measurable, testable criterion 1]
- [ ] [Specific, measurable, testable criterion 2]
- [ ] [Performance requirement: e.g., response time < 200ms]
- [ ] [Scale requirement: e.g., handle 1000+ concurrent users]
- [ ] [Documentation requirement: e.g., API docs updated]
- [ ] [Test requirement: e.g., 80% code coverage]

---

## DOCUMENTATION & REFERENCES

### Authoritative Documents
[Documents that MUST be followed - mark with ⚠️]
- ⚠️ **Architecture Guide**: `docs/[architecture-doc].md` - All patterns must comply
- ⚠️ **Process Guide**: `docs/proposal/DOCUMENTATION_PROCESS_GUIDE.md` - v1.4.5 compliance required
- **Related Feature**: `docs/proposal/[related-feature]/` - Reference implementation

### External References
- [API Documentation](https://example.com/api-docs)
- [Library Documentation](https://library.com/docs)
- [Design Mockups](link-to-designs)

### Exceptions to Standards
- [Standard Rule]: [Exception reason and approach]

---

## TECHNICAL APPROACH

### Architecture Overview
[High-level architecture description]

### Implementation Strategy
1. **Phase 1**: [What gets built first]
2. **Phase 2**: [What gets built next]
3. **Phase 3**: [Final phase]

### Data Model
```yaml
# Example schema/structure
table_name:
  - id: uuid primary key
  - field1: type
  - field2: type
  - created_at: timestamp
  - updated_at: timestamp
```

### Key Technical Decisions
- **Technology Choice**: [Why this technology/library]
- **Pattern Choice**: [Why this design pattern]
- **Trade-offs**: [What we're optimizing for vs accepting]

---

## IMPLEMENTATION HINTS
[Technical guidance to prevent common mistakes]
- Use [specific function/method] for [task]
- Avoid [anti-pattern] because [reason]
- Handle [edge case] by [approach]
- Consider [performance optimization]
- Security: [specific security considerations]

---

## EXAMPLES & SAMPLE FLOWS

### Example 1: [Common Use Case]
```
User Action → System Response → Database Update → UI Feedback
```

### Example 2: [Edge Case Handling]
```
Error Condition → Fallback Logic → Recovery → User Notification
```

---

## VALIDATION GATES
[Exact commands that must pass before considering feature complete]

### Syntax & Type Checking
```bash
npm run lint
npm run type-check
```

### Unit Tests
```bash
npm run test
# or specific test file
npm test -- path/to/test.spec.ts
```

### Integration Tests
```bash
# Environment setup
docker compose up -d [services]

# Run integration tests
npm run test:integration
```

### E2E Tests
```bash
npm run test:e2e
```

### Performance Tests
```bash
# If applicable
npm run test:performance
```

### Manual Verification
```bash
# Specific curl commands or manual test steps
curl -X POST http://localhost:3000/api/[endpoint] \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
# Expected: HTTP 200 with {"success": true}
```

---

## ENVIRONMENT SETUP
[Steps to prepare development environment]

### Prerequisites
- Node.js version: [version]
- Database: [PostgreSQL/MongoDB/etc]
- Other services: [Redis/Elasticsearch/etc]

### Setup Commands
```bash
# Install dependencies
npm install

# Environment variables
cp .env.example .env.local
# Edit .env.local with required values:
# - DATABASE_URL=
# - API_KEY=

# Start services
docker compose up -d

# Run migrations
npm run db:migrate
```

### Configuration Notes
- [Important config setting 1]
- [Important config setting 2]

---

## RISKS & MITIGATIONS

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| [Risk 1] | High | Medium | [Mitigation approach] |
| [Risk 2] | Medium | Low | [Mitigation approach] |

---

## SUCCESS METRICS
- **Performance**: [Metric with target, e.g., p95 latency < 200ms]
- **Reliability**: [Metric with target, e.g., 99.9% uptime]
- **User Experience**: [Metric with target, e.g., task completion < 3 clicks]
- **Business**: [Metric with target, e.g., 20% increase in conversion]

---

## DEPENDENCIES
- **External Libraries**: 
  - [library@version] - [purpose]
  - [library@version] - [purpose]
- **Internal Systems**:
  - [System/Service] - [what we need from it]
- **Team Dependencies**:
  - [Team] - [what we need from them]

---

## IMPLEMENTATION TASKS
[Detailed task breakdown - can be imported to project management]

### Phase 1: Foundation
- [ ] Set up project structure per Process Guide
- [ ] Create database schema/migrations
- [ ] Implement core data models
- [ ] Add basic validation

### Phase 2: Core Features  
- [ ] Implement [feature 1]
- [ ] Implement [feature 2]
- [ ] Add error handling
- [ ] Create unit tests

### Phase 3: Integration
- [ ] Integrate with existing systems
- [ ] Add monitoring/logging
- [ ] Performance optimization
- [ ] Security hardening

### Phase 4: Polish
- [ ] Documentation
- [ ] E2E tests
- [ ] Performance tests
- [ ] Deployment configuration

---

## ERROR TRACKING
[Living log - append after each implementation attempt]

```yaml
# Example format (uncomment and fill when errors occur):
# - attempt: 1
#   date: YYYY-MM-DD HH:MM
#   error: "Brief error description"
#   cause: "Root cause"
#   fix: "How it was/will be fixed"
#   command: "Command that failed"
#   resolved: false
```

---

## ESCALATION POLICY
- If `iteration_count >= 5` and unresolved errors → Tag technical lead
- If security vulnerability found → STOP and escalate immediately
- If data loss risk identified → STOP and escalate immediately
- If breaking changes to existing features → Require approval

---

## NEXT STEPS / TODO
- [ ] Review with stakeholders
- [ ] Security review if handling sensitive data
- [ ] Performance baseline measurement
- [ ] Create implementation branch
- [ ] Set up CI/CD pipeline

---

## NOTES / COMMENTS
[Additional context, decisions, or clarifications]

---

## AGENT INSTRUCTIONS
**For Claude Code Agent Implementation:**

1. **MUST READ FIRST**: 
   - All documents marked with ⚠️ in Documentation section
   - This INITIAL.md completely before starting

2. **MUST VALIDATE**: 
   - All acceptance criteria are specific and testable
   - Validation gates have runnable commands
   - Environment setup is complete

3. **MUST FOLLOW**:
   - Process Guide v1.4.5 for documentation
   - Architecture patterns from authoritative docs
   - Scope boundaries (do not implement out-of-scope items)

4. **MUST TRACK**:
   - Update ERROR TRACKING section if failures occur
   - Increment iteration_count after each attempt
   - Document root causes and fixes

5. **MUST STOP IF**:
   - Security vulnerability detected
   - Data loss risk identified  
   - Iteration count exceeds threshold
   - Required information is missing

---

**Template Version**: 2.0.0  
**Based On**: Context-OS requirements + PostgreSQL persistence example  
**Last Updated**: 2025-09-06