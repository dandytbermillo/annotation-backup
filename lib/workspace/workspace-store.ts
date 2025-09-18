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
      const workspacePromise = pool
        .query<{ get_or_create_default_workspace: string }>(
          'SELECT get_or_create_default_workspace() AS get_or_create_default_workspace'
        )
        .then(result => result.rows[0].get_or_create_default_workspace)
        .catch(error => {
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
  process.env.NEXT_PUBLIC_FEATURE_WORKSPACE_SCOPING === 'true';

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