import { NextRequest, NextResponse } from 'next/server'
import { serverPool } from '@/lib/db/pool'
import { withWorkspaceClient } from '@/lib/workspace/workspace-store'
import { indexItem } from '@/lib/docs/items-indexing'

// GET /api/items - Get tree or search items
export async function GET(request: NextRequest) {
  try {
    return await withWorkspaceClient(serverPool, async (client, workspaceId) => {
      const searchParams = request.nextUrl.searchParams
      const search = searchParams.get('search')
      const type = searchParams.get('type')
      const parentId = searchParams.get('parentId')
      const limit = parseInt(searchParams.get('limit') || '100')
      const requestedWorkspaceId =
        searchParams.get('workspaceId') ?? request.headers.get('x-overlay-workspace-id') ?? undefined

      let activeWorkspaceId = workspaceId
      if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
        const exists = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [requestedWorkspaceId])
        if (exists.rowCount === 0) {
          return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }
        await client.query('SELECT set_config($1, $2, false)', [
          'app.current_workspace_id',
          requestedWorkspaceId,
        ])
        activeWorkspaceId = requestedWorkspaceId
      }

      let query = ''
      let values: any[] = []

      if (search) {
        query = `
          SELECT 
            id, type, parent_id, path, name, slug, position,
            metadata, icon, color, last_accessed_at,
            created_at, updated_at
          FROM items 
          WHERE workspace_id = $1
            AND deleted_at IS NULL
            AND (name ILIKE $2 OR path ILIKE $2)
            ${type ? 'AND type = $3' : ''}
          ORDER BY 
            CASE WHEN name ILIKE $2 THEN 0 ELSE 1 END,
            length(path)
          LIMIT $${type ? 4 : 3}
        `
        values = [activeWorkspaceId, `%${search}%`]
        if (type) values.push(type)
        values.push(limit)
      } else if (type && !parentId) {
        query = `
          SELECT 
            id, type, parent_id, path, name, slug, position,
            metadata, icon, color, last_accessed_at,
            created_at, updated_at
          FROM items 
          WHERE workspace_id = $1
            AND deleted_at IS NULL
            AND type = $2
          ORDER BY path
          LIMIT $3
        `
        values = [activeWorkspaceId, type, limit]
      } else if (parentId !== undefined) {
        query = `
          SELECT 
            id, type, parent_id, path, name, slug, position,
            metadata, icon, color, last_accessed_at,
            created_at, updated_at
          FROM items 
          WHERE workspace_id = $1
            AND ${parentId === 'null' ? 'parent_id IS NULL' : 'parent_id = $2'} 
            AND deleted_at IS NULL
          ORDER BY type DESC, position, name
        `
        values = parentId === 'null' ? [activeWorkspaceId] : [activeWorkspaceId, parentId]
      } else {
        query = `
          WITH RECURSIVE tree AS (
            SELECT 
              id, type, parent_id, path, name, slug, position,
              metadata, icon, color, last_accessed_at,
              created_at, updated_at,
              0 as depth
            FROM items 
            WHERE workspace_id = $1
              AND parent_id IS NULL AND deleted_at IS NULL
            
            UNION ALL
            
            SELECT 
              i.id, i.type, i.parent_id, i.path, i.name, i.slug, i.position,
              i.metadata, i.icon, i.color, i.last_accessed_at,
              i.created_at, i.updated_at,
              t.depth + 1
            FROM items i
            JOIN tree t ON i.parent_id = t.id
            WHERE i.workspace_id = $1 AND i.deleted_at IS NULL AND t.depth < 3
          )
          SELECT * FROM tree ORDER BY path
        `
        values = [activeWorkspaceId]
      }

      const result = await client.query(query, values)

      const items = result.rows.map(row => ({
        id: row.id,
        type: row.type,
        parentId: row.parent_id,
        path: row.path,
        name: row.name,
        slug: row.slug,
        position: row.position,
        metadata: row.metadata,
        icon: row.icon,
        color: row.color,
        lastAccessedAt: row.last_accessed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        depth: row.depth
      }))

      return NextResponse.json({ items, workspaceId: activeWorkspaceId })
    })
  } catch (error) {
    console.error('Error fetching items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch items' },
      { status: 500 }
    )
  }
}

