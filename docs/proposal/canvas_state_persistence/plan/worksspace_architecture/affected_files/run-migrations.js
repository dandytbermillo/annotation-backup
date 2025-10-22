#!/usr/bin/env node

/**
 * Database Migration Runner
 * Applies SQL migrations from the migrations/ directory
 */

const { Pool } = require('pg')
const fs = require('fs').promises
const path = require('path')
const { execSync } = require('child_process')

// ANSI color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
}

// Get database connection from environment
const getDatabaseUrl = () => {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL
  }
  
  // Build from individual env vars
  const user = process.env.POSTGRES_USER || 'postgres'
  const password = process.env.POSTGRES_PASSWORD || 'postgres'
  const host = process.env.POSTGRES_HOST || 'localhost'
  const port = process.env.POSTGRES_PORT || '5432'
  const database = process.env.POSTGRES_DB || 'annotation_dev'
  
  return `postgresql://${user}:${password}@${host}:${port}/${database}`
}

async function runMigrations() {
  const connectionString = getDatabaseUrl()
  console.log('🚀 Starting database migrations...')
  console.log(`📊 Database: ${connectionString.replace(/:([^@]+)@/, ':****@')}`)
  
  const pool = new Pool({ connectionString })
  
  try {
    // Test connection
    await pool.query('SELECT 1')
    console.log(`${colors.green}✓ Database connection successful${colors.reset}`)
    
    // Create migrations table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Get list of applied migrations
    const appliedResult = await pool.query('SELECT filename FROM _migrations ORDER BY filename')
    const appliedMigrations = new Set(appliedResult.rows.map(row => row.filename))
    
    // Read migration files
    const migrationsDir = path.join(__dirname, '..', 'migrations')
    const files = await fs.readdir(migrationsDir)
    
    // Filter and sort .up.sql files
    const upMigrations = files
      .filter(f => f.endsWith('.up.sql'))
      .sort()
    
    console.log(`\n📁 Found ${upMigrations.length} migration files`)
    console.log(`✅ Already applied: ${appliedMigrations.size}`)
    
    // Apply new migrations
    let appliedCount = 0
    for (const filename of upMigrations) {
      if (!appliedMigrations.has(filename)) {
        console.log(`\n🔄 Applying: ${filename}`)
        
        try {
          // Read and execute migration
          const filepath = path.join(migrationsDir, filename)
          const sql = await fs.readFile(filepath, 'utf8')
          
          // Start transaction
          await pool.query('BEGIN')
          
          try {
            // Execute migration
            await pool.query(sql)
            
            // Record migration
            await pool.query(
              'INSERT INTO _migrations (filename) VALUES ($1)',
              [filename]
            )
            
            // Commit transaction
            await pool.query('COMMIT')
            
            console.log(`${colors.green}✓ Applied successfully${colors.reset}`)
            appliedCount++
          } catch (error) {
            // Rollback on error
            await pool.query('ROLLBACK')
            throw error
          }
        } catch (error) {
          console.error(`${colors.red}✗ Failed to apply ${filename}:${colors.reset}`)
          console.error(error.message)
          throw error
        }
      }
    }
    
    if (appliedCount === 0) {
      console.log(`\n${colors.green}✓ All migrations are up to date${colors.reset}`)
    } else {
      console.log(`\n${colors.green}✓ Applied ${appliedCount} new migration(s)${colors.reset}`)
    }
    
    // Show final state
    const tables = await pool.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename NOT LIKE 'pg_%'
      AND tablename != '_migrations'
      ORDER BY tablename
    `)
    
    console.log('\n📊 Database tables:')
    tables.rows.forEach(row => {
      console.log(`  • ${row.tablename}`)
    })
    
  } catch (error) {
    console.error(`\n${colors.red}❌ Migration failed:${colors.reset}`)
    console.error(error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

// Handle command line args
const command = process.argv[2]

if (command === '--rollback') {
  console.log('Rollback functionality not implemented yet')
  console.log('To rollback, manually run the .down.sql files in reverse order')
  process.exit(1)
} else if (command === '--help') {
  console.log('Usage: node scripts/run-migrations.js [options]')
  console.log('Options:')
  console.log('  --help      Show this help message')
  console.log('  --rollback  Rollback last migration (not implemented)')
  console.log('')
  console.log('Environment variables:')
  console.log('  DATABASE_URL  - Full PostgreSQL connection string')
  console.log('  Or individual components:')
  console.log('  POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB')
  process.exit(0)
}

// Run migrations
runMigrations().catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})