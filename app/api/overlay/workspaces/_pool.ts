import { Pool } from 'pg'

let pool: Pool | null = null

export function getWorkspacePool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ||
        'postgresql://postgres:postgres@localhost:5432/annotation_dev',
    })
  }
  return pool
}

export async function closeWorkspacePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
