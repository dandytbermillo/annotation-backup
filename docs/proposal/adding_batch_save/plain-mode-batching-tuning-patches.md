# Plain-Mode Batching Tuning Patches  

Purpose: Reduce excessive rows in `document_saves` when making small edits by:
- Server-side coalescing and versioning per (noteId, panelId) per batch.
- Skipping no-op writes via content comparison.
- Debouncing editor saves and tuning batch flush timings.
- Optional retry-on-conflict for concurrent batches.

No changes are applied by this document. Review and approve before implementation.

## 1) Documents Batch API — Server-Side Versioning + Coalescing

File: `app/api/postgres-offline/documents/batch/route.ts`

- Compute the next version on the server.
- Coalesce to one row per `(noteId, panelId)` per batch.
- Skip insert if content unchanged vs latest.
- Add retry-on-conflict for concurrent writers.
- Apply to BOTH POST (create) and PUT (update) handlers.

*** Begin Patch
*** Update File: app/api/postgres-offline/documents/batch/route.ts
@@
 export async function POST(request: NextRequest) {
   const client = await pool.connect()
   
   try {
     const { operations } = await request.json()
@@
-    console.log(`[Batch API - Documents] Processing ${operations.length} create operations`)
-
-    const results = []
-
-    await client.query('BEGIN')
-
-    for (const op of operations) {
\+    console.log(`[Batch API - Documents] Processing ${operations.length} create operations`)
\+
\+    const results: any[] = []
\+
\+    await client.query('BEGIN')
\+
\+    // Coalesce by (noteId, panelId) — keep the LAST content in this batch
\+    const byPanel = new Map<string, { noteId: string; panelId: string; contentJson: any; idempotencyKey?: string }>()
\+
\+    for (const op of operations) {
       // Check idempotency
       if (op.idempotencyKey && processedKeys.has(op.idempotencyKey)) {
         const cached = processedKeys.get(op.idempotencyKey)
         results.push({ ...cached?.result, cached: true })
         continue
       }
       
       try {
-        // Validate required fields
-        const { noteId, panelId, content, version } = op
-        
-        if (!noteId || !panelId || !content || version === undefined) {
\+        // Validate required fields (server will compute version)
\+        const { noteId, panelId, content } = op
\+        
\+        if (!noteId || !panelId || !content) {
           results.push({ 
             error: 'Missing required fields', 
             operation: op 
           })
           continue
         }
         
         const normalizedPanelId = normalizePanelId(noteId, panelId)
         
-        // Store content as JSONB
-        const contentJson = typeof content === 'string' 
-          ? { html: content } 
-          : content
-        
-        const result = await client.query(
-          `INSERT INTO document_saves 
-           (note_id, panel_id, content, version, created_at)
-           VALUES ($1, $2, $3::jsonb, $4, NOW())
-           ON CONFLICT (note_id, panel_id, version)
-           DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
-           RETURNING id`,
-          [noteId, normalizedPanelId, JSON.stringify(contentJson), version]
-        )
-        
-        const operationResult = { 
-          success: true, 
-          id: result.rows[0]?.id,
-          noteId,
-          panelId: normalizedPanelId,
-          version
-        }
-        
-        results.push(operationResult)
-        
-        // Store for idempotency
-        if (op.idempotencyKey) {
-          processedKeys.set(op.idempotencyKey, {
-            timestamp: Date.now(),
-            result: operationResult
-          })
-        }
\+        const contentJson = typeof content === 'string' ? { html: content } : content
\+        byPanel.set(`${noteId}:${normalizedPanelId}`, { noteId, panelId: normalizedPanelId, contentJson, idempotencyKey: op.idempotencyKey })
       } catch (error) {
         console.error('[Batch API - Documents] Operation failed:', error)
         results.push({ 
           error: 'Operation failed', 
           message: error instanceof Error ? error.message : 'Unknown error',
           operation: op 
         })
       }
     }
-    
-    await client.query('COMMIT')
-    
-    console.log(`[Batch API - Documents] Successfully processed batch`)
-    
-    return NextResponse.json({ 
-      success: true, 
-      results,
-      processed: results.filter(r => r.success).length,
-      failed: results.filter(r => r.error).length
-    })
\+
\+    // Persist one row per (noteId, panelId) with server-computed version
\+    for (const { noteId, panelId, contentJson, idempotencyKey } of byPanel.values()) {
\+      // Skip if content equals latest (content-based coalescing)
\+      const latest = await client.query(
\+        `SELECT content, version FROM document_saves
\+         WHERE note_id = $1 AND panel_id = $2
\+         ORDER BY version DESC LIMIT 1`,
\+        [noteId, panelId]
\+      )
\+      if (latest.rows[0] && JSON.stringify(latest.rows[0].content) === JSON.stringify(contentJson)) {
\+        results.push({ success: true, skipped: true, noteId, panelId, reason: 'no-change' })
\+        continue
\+      }
\+
\+      // Compute next version and insert with retry-on-conflict (concurrent batches)
\+      let inserted = false
\+      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
\+        const nextVersionRow = await client.query(
\+          `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
\+           FROM document_saves
\+           WHERE note_id = $1 AND panel_id = $2`,
\+          [noteId, panelId]
\+        )
\+        const nextVersion = nextVersionRow.rows[0].next_version
\+        try {
\+          const ins = await client.query(
\+            `INSERT INTO document_saves 
\+             (note_id, panel_id, content, version, created_at)
\+             VALUES ($1, $2, $3::jsonb, $4, NOW())
\+             RETURNING id`,
\+            [noteId, panelId, JSON.stringify(contentJson), nextVersion]
\+          )
\+          const operationResult = { success: true, id: ins.rows[0]?.id, noteId, panelId, version: nextVersion }
\+          results.push(operationResult)
\+          if (idempotencyKey) {
\+            processedKeys.set(idempotencyKey, { timestamp: Date.now(), result: operationResult })
\+          }
\+          inserted = true
\+        } catch (e: any) {
\+          // Unique violation — concurrent insert used same version; retry
\+          if (e && e.code === '23505') continue
\+          throw e
\+        }
\+      }
\+      if (!inserted) {
\+        results.push({ success: false, error: 'version_conflict', noteId, panelId })
\+      }
\+    }
\+
\+    await client.query('COMMIT')
\+    console.log(`[Batch API - Documents] Successfully processed ${byPanel.size} grouped operations`)
\+    return NextResponse.json({
\+      success: true,
\+      results,
\+      processed: results.filter(r => r.success && !r.skipped).length,
\+      skipped: results.filter(r => r.skipped).length,
\+      failed: results.filter(r => r.error).length
\+    })
   } catch (error) {
*** End Patch

Repeat the same logic for the PUT handler:

*** Begin Patch
*** Update File: app/api/postgres-offline/documents/batch/route.ts
@@
 export async function PUT(request: NextRequest) {
   const client = await pool.connect()
   
   try {
     const { operations } = await request.json()
@@
-    console.log(`[Batch API - Documents] Processing ${operations.length} update operations`)
-
-    const results = []
-
-    await client.query('BEGIN')
-
-    for (const op of operations) {
\+    console.log(`[Batch API - Documents] Processing ${operations.length} update operations`)
\+
\+    const results: any[] = []
\+
\+    await client.query('BEGIN')
\+
\+    // Coalesce by (noteId, panelId) — keep the LAST content in this batch
\+    const byPanel = new Map<string, { noteId: string; panelId: string; contentJson: any; idempotencyKey?: string }>()
\+
\+    for (const op of operations) {
       // Check idempotency
       if (op.idempotencyKey && processedKeys.has(op.idempotencyKey)) {
         const cached = processedKeys.get(op.idempotencyKey)
         results.push({ ...cached?.result, cached: true })
         continue
       }
       
       try {
-        // Extract data from operation
-        const data = op.data || op
-        const { noteId, panelId, content, version } = data
-        
-        if (!noteId || !panelId || !content || version === undefined) {
\+        // Extract data; server computes version
\+        const data = op.data || op
\+        const { noteId, panelId, content } = data
\+        
\+        if (!noteId || !panelId || !content) {
           results.push({ 
             error: 'Missing required fields', 
             operation: op 
           })
           continue
         }
         
         const normalizedPanelId = normalizePanelId(noteId, panelId)
         
-        // Store content as JSONB
-        const contentJson = typeof content === 'string' 
-          ? { html: content } 
-          : content
-        
-        const result = await client.query(
-          `INSERT INTO document_saves 
-           (note_id, panel_id, content, version, created_at)
-           VALUES ($1, $2, $3::jsonb, $4, NOW())
-           ON CONFLICT (note_id, panel_id, version)
-           DO UPDATE SET content = EXCLUDED.content, created_at = NOW()
-           RETURNING id`,
-          [noteId, normalizedPanelId, JSON.stringify(contentJson), version]
-        )
-        
-        const operationResult = { 
-          success: true, 
-          id: result.rows[0]?.id,
-          noteId,
-          panelId: normalizedPanelId,
-          version
-        }
-        
-        results.push(operationResult)
-        
-        // Store for idempotency
-        if (op.idempotencyKey) {
-          processedKeys.set(op.idempotencyKey, {
-            timestamp: Date.now(),
-            result: operationResult
-          })
-        }
\+        const contentJson = typeof content === 'string' ? { html: content } : content
\+        byPanel.set(`${noteId}:${normalizedPanelId}`, { noteId, panelId: normalizedPanelId, contentJson, idempotencyKey: op.idempotencyKey })
       } catch (error) {
         console.error('[Batch API - Documents] Operation failed:', error)
         results.push({ 
           error: 'Operation failed', 
           message: error instanceof Error ? error.message : 'Unknown error',
           operation: op 
         })
       }
     }
-    
-    await client.query('COMMIT')
-    
-    console.log(`[Batch API - Documents] Successfully processed batch`)
-    
-    return NextResponse.json({ 
-      success: true, 
-      results,
-      processed: results.filter(r => r.success).length,
-      failed: results.filter(r => r.error).length
-    })
\+
\+    // Persist one row per (noteId, panelId) with server-computed version
\+    for (const { noteId, panelId, contentJson, idempotencyKey } of byPanel.values()) {
\+      const latest = await client.query(
\+        `SELECT content, version FROM document_saves
\+         WHERE note_id = $1 AND panel_id = $2
\+         ORDER BY version DESC LIMIT 1`,
\+        [noteId, panelId]
\+      )
\+      if (latest.rows[0] && JSON.stringify(latest.rows[0].content) === JSON.stringify(contentJson)) {
\+        results.push({ success: true, skipped: true, noteId, panelId, reason: 'no-change' })
\+        continue
\+      }
\+
\+      let inserted = false
\+      for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
\+        const nextVersionRow = await client.query(
\+          `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
\+           FROM document_saves WHERE note_id = $1 AND panel_id = $2`,
\+          [noteId, panelId]
\+        )
\+        const nextVersion = nextVersionRow.rows[0].next_version
\+        try {
\+          const ins = await client.query(
\+            `INSERT INTO document_saves 
\+             (note_id, panel_id, content, version, created_at)
\+             VALUES ($1, $2, $3::jsonb, $4, NOW())
\+             RETURNING id`,
\+            [noteId, panelId, JSON.stringify(contentJson), nextVersion]
\+          )
\+          const operationResult = { success: true, id: ins.rows[0]?.id, noteId, panelId, version: nextVersion }
\+          results.push(operationResult)
\+          if (idempotencyKey) {
\+            processedKeys.set(idempotencyKey, { timestamp: Date.now(), result: operationResult })
\+          }
\+          inserted = true
\+        } catch (e: any) {
\+          if (e && e.code === '23505') continue
\+          throw e
\+        }
\+      }
\+      if (!inserted) {
\+        results.push({ success: false, error: 'version_conflict', noteId, panelId })
\+      }
\+    }
\+
\+    await client.query('COMMIT')
\+    console.log(`[Batch API - Documents] Successfully processed ${byPanel.size} grouped operations`)
\+    return NextResponse.json({
\+      success: true,
\+      results,
\+      processed: results.filter(r => r.success && !r.skipped).length,
\+      skipped: results.filter(r => r.skipped).length,
\+      failed: results.filter(r => r.error).length
\+    })
   } catch (error) {
*** End Patch

Note: DELETE handler can remain as-is; it already processes IDs in bulk.

## 2) Editor — Debounce Saves + Skip No-op Content

File: `components/canvas/tiptap-editor-plain.tsx`

- Debounce saves by ~800ms idle.
- Skip save if content hash unchanged since last queued save.

*** Begin Patch
*** Update File: components/canvas/tiptap-editor-plain.tsx
@@
-      onUpdate: ({ editor }) => {
-        // Get content as JSON for plain mode
-        const json = editor.getJSON()
-        console.log(`[TiptapEditorPlain] onUpdate fired for noteId: ${noteId}, panelId: ${panelId}`)
-        
-        // Save to provider if available
-        if (provider && noteId) {
-          provider.saveDocument(noteId, panelId, json).catch error => {
-            console.error('[TiptapEditorPlain] Failed to save content:', error)
-          })
-        }
-        
-        // Notify parent component
-        onUpdate?.(json)
-      },
\+      onUpdate: ({ editor }) => {
\+        const json = editor.getJSON()
\+        // Hash current content to detect real changes
\+        const contentStr = JSON.stringify(json)
\+        ;(window as any).__lastContentHash = (window as any).__lastContentHash || new Map()
\+        const key = `${noteId}:${panelId}`
\+        const prev = (window as any).__lastContentHash.get(key)
\+        if (prev === contentStr) return
\+        (window as any).__lastContentHash.set(key, contentStr)
\+
\+        // Debounce saves to reduce version churn
\+        ;(window as any).__debouncedSave = (window as any).__debouncedSave || new Map()
\+        const existing = (window as any).__debouncedSave.get(key)
\+        if (existing) clearTimeout(existing)
\+        const timer = setTimeout(() => {
\+          if (provider && noteId) {
\+            provider.saveDocument(noteId, panelId, json).catch(err => {
\+              console.error('[TiptapEditorPlain] Failed to save content:', err)
\+            })
\+          }
\+          onUpdate?.(json)
\+        }, 800) // 800ms idle before saving
\+        ;(window as any).__debouncedSave.set(key, timer)
\+      },
*** End Patch

## 3) Batch Config — Tame Flush Frequency

File: `lib/batching/plain-batch-config.ts`

- Increase `debounceMs` and `batchTimeout` in development/production profiles to reduce flush count for small edits.

*** Begin Patch
*** Update File: lib/batching/plain-batch-config.ts
@@
   development: {
-    maxBatchSize: 10,
-    maxBatchSizeBytes: 102400, // 100KB
-    batchTimeout: 500,
-    debounceMs: 100,
\+    maxBatchSize: 10,
\+    maxBatchSizeBytes: 102400, // 100KB
\+    batchTimeout: 3000,  // wait up to 3s before forced flush
\+    debounceMs: 800,     // require 800ms idle before flush
@@
   production_web: {
-    maxBatchSize: 50,
-    maxBatchSizeBytes: 512000, // 500KB
-    batchTimeout: 1000,
-    debounceMs: 200,
\+    maxBatchSize: 50,
\+    maxBatchSizeBytes: 512000, // 500KB
\+    batchTimeout: 5000,  // 5s forced flush
\+    debounceMs: 1000,    // 1s idle window
*** End Patch

## 4) Provider — Only Bump Version When Content Changes

File: `lib/providers/plain-offline-provider.ts`

- Avoid incrementing version when content hasn’t changed.
- Note: Server now ignores client-sent version; this is an additional guard to limit local version churn.

*** Begin Patch
*** Update File: lib/providers/plain-offline-provider.ts
@@
   async saveDocument(
     noteId: string, 
     panelId: string, 
     content: ProseMirrorJSON | HtmlString, 
     skipPersist = false,
     options?: { skipBatching?: boolean }
   ): Promise<void> {
     const cacheKey = this.getCacheKey(noteId, panelId)
@@
-    // Update local cache
-    this.documents.set(cacheKey, content)
-    const currentVersion = (this.documentVersions.get(cacheKey) || 0) + 1
-    this.documentVersions.set(cacheKey, currentVersion)
\+    // Update local cache; bump version only if content changed
\+    const prev = this.documents.get(cacheKey)
\+    const changed = JSON.stringify(prev) !== JSON.stringify(content)
\+    this.documents.set(cacheKey, content)
\+    const currentVersion = (this.documentVersions.get(cacheKey) || 0) + (changed ? 1 : 0)
\+    this.documentVersions.set(cacheKey, currentVersion)
*** End Patch

## Notes and Next Steps

- These patches preserve Option A guardrails: no Yjs in the plain path; single-transaction persistence per batch; idempotency retained.
- PUT and POST now produce at most one `document_saves` row per `(noteId, panelId)` per batch and skip identical content.
- To productionize idempotency across instances, back the idempotency map with Redis or a DB table.
 