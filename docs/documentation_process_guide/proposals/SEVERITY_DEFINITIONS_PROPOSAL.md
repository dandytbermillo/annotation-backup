# Clear Severity Definitions Proposal

**Issue #3 from v1.4 Improvements Plan**  
**Date**: 2025-09-02  
**Status**: Ready for Implementation  
**Purpose**: Replace vague severity classifications with precise, measurable criteria

## Problem Statement

Current severity definitions in the Documentation Process Guide are too vague:
- "perf regression" - could mean 1% or 90%
- "memory leak" - no timeline or threshold
- No environment consideration (Dev vs Production)
- Inconsistent classification between team members

## Proposed Solution

### Severity Definitions with Objective Criteria

#### 🔴 Critical (Immediate Action Required)
**Definition**: Issues requiring immediate intervention to prevent severe business impact

**Criteria**:
- **Data**: Loss, corruption, or unauthorized access (any amount)
- **Security**: Any exploitable vulnerability, regardless of environment
- **Availability**: Complete feature/system failure in PRODUCTION
- **Compliance**: Violation of legal/regulatory requirements
- **Performance**: 
  - >50% degradation in p95 latency (1-hour window, PRODUCTION)
  - >50% increase in CPU/memory usage (sustained 1-hour, PRODUCTION)
  - Throughput reduced by >50% (PRODUCTION)

#### 🟠 High (Urgent - Within 24 Hours)
**Definition**: Significant issues affecting core functionality or many users

**Criteria**:
- **Memory**: 
  - Leaks causing >25% memory growth per 24 hours
  - Reproducible OOM within 48 hours
  - Memory usage preventing horizontal scaling
- **Functionality**: Core features broken (but workaround exists)
- **Performance**:
  - 25-50% degradation in p95 latency (PRODUCTION)
  - 25-50% increase in CPU/memory usage (PRODUCTION)
- **User Impact**: 
  - >10% of active users affected (measured per hour)
  - >10% of API requests failing (per hour)
  - >10% of sessions terminated unexpectedly

#### 🟡 Medium (Important - Within 1 Week)
**Definition**: Issues disrupting workflows but with acceptable alternatives

**Criteria**:
- **Performance**:
  - 10-25% degradation in p95 latency
  - 10-25% increase in resource usage
  - Batch job times increased by 10-25%
- **Functionality**: 
  - UX workflow disrupted (alternative paths exist)
  - Non-critical features broken
  - Compatibility issues with specific browsers/environments
- **User Impact**:
  - 1-10% of users affected
  - Increased support tickets but manageable

#### 🟢 Low (Nice to Fix - As Time Permits)
**Definition**: Minor issues with minimal user or system impact

**Criteria**:
- **Performance**: <10% degradation in any metric
- **Cosmetic**: Visual issues, typos, formatting problems
- **Code Quality**: Refactoring, tech debt, deprecated dependencies
- **Development**: Issues only affecting development environment (unless security)
- **Documentation**: Outdated comments, missing JSDoc

### Environment Multiplier

**Apply these adjustments based on where the issue occurs:**

| Environment | Adjustment | Example |
|-------------|------------|---------|
| **Production** | Use severity as-is | High stays High |
| **Staging** | Reduce by 1 level | Critical → High |
| **Development** | Reduce by 2 levels | Critical → Medium |
| **Local** | Reduce by 2 levels | Critical → Medium |

**EXCEPTION**: Security vulnerabilities are ALWAYS Critical regardless of environment

### Measurement Windows

**Standard measurement periods for consistency:**
- **Performance metrics**: 1-hour p95 (unless specified)
- **Memory growth**: 24-hour period
- **User impact**: Per-hour for urgent, per-day for trends
- **Availability**: 5-minute intervals for uptime

### Classification Examples

| Issue | Environment | Metrics | Base Severity | Final Severity |
|-------|-------------|---------|---------------|-----------------|
| 147% CPU spike | Dev | >50% CPU | Critical | **Medium** (dev -2) |
| API latency +35% | Prod | p95 +35% | High | **High** |
| Memory leak | Prod | +30%/24h | High | **High** |
| 12% users get errors | Prod | 12% sessions | High | **High** |
| Missing button label | Prod | Cosmetic | Low | **Low** |
| SQL injection found | Dev | Security | Critical | **Critical** (exception) |
| Feature broken | Staging | Core feature | Critical | **High** (staging -1) |
| Slow test suite | CI | +40% time | High | **Medium** (dev -2) |

## Implementation Guide

### Step 1: Update Documentation Process Guide

Add to ACTIVE RULES section:
```markdown
5) Severity Classification
- Use objective criteria with measurable thresholds
- Apply environment multiplier (Production/Staging/Dev)
- Security issues always Critical
- Document specific metrics in fix reports
```

### Step 2: Update Report Templates

Add Severity Checklist to bug fix template:
```markdown
## Severity Classification
- [ ] Performance impact measured: _____% (metric: _____, window: _____)
- [ ] Environment identified: [Production | Staging | Development]
- [ ] Environment multiplier applied: [Yes | No | N/A-Security]
- [ ] User impact quantified: _____% over _____ period
- [ ] Security implications reviewed: [Yes - Critical | No]

**Final Severity**: [Critical | High | Medium | Low]
**Justification**: [1-2 sentences with specific metrics]
```

### Step 3: Create Quick Reference Card

