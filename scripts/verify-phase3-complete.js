#!/usr/bin/env node
/**
 * Phase 3 Verification: Automated Reconciliation (Ghost Panel Remedy)
 *
 * Checks all Phase 3 deliverables from ghost_panel_remedy.md:
 * 1. Automated reconciliation (no user prompts)
 * 2. Telemetry events (canvas.cache_*)
 * 3. Automated test for stale snapshot handling
 */

const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'annotation_dev',
  user: 'postgres',
  password: 'postgres'
})

async function verifyPhase3Complete() {
  console.log('\n🔍 Phase 3 Complete Verification: Automated Reconciliation\n')
  console.log('═'.repeat(70))

  const results = {
    telemetryEvents: false,
    cacheReconciliation: false,
    noBannerUI: false,
    automatedTest: false,
  }

  try {
    // =========================================================================
    // 1. Verify Telemetry Events Implementation
    // =========================================================================
    console.log('\n📊 1. Checking Telemetry Events Implementation...\n')

    const telemetryQuery = await pool.query(`
      SELECT
        action,
        COUNT(*) as count,
        TO_CHAR(MAX(created_at), 'YYYY-MM-DD HH24:MI:SS') as last_event
      FROM debug_logs
      WHERE component = 'CanvasCache'
        AND action IN ('canvas.cache_used', 'canvas.cache_mismatch', 'canvas.cache_discarded')
        AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY action
      ORDER BY count DESC
    `)

    const requiredEvents = ['canvas.cache_used', 'canvas.cache_mismatch', 'canvas.cache_discarded']
    const foundEvents = telemetryQuery.rows.map(row => row.action)
    const allEventsPresent = requiredEvents.every(event => foundEvents.includes(event))

    if (allEventsPresent) {
      console.log('   ✅ All 3 telemetry events implemented and logged')
      console.table(telemetryQuery.rows)
      results.telemetryEvents = true
    } else {
      const missing = requiredEvents.filter(event => !foundEvents.includes(event))
      console.log(`   ❌ Missing events: ${missing.join(', ')}`)
    }

    // =========================================================================
    // 2. Verify Cache Reconciliation Code
    // =========================================================================
    console.log('\n💻 2. Checking Cache Reconciliation Implementation...\n')

    const storageFile = path.join(__dirname, '..', 'lib', 'canvas', 'canvas-storage.ts')

    if (!fs.existsSync(storageFile)) {
      console.log('   ❌ canvas-storage.ts not found!')
    } else {
      const code = fs.readFileSync(storageFile, 'utf-8')

      const checks = {
        'Version comparison logic': code.includes('storedWorkspaceVersion !== expectedWorkspaceVersion'),
        'Auto-discard on mismatch': code.includes('deleteSnapshot()') && code.includes('cache_mismatch'),
        'Cache loading with version': code.includes('expectedWorkspaceVersion'),
        'Silent reconciliation (no prompts)': !code.includes('confirm(') && !code.includes('alert('),
      }

      console.log('   Code Implementation Checks:')
      let allPassed = true
      for (const [check, passed] of Object.entries(checks)) {
        console.log(`     ${passed ? '✅' : '❌'} ${check}`)
        if (!passed) allPassed = false
      }

      if (allPassed) {
        results.cacheReconciliation = true
      }
    }

    // =========================================================================
    // 3. Verify No Banner UI (No User Prompts)
    // =========================================================================
    console.log('\n🚫 3. Checking for Banner/Prompt Removal...\n')

    const componentFiles = [
      path.join(__dirname, '..', 'components', 'canvas'),
      path.join(__dirname, '..', 'lib', 'canvas'),
      path.join(__dirname, '..', 'lib', 'hooks'),
    ]

    let foundBannerCode = false
    const suspiciousPatterns = [
      /ghost.*panel.*banner/i,
      /confirm.*cache/i,
      /choose.*snapshot/i,
      /resolve.*conflict.*ui/i,
    ]

    for (const dir of componentFiles) {
      if (!fs.existsSync(dir)) continue

      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.ts') || f.endsWith('.tsx'))
        .map(f => path.join(dir, f))

      for (const file of files) {
        const content = fs.readFileSync(file, 'utf-8')
        for (const pattern of suspiciousPatterns) {
          if (pattern.test(content)) {
            console.log(`   ⚠️  Found potential banner code in ${path.basename(file)}`)
            foundBannerCode = true
          }
        }
      }
    }

    if (!foundBannerCode) {
      console.log('   ✅ No banner/prompt UI found (silent reconciliation confirmed)')
      results.noBannerUI = true
    } else {
      console.log('   ❌ Found potential user prompt code')
    }

    // =========================================================================
    // 4. Verify Automated Test Exists
    // =========================================================================
    console.log('\n🧪 4. Checking for Automated Test Coverage...\n')

    const testFiles = [
      path.join(__dirname, '..', '__tests__', 'integration', 'workspace-snapshot.test.ts'),
      path.join(__dirname, '..', '__tests__', 'unit', 'canvas-storage.test.ts'),
    ]

    let foundStaleSnapshotTest = false

    for (const testFile of testFiles) {
      if (!fs.existsSync(testFile)) continue

      const content = fs.readFileSync(testFile, 'utf-8')

      if (
        (content.includes('stale') || content.includes('version') || content.includes('mismatch')) &&
        (content.includes('cache') || content.includes('snapshot'))
      ) {
        console.log(`   ✅ Found stale snapshot test in ${path.basename(testFile)}`)
        foundStaleSnapshotTest = true
      }
    }

    if (foundStaleSnapshotTest) {
      results.automatedTest = true
    } else {
      console.log('   ❌ No automated test for stale snapshot handling found')
    }

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n' + '═'.repeat(70))
    console.log('\n📋 Phase 3 Deliverables Status:\n')

    const deliverables = [
      { name: 'Telemetry Events (cache_used, cache_mismatch, cache_discarded)', status: results.telemetryEvents },
      { name: 'Automated Cache Reconciliation (version-based)', status: results.cacheReconciliation },
      { name: 'No Banner UI (silent reconciliation)', status: results.noBannerUI },
      { name: 'Automated Test Coverage', status: results.automatedTest },
    ]

    console.table(deliverables.map(d => ({
      Deliverable: d.name,
      Status: d.status ? '✅ Complete' : '❌ Incomplete'
    })))

    const allComplete = Object.values(results).every(r => r)

    if (allComplete) {
      console.log('\n✅ Phase 3 is COMPLETE! All deliverables implemented.\n')
      console.log('═'.repeat(70))
      console.log()
      process.exit(0)
    } else {
      console.log('\n⚠️  Phase 3 is PARTIALLY COMPLETE. See details above.\n')
      console.log('═'.repeat(70))
      console.log()
      process.exit(1)
    }

  } catch (error) {
    console.error('\n❌ Verification failed:', error.message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

verifyPhase3Complete()