// POST /api/items - Create new item (folder or note)
export async function POST(request: NextRequest) {
  try {
    return await withWorkspaceClient(serverPool, async (client, workspaceId) => {
      const isOverlayRequest = request.headers.has('x-overlay-workspace-id')
      let body: any
      try {
        body = await request.json()
      } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
      const {
        type,
        parentId,
        name,
        content,
        metadata = {},
        icon,
        color,
        position = 0,
      } = body
      const rawBodyWorkspaceId = typeof body?.workspaceId === 'string' && body.workspaceId.length > 0
        ? body.workspaceId
        : undefined
      const headerWorkspaceId = request.headers.get('x-overlay-workspace-id') ?? undefined
      const requestedWorkspaceId =
        rawBodyWorkspaceId ?? headerWorkspaceId ?? undefined

      if (isOverlayRequest && !requestedWorkspaceId) {
        return NextResponse.json(
          { error: 'workspaceId is required for overlay operations' },
          { status: 400 },
        )
      }

      let activeWorkspaceId = workspaceId
      if (requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
        const exists = await client.query('SELECT 1 FROM workspaces WHERE id = $1', [
          requestedWorkspaceId,
        ])
        if (exists.rowCount === 0) {
          return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
        }

        await client.query('SELECT set_config($1, $2, false)', [
          'app.current_workspace_id',
          requestedWorkspaceId,
        ])
        activeWorkspaceId = requestedWorkspaceId
      }

      if (!type || !name) {
        return NextResponse.json(
          { error: 'Type and name are required' },
          { status: 400 },
        )
      }

      let parentPath = ''
      if (parentId) {
        const parentResult = await client.query(
          'SELECT path FROM items WHERE id = $1 AND deleted_at IS NULL',
          [parentId],
        )
        if (parentResult.rows.length === 0) {
          return NextResponse.json({ error: 'Parent not found' }, { status: 404 })
        }
        parentPath = parentResult.rows[0].path
      }

      let finalName = name
      const duplicateCheck = await client.query(
        `SELECT id, name FROM items
         WHERE workspace_id = $1
           AND ${parentId ? 'parent_id = $2' : 'parent_id IS NULL'}
           AND LOWER(name) = LOWER($${parentId ? '3' : '2'})
           AND deleted_at IS NULL`,
        parentId ? [activeWorkspaceId, parentId, name] : [activeWorkspaceId, name],
      )

      if (duplicateCheck.rows.length > 0) {
        const baseName = name.replace(/ - \d{1,2}:\d{2} (AM|PM)$/, '')
        const timeMatch = name.match(/ - (\w+ \d+, \d{1,2}:\d{2} (AM|PM))$/)
        const timeSuffix = timeMatch ? ` - ${timeMatch[1]}` : ''

        let counter = 1
        let foundUnique = false

        while (!foundUnique && counter < 1000) {
          const candidateName = `${baseName} ${counter}${timeSuffix}`
          const existingCheck = await client.query(
            `SELECT id FROM items
             WHERE workspace_id = $1
               AND ${parentId ? 'parent_id = $2' : 'parent_id IS NULL'}
               AND LOWER(name) = LOWER($${parentId ? '3' : '2'})`,
            parentId ? [activeWorkspaceId, parentId, candidateName] : [activeWorkspaceId, candidateName],
          )

          if (existingCheck.rows.length === 0) {
            finalName = candidateName
            foundUnique = true
          } else {
            counter++
          }
        }

        if (!foundUnique) {
          finalName = `${baseName} ${Date.now()}${timeSuffix}`
        }
      }

      const path = parentPath ? `${parentPath}/${finalName}` : `/${finalName}`

      const query = `
        INSERT INTO items (
          type, parent_id, path, name, content,
          metadata, icon, color, position, workspace_id
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
        )
        RETURNING *
      `

      const values = [
        type,
        parentId || null,
        path,
        finalName,
        type === 'note' ? (content || null) : null,
        metadata,
        icon || null,
        color || null,
        position,
        activeWorkspaceId,
      ]

      try {
        const result = await client.query(query, values)
        const row = result.rows[0]
        const item = {
          id: row.id,
          type: row.type,
          parentId: row.parent_id,
          path: row.path,
          name: row.name,
          slug: row.slug,
          position: row.position,
          content: row.content,
          metadata: row.metadata,
          icon: row.icon,
          color: row.color,
          lastAccessedAt: row.last_accessed_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }

        if (type === 'note') {
          await client.query(
            `
              INSERT INTO notes (id, title, metadata, workspace_id, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                metadata = EXCLUDED.metadata,
                updated_at = EXCLUDED.updated_at
            `,
            [row.id, row.name, metadata, activeWorkspaceId, row.created_at, row.updated_at],
          )

          // Fire-and-forget: index note for retrieval (non-blocking)
          if (row.content) {
            indexItem({
              id: row.id,
              name: row.name,
              path: row.path,
              content: row.content,
              userId: row.user_id,
              workspaceId: activeWorkspaceId,
            }).catch(err => console.error('[ItemsAPI] Background index failed:', err))
          }
        }

        return NextResponse.json({ item }, { status: 201 })
      } catch (error: any) {
        if (error?.code === '23505' && error?.constraint === 'ux_items_workspace_path') {
          const existingResult = await client.query(
            `
              SELECT id, type, parent_id, path, name, slug, position,
                     content, metadata, icon, color,
                     last_accessed_at, created_at, updated_at
              FROM items
              WHERE workspace_id = $1
                AND path = $2
                AND deleted_at IS NULL
              LIMIT 1
            `,
            [activeWorkspaceId, path],
          )

          const existingRow = existingResult.rows[0]
          if (existingRow) {
            const existingItem = {
              id: existingRow.id,
              type: existingRow.type,
              parentId: existingRow.parent_id,
              path: existingRow.path,
              name: existingRow.name,
              slug: existingRow.slug,
              position: existingRow.position,
              content: existingRow.content,
              metadata: existingRow.metadata,
              icon: existingRow.icon,
              color: existingRow.color,
              lastAccessedAt: existingRow.last_accessed_at,
              createdAt: existingRow.created_at,
              updatedAt: existingRow.updated_at,
            }

            return NextResponse.json({ item: existingItem, duplicate: true }, { status: 200 })
          }
        }

        console.error('Error creating item:', error)
        return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
      }
    })
  } catch (error) {
    console.error('Error creating item:', error)
    return NextResponse.json(
      { error: 'Failed to create item' },
      { status: 500 },
    )
  }
}

