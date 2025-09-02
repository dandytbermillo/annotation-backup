# Artifacts Index for UUID Coercion Fix

**Fix Document**: [2025-09-02-uuid-coercion-fix.md](../2025-09-02-uuid-coercion-fix.md)  
**Date Collected**: 2025-09-02  
**Purpose**: Preserve text-based error reports and test outputs

## Important Note
User provided screenshots as [Image #1] in the original report, but these cannot be extracted from the conversation. Only text-based artifacts can be preserved.

## Actual Artifacts Preserved

| File | Description | Source |
|------|-------------|--------|
| 01-original-error-report.md | User's error report with terminal output text | User prompt (text only) |

## Artifacts Not Preserved (Technical Limitations)

| Type | Description | Reason |
|------|-------------|--------|
| Screenshots | User provided [Image #1] showing terminal errors | Images cannot be extracted from prompts |
| Binary files | Any uploaded files | No access to file attachments |

## Test Outputs Generated During Fix

These could be created but weren't saved as separate files:
- Curl tests with branches endpoint (both failing and successful)
- Curl tests with documents endpoint (both failing and successful)
- Batch operation tests

Note: Future fixes should save actual test outputs as separate .txt files when they are generated.

## How to Use These Artifacts

1. **Reproducing the Issue**: Use artifacts 01-03 to understand original problem
2. **Understanding the Fix**: Review artifacts 04-06 for investigation process
3. **Verifying the Solution**: Check artifacts 07-09 for proof of fix
4. **Running Tests**: Use artifacts 10-12 as test baselines

## Artifact Preservation Rules

1. **Original Errors**: Save exactly as provided by user (including typos)
2. **Terminal Output**: Include full stack traces and context
3. **Screenshots**: Save with descriptive names, reference in INDEX
4. **Test Results**: Include both successful and failed attempts
5. **Timestamps**: Preserve original timestamps when available

## Notes

- Original user message included [Image #1] which showed terminal errors
- Some artifacts may contain sensitive data - review before sharing
- Large log files may be truncated with clear indicators
- Binary files (images, etc.) should be < 1MB each for git efficiency