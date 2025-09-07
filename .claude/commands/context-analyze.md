# /context-analyze

Analyze Context-OS features using Claude's intelligence for insights and recommendations.

## Usage
```
/context-analyze <feature-slug> [options]
/context-analyze --all
/context-analyze --health
/context-analyze --recommendations
```

## Arguments
- `feature-slug`: Feature to analyze in depth
- `--all`: Analyze all features
- `--health`: System health analysis
- `--recommendations`: Generate improvement recommendations
- `--metrics`: Include performance metrics

## Examples

### Deep feature analysis
```
/context-analyze dark_mode
```

Output:
```
🔍 Analyzing: dark_mode

## Overview
Feature implementing UI theme switching with persistent preferences.

## Complexity Analysis
- Code Complexity: MEDIUM
- Integration Points: 12
- Dependencies: 3 (theme-provider, storage-api, user-prefs)
- Test Coverage: 78%

## Risk Assessment
🟡 Medium Risk
- Performance impact on theme switch
- Browser compatibility for CSS variables
- Accessibility contrast requirements

## Quality Metrics
- Documentation: 95% complete
- Code Review: Pending (2 files)
- Technical Debt: Low
- Maintainability: B+

## Recommendations
1. Add transition animations for smoother switching
2. Implement system preference detection
3. Add high contrast mode option
4. Cache theme assets for offline use

## Next Steps
- Complete remaining 4 tasks
- Address 2 validation warnings
- Review performance on mobile devices
```

### System health analysis
```
/context-analyze --health
```

Output:
```
🏥 Context-OS Health Analysis

## Overall Health: 85% 🟢

### Positive Indicators
✅ 83% features active or complete
✅ All critical fixes resolved
✅ Documentation compliance 92%
✅ No security vulnerabilities

### Areas of Concern
⚠️  Technical debt accumulating in 3 features
⚠️  Test coverage below 80% in 2 modules
⚠️  4 features without recent updates (>30 days)

### Trend Analysis
📈 Velocity: 2.3 features/month (up 15%)
📉 Bug Rate: 0.8/feature (down 20%)
➡️  Fix Time: 3.2 days average (stable)

### Recommendations
1. Schedule technical debt sprint
2. Increase test coverage requirements
3. Review stalled features for blockers
4. Consider feature flag system
```

### Generate recommendations
```
/context-analyze --recommendations
```

Output:
```
💡 Context-OS Recommendations

## Immediate Actions (This Week)

1. **Fix Validation Errors**
   - 2 features failing validation
   - Run: /context-validate --all --strict
   - Estimated: 2 hours

2. **Close High-Priority Fixes**
   - 3 HIGH severity issues open >1 week
   - Focus: memory_leak_editor, api_timeout
   - Estimated: 1 day

## Short-term (This Month)

1. **Improve Test Coverage**
   - Current: 72% average
   - Target: 85% minimum
   - Focus on: auth module, data layer

2. **Documentation Updates**
   - 5 features missing architecture docs
   - Update implementation.md files
   - Add sequence diagrams

## Long-term (This Quarter)

1. **Performance Optimization**
   - Bundle size increased 23%
   - Implement code splitting
   - Add lazy loading

2. **Architecture Refactoring**
   - Extract shared components
   - Implement design system
   - Standardize error handling

3. **Developer Experience**
   - Add feature scaffolding CLI
   - Improve local dev setup
   - Create contributor guide

## Risk Mitigation

🔴 **Critical**: Security audit needed for auth features
🟠 **High**: Performance regression tests missing
🟡 **Medium**: Dependency updates pending (12)
```

## Implementation

The command uses Claude's intelligence to:
1. Analyze code complexity and patterns
2. Identify risks and technical debt
3. Generate actionable recommendations
4. Predict future issues
5. Suggest optimizations

## Integration

- Reads feature data from Context-OS
- Uses `/context-status` for metrics
- Calls `/context-validate` for compliance
- Analyzes `/context-fix` patterns

## Advanced Features

### Comparative Analysis
```
/context-analyze dark_mode --compare light_mode
```

### Dependency Analysis
```
/context-analyze --dependencies
```

### Performance Profiling
```
/context-analyze --performance --metrics
```

## JSON Mode

```bash
echo '{"feature": "dark_mode", "metrics": true}' | node context-os/cli/analyze-cli.js
```

Returns:
```json
{
  "ok": true,
  "feature": "dark_mode",
  "analysis": {
    "complexity": "MEDIUM",
    "risk": "MEDIUM",
    "health": 85,
    "coverage": 78,
    "recommendations": [
      "Add transition animations",
      "Implement system preference detection",
      "Add high contrast mode"
    ]
  },
  "metrics": {
    "loc": 1234,
    "dependencies": 3,
    "integrationPoints": 12
  }
}
```

## Notes

This command leverages Claude's analytical capabilities to provide insights beyond simple metrics. It understands code patterns, identifies anti-patterns, and suggests improvements based on best practices.