// GET /api/items/recent - Get recent notes
export async function GET_RECENT(request: NextRequest) {
  if (!request.url.includes('/recent')) {
    return GET(request)
  }
  
  try {
    const limit = parseInt(request.nextUrl.searchParams.get('limit') || '10')
    
    const query = `
      SELECT
        id, type, parent_id, path, name, slug, position,
        metadata, icon, color,
        last_accessed_at AT TIME ZONE 'UTC' as last_accessed_at,
        created_at AT TIME ZONE 'UTC' as created_at,
        updated_at AT TIME ZONE 'UTC' as updated_at
      FROM items
      WHERE type = 'note'
        AND deleted_at IS NULL
        AND last_accessed_at IS NOT NULL
      ORDER BY last_accessed_at DESC
      LIMIT $1
    `
    
    const result = await serverPool.query(query, [limit])
    
    const items = result.rows.map(row => ({
      id: row.id,
      type: row.type,
      parentId: row.parent_id,
      path: row.path,
      name: row.name,
      slug: row.slug,
      position: row.position,
      metadata: row.metadata,
      icon: row.icon,
      color: row.color,
      lastAccessedAt: row.last_accessed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
    
    return NextResponse.json({ items })
  } catch (error) {
    console.error('Error fetching recent items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recent items' },
      { status: 500 }
    )
  }
}
