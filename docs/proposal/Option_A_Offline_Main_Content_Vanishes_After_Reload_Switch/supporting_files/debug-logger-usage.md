# Debug Logger Usage Guide

## Overview
The debug logging system tracks content flow through the application to identify persistence issues.

## Components

### Database Table
```sql
CREATE TABLE debug_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  component VARCHAR(100),
  action VARCHAR(100),
  note_id UUID,
  panel_id VARCHAR(255),
  content_preview TEXT,
  metadata JSONB,
  session_id VARCHAR(100)
);
```

### Client Logger
```typescript
import { debugLog } from '@/lib/debug-logger'

debugLog('TiptapEditorPlain', 'CONTENT_LOADED', {
  noteId: 'uuid-here',
  panelId: 'main',
  contentPreview: 'First 100 chars...',
  metadata: { any: 'additional', data: 'here' }
})
```

### Actions Tracked
- `START_LOAD` - Content loading initiated
- `CONTENT_LOADED` - Content retrieved from database
- `CONTENT_SET_IN_EDITOR` - Content applied to editor
- `EMPTY_CONTENT_SAVE` - Warning when saving empty content

## Viewing Logs

### Web Interface
Navigate to: http://localhost:3000/debug-logs.html

Features:
- Auto-refresh every 2 seconds
- Filter by note ID or panel ID
- Color-coded by action type
- Session tracking

### Database Query
```bash
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "SELECT * FROM debug_logs ORDER BY timestamp DESC LIMIT 20;"
```

### Clear Logs
```bash
docker exec annotation_postgres psql -U postgres -d annotation_dev \
  -c "DELETE FROM debug_logs;"
```

## Analyzing Issues

### Content Loss Pattern
Look for sequences where:
1. `CONTENT_LOADED` shows real content
2. `CONTENT_SET_IN_EDITOR` shows empty content
3. `EMPTY_CONTENT_SAVE` warnings appear

### Healthy Pattern
```
START_LOAD → CONTENT_LOADED (with content) → CONTENT_SET_IN_EDITOR (matching content)
```

### Problem Pattern
```
START_LOAD → CONTENT_LOADED (with content) → CONTENT_SET_IN_EDITOR (empty) → EMPTY_CONTENT_SAVE
```

## Performance Considerations
- Logging is asynchronous and non-blocking
- Content previews limited to 500 characters
- Old logs auto-cleaned after 7 days (if cleanup function enabled)
- Minimal overhead (~5ms per log)

## Production Usage
Consider:
1. Disable in production via environment variable
2. Add rate limiting for high-traffic scenarios
3. Implement log rotation
4. Use sampling for performance-critical paths