```markdown
## Severity Quick Reference

🔴 **Critical**: Data loss | Security | Prod down | >50% perf hit
🟠 **High**: Memory leak >25%/day | 25-50% perf | >10% users
🟡 **Medium**: 10-25% perf | UX disrupted | Non-critical broken
🟢 **Low**: <10% perf | Cosmetic | Code quality

**Remember**: Dev issues -2 levels (except security)
```

### Step 4: Update Post-Implementation Fixes README.md Template

Create/update `post-implementation-fixes/README.md` with severity-based organization:
```markdown
# Post-Implementation Fixes Index

**Feature**: [Feature Name]
**Last Updated**: YYYY-MM-DD
**Total Fixes**: X
**Severity Breakdown**: 🔴 Critical: 0 | 🟠 High: 1 | 🟡 Medium: 2 | 🟢 Low: 1

## 🔴 Critical Issues (Immediate Action Required)
*Definition: Data loss, security, prod down, >50% perf degradation*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| *No critical issues* | | | | | |

## 🟠 High Priority (Within 24 Hours)
*Definition: Memory leak >25%/day, 25-50% perf, >10% users affected*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| 2025-09-02 | Memory leak in HMR | Dev | 30%/24h growth | ✅ Fixed | [Details](./high/2025-09-02-memory-leak.md) |

## 🟡 Medium Priority (Within 1 Week)
*Definition: 10-25% perf degradation, UX disrupted, non-critical broken*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| 2025-09-03 | Slow batch save | Prod | 15% p95 latency | 🚧 In Progress | [Details](./medium/2025-09-03-batch-save.md) |
| 2025-09-03 | UI freezes | Staging | 12% users affected | ⚠️ Blocked | [Details](./medium/2025-09-03-ui-freeze.md) |

## 🟢 Low Priority (As Time Permits)
*Definition: <10% perf impact, cosmetic, code quality*

| Date | Issue | Environment | Metrics | Status | Link |
|------|-------|-------------|---------|--------|------|
| 2025-09-04 | Typo in error msg | Prod | Cosmetic | ✅ Fixed | [Details](./low/2025-09-04-typo.md) |

## Fix Patterns & Lessons Learned
- **Memory Leaks**: Most common in development with HMR (3 instances)
- **Performance**: Environment-specific issues need multiplier consideration
- **Security**: Always Critical regardless of environment (1 instance)

## Statistics
- **Average Time to Fix**: Critical: <2h | High: <24h | Medium: 3 days | Low: 1 week
- **Most Affected Environment**: Development (60%), Production (30%), Staging (10%)
- **Root Cause Distribution**: Code bugs (50%), Config (30%), Dependencies (20%)
```

## Migration Path

### For Existing Documentation
1. Review all issues in `post-implementation-fixes/`
2. Reclassify each fix using new objective criteria:
   - Measure actual performance impact percentages
   - Identify environment where issue occurred
   - Apply environment multiplier
3. Move files to correct severity subdirectories if changed:
   - `mv post-implementation-fixes/high/issue.md post-implementation-fixes/medium/issue.md`
4. Update or create `post-implementation-fixes/README.md`:
   - Use the template from Step 4 above
   - Include severity definitions at section headers
   - Add Environment and Metrics columns to tables
   - Calculate and display severity breakdown counts

### For New Issues
1. Measure impact with specific metrics (use monitoring tools)
2. Identify environment (Production/Staging/Development)
3. Apply environment multiplier (except for security)
4. Use classification examples table as reference
5. Document in fix report:
   - Exact metrics measured
   - Environment where discovered
   - Final severity with justification
6. Update `post-implementation-fixes/README.md` immediately:
   - Add row to appropriate severity section
   - Update severity breakdown counts
   - Update last updated date

## Success Criteria

- [ ] Zero subjective severity classifications
- [ ] 100% of fix reports include metrics
- [ ] Consistent classification across team members
- [ ] Reduced debate about severity levels
- [ ] Clear audit trail for severity decisions

## Benefits

1. **Consistency**: Everyone uses same thresholds
2. **Objectivity**: Based on measurements, not opinions
3. **Speed**: Quick classification using checklist
4. **Accuracy**: Environment context prevents over-reaction
5. **Learning**: Examples guide future decisions

## FAQ

**Q: What if we can't measure the exact percentage?**  
A: Use best estimate and document uncertainty. Example: "Approximately 20-30% degradation based on user reports"

**Q: How do we handle intermittent issues?**  
A: Use worst-case measurement during incident. If it happens 50% of the time with 40% degradation, document as "40% degradation when occurring (50% of requests)"

**Q: What about issues affecting specific customers?**  
A: Consider business impact. One customer = Low, unless it's enterprise/critical customer, then treat as percentage of revenue affected

**Q: Can we override the environment multiplier?**  
A: Yes, with justification. Example: "Dev issue but blocking all development work = High"

## Appendix: Detailed Metric Definitions

### Performance Metrics
- **p95 latency**: 95th percentile response time
- **Throughput**: Requests/transactions per second
- **CPU usage**: Average across all cores
- **Memory usage**: RSS (Resident Set Size) or heap usage

### User Impact Metrics
- **Active users**: Unique users in time window
- **Sessions**: Individual user sessions
- **API requests**: Total API calls
- **Error rate**: Failed requests / total requests

### Time Windows
- **Immediate**: Within 5 minutes
- **Urgent**: Within 1 hour
- **Daily**: 24-hour rolling window
- **Sustained**: Continuous for specified period

---

**Next Steps**:
1. Review and approve this proposal
2. Update DOCUMENTATION_PROCESS_GUIDE.md with new definitions
3. Create quick reference cards for teams
4. Train team on new classification system
5. Monitor and refine based on usage