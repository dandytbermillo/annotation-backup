| Risk | Impact | Mitigation |
|---|---:|---|
| Concurrent writes | High | Lock file + atomic writes + retry |
| Journal growth | Med | Rotate >5MB or >10k lines; budgets |
| Vague events | Med | Required keys + ≤2KB per line |
| Secret leakage | High | Redaction + limit summary detail |
| CI writes to live store | Low | CI policy: read-only; fail step if detected |
| Schema drift | Med | Human review; version via env if needed |

