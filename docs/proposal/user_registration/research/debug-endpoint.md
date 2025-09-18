# Temporary Debug Endpoint for Document History

We added an internal endpoint at `/api/postgres-offline/debug/documents` to inspect recent document writes and related offline queue entries.

## Usage
```
GET /api/postgres-offline/debug/documents?noteId=<UUID>&panelId=<UUID>&limit=20
```
- `noteId` and `panelId` are required UUIDs.
- `limit` is optional (default/max 20).

The endpoint returns:
- `history`: recent rows from `document_saves` (ID, workspace, version, content hash, created_at).
- `queue`: matching entries in `offline_queue` (operation type, status, retry count, payload version, content hash).

Use this during testing to confirm whether stale queue payloads are replaying after newer versions.

## Removal
This endpoint is instrumentation only; remove it once the investigation concludes to avoid exposing internal data.
