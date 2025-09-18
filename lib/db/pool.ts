import { Pool } from 'pg';

/**
 * Shared PostgreSQL connection pool for all server-side operations.
 * This ensures we don't create multiple pools which could exhaust connections.
 */

let _serverPool: Pool | null = null;

/**
 * Get or create the shared server pool instance.
 * This pool is reused across all API routes and server operations.
 */
export function getServerPool(): Pool {
  if (!_serverPool) {
    const connectionString = process.env.DATABASE_URL || 
      'postgresql://postgres:postgres@localhost:5432/annotation_dev';
    
    _serverPool = new Pool({
      connectionString,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
      connectionTimeoutMillis: 2000, // How long to wait when connecting a new client
    });

    // Handle pool errors
    _serverPool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client:', err);
      // Don't set _serverPool to null here as it might still be functional
    });

    // Log successful connection (async, non-blocking)
    _serverPool.query('SELECT 1')
      .then(() => console.log('PostgreSQL pool initialized successfully'))
      .catch(err => console.error('PostgreSQL pool initialization warning:', err));
  }

  return _serverPool;
}

/**
 * Export as named export for convenience
 */
export const serverPool = getServerPool();