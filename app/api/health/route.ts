/**
 * Health Endpoint - Hardened for Phase 1
 * 
 * Features:
 * - Lightweight HEAD/GET support
 * - Database connectivity check
 * - Response time tracking
 * - Cache headers for reduced load
 * - Proper status codes
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

// Create a shared pool for health checks
let healthPool: Pool | null = null;

function getHealthPool(): Pool {
  if (!healthPool) {
    healthPool = new Pool({
      connectionString: process.env.POSTGRES_URL || 'postgresql://postgres:postgres@localhost:5432/annotation_dev',
      max: 2, // Small pool just for health checks
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000, // Fast fail
    });
  }
  return healthPool;
}

export async function HEAD(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Quick DB ping
    const pool = getHealthPool();
    await pool.query('SELECT 1');
    
    // Return 200 OK with minimal headers
    return new NextResponse(null, {
      status: 200,
      headers: {
        'X-Response-Time': `${Date.now() - startTime}ms`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    // Service unavailable if DB is down
    return new NextResponse(null, {
      status: 503,
      headers: {
        'X-Response-Time': `${Date.now() - startTime}ms`,
        'Retry-After': '10', // Suggest retry after 10 seconds
      },
    });
  }
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // More detailed health check for GET
    const pool = getHealthPool();
    
    // Check database
    const dbStart = Date.now();
    const result = await pool.query('SELECT version() as version, NOW() as server_time');
    const dbLatency = Date.now() - dbStart;
    
    // Check queue table exists
    let queueStatus = 'unknown';
    try {
      const queueResult = await pool.query(`
        SELECT COUNT(*) as queue_depth 
        FROM offline_queue 
        WHERE status = 'pending'
      `);
      queueStatus = 'healthy';
    } catch (e) {
      queueStatus = 'missing';
    }
    
    const response = {
      ok: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: Date.now() - startTime,
      database: {
        connected: true,
        latency: dbLatency,
        version: result.rows[0]?.version?.split(' ')[1] || 'unknown',
        serverTime: result.rows[0]?.server_time,
      },
      queue: {
        status: queueStatus,
      },
      environment: process.env.NODE_ENV || 'development',
    };
    
    return NextResponse.json(response, {
      status: 200,
      headers: {
        'X-Response-Time': `${Date.now() - startTime}ms`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    const response = {
      ok: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      responseTime: Date.now() - startTime,
      error: errorMessage,
      database: {
        connected: false,
      },
      environment: process.env.NODE_ENV || 'development',
    };
    
    return NextResponse.json(response, {
      status: 503,
      headers: {
        'X-Response-Time': `${Date.now() - startTime}ms`,
        'Retry-After': '10',
      },
    });
  }
}

// Cleanup on process termination
if (typeof process !== 'undefined') {
  process.on('SIGTERM', async () => {
    if (healthPool) {
      await healthPool.end();
    }
  });
}