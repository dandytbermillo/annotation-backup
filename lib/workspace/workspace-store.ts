/**
 * Workspace management helpers – reuse existing pg.Pool instances and
 * provide a single place to scope queries.
 */
import { Pool, PoolClient } from 'pg';

const workspaceIdCache = new WeakMap<Pool, Promise<string>>();

export class WorkspaceStore {
  /**
   * Lazily fetch (and memoize) the default workspace id for a pool.
   */
  static async getDefaultWorkspaceId(pool: Pool): Promise<string> {
    if (!workspaceIdCache.has(pool)) {
      const workspacePromise = (async () => {
        const existing = await pool.query<{ id: string }>(
          'SELECT id FROM workspaces WHERE is_default = true LIMIT 1'
        );
        if (existing.rowCount > 0) {
          return existing.rows[0].id;
        }

        const adoptFromNotes = await pool.query<{ workspace_id: string }>(
          `SELECT workspace_id
             FROM notes
            WHERE workspace_id IS NOT NULL
            ORDER BY updated_at DESC
            LIMIT 1`
        );
        if (adoptFromNotes.rowCount > 0) {
          const workspaceId = adoptFromNotes.rows[0].workspace_id;
          await pool.query('UPDATE workspaces SET is_default = (id = $1)', [workspaceId]);
          return workspaceId;
        }

        const adoptFromDocuments = await pool.query<{ workspace_id: string }>(
          `SELECT workspace_id
             FROM document_saves
            WHERE workspace_id IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1`
        );
        if (adoptFromDocuments.rowCount > 0) {
          const workspaceId = adoptFromDocuments.rows[0].workspace_id;
          await pool.query('UPDATE workspaces SET is_default = (id = $1)', [workspaceId]);
          return workspaceId;
        }

        const inserted = await pool.query<{ id: string }>(
          `INSERT INTO workspaces (name, is_default)
           VALUES ('Default Workspace', true)
           ON CONFLICT ON CONSTRAINT only_one_default
           DO UPDATE SET is_default = true, updated_at = NOW()
           RETURNING id`
        );
        return inserted.rows[0].id;
      })().catch(error => {
        workspaceIdCache.delete(pool);
        throw error;
      });

      workspaceIdCache.set(pool, workspacePromise);
    }

    return workspaceIdCache.get(pool)!;
  }

  /**
   * Run a callback with `app.current_workspace_id` set for the session.
   * Ensures RLS/trigger logic can rely on the setting.
   */
  static async withWorkspace<T>(
    pool: Pool,
    fn: (ctx: { client: PoolClient; workspaceId: string }) => Promise<T>
  ): Promise<T> {
    const workspaceId = await this.getDefaultWorkspaceId(pool);
    const client = await pool.connect();

    try {
      await client.query('SELECT set_config($1, $2, false)', [
        'app.current_workspace_id',
        workspaceId,
      ]);

      return await fn({ client, workspaceId });
    } finally {
      client.release();
    }
  }
}

/**
 * Feature flag to enable/disable workspace scoping
 * Can be toggled via environment variable for gradual rollout
 */
export const FEATURE_WORKSPACE_SCOPING =
  process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_SCOPING !== 'false';

/**
 * Helper function to simplify API route usage
 */
export async function withWorkspaceClient<T>(
  pool: Pool,
  handler: (client: PoolClient, workspaceId: string) => Promise<T>
): Promise<T> {
  return WorkspaceStore.withWorkspace(pool, ({ client, workspaceId }) =>
    handler(client, workspaceId)
  );
}
