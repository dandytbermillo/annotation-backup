import { CollaborationProvider } from '../lib/yjs-provider'
import { EnhancedCollaborationProvider } from '../lib/enhanced-yjs-provider'
import * as Y from 'yjs'

interface MigrationOptions {
  backupData?: boolean
  dryRun?: boolean
  verbose?: boolean
}

export async function migrateToEnhancedArchitecture(options: MigrationOptions = {}) {
  const { backupData = true, dryRun = false, verbose = false } = options

  console.log('🚀 Starting migration to Enhanced YJS Architecture...')

  try {
    // Step 1: Backup existing data
    if (backupData) {
      console.log('📦 Creating backup of existing data...')
      await createDataBackup()
    }

    // Step 2: Initialize enhanced provider
    console.log('🔧 Initializing enhanced provider...')
    const enhancedProvider = EnhancedCollaborationProvider.getInstance()

    // Step 3: Migrate existing notes
    console.log('📝 Migrating existing notes...')
    const existingNotes = await getExistingNotes()
    
    for (const noteId of existingNotes) {
      if (verbose) console.log(`  Migrating note: ${noteId}`)
      await migrateNote(noteId, enhancedProvider, dryRun)
    }

    // Step 4: Verify migration
    console.log('✅ Verifying migration...')
    await verifyMigration(enhancedProvider)

    console.log('🎉 Migration completed successfully!')
    
    return {
      success: true,
      migratedNotes: existingNotes.length
    }

  } catch (error) {
    console.error('❌ Migration failed:', error)
    
    if (backupData) {
      console.log('🔄 Restoring from backup...')
      await restoreFromBackup()
    }
    
    throw error
  }
}

async function createDataBackup(): Promise<void> {
  const backupData = {
    timestamp: new Date().toISOString(),
    localStorage: { ...localStorage }
  }
  
  localStorage.setItem('yjs-migration-backup', JSON.stringify(backupData))
  console.log('✅ Backup created successfully')
}

async function migrateNote(noteId: string, provider: EnhancedCollaborationProvider, dryRun: boolean): Promise<void> {
  const oldProvider = CollaborationProvider.getInstance()
  oldProvider.setCurrentNote(noteId)
  
  const branchesMap = oldProvider.getBranchesMap()
  const noteData: Record<string, any> = {}
  
  branchesMap.forEach((panelData, panelId) => {
    noteData[panelId] = {
      title: panelData.title || 'Untitled',
      type: panelData.type || 'branch',
      position: panelData.position || { x: 100, y: 100 },
      dimensions: panelData.dimensions || { width: 600, height: 400 },
      content: panelData.content || '<p>Migrated content</p>',
      isEditable: panelData.isEditable ?? true
    }
  })
  
  if (!dryRun) {
    await provider.initializeNote(noteId, noteData)
    
    // Migrate branches
    branchesMap.forEach((panelData, panelId) => {
      if (panelData.branches && Array.isArray(panelData.branches)) {
        panelData.branches.forEach((branchId: string) => {
          const branchData = branchesMap.get(branchId)
          if (branchData) {
            provider.addBranch(panelId, branchId, {
              type: branchData.type || 'note',
              originalText: branchData.originalText || '',
              anchors: branchData.anchors || {}
            })
          }
        })
      }
    })
  }
}

async function verifyMigration(provider: EnhancedCollaborationProvider): Promise<void> {
  const mainDoc = provider.getMainDoc()
  const branches = mainDoc.getMap('branches')
  const metadata = mainDoc.getMap('metadata')
  const presence = mainDoc.getMap('presence')
  
  if (!branches || !metadata || !presence) {
    throw new Error('Migration verification failed: Missing required YJS structures')
  }
  
  console.log('✅ Migration verification passed')
  console.log(`  - Branches: ${branches.size}`)
  console.log(`  - Metadata: ${metadata.size}`)
}

async function getExistingNotes(): Promise<string[]> {
  const keys = Object.keys(localStorage).filter(key => key.startsWith('yjs-doc-'))
  return keys.map(key => key.replace('yjs-doc-', ''))
}

async function restoreFromBackup(): Promise<void> {
  const backup = localStorage.getItem('yjs-migration-backup')
  if (backup) {
    const backupData = JSON.parse(backup)
    Object.entries(backupData.localStorage).forEach(([key, value]) => {
      localStorage.setItem(key, value as string)
    })
    console.log('✅ Restored from backup successfully')
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2)
  const options: MigrationOptions = {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
    backupData: !args.includes('--no-backup')
  }
  
  migrateToEnhancedArchitecture(options)
    .then(result => {
      console.log(`\nMigration complete! Migrated ${result.migratedNotes} notes.`)
      process.exit(0)
    })
    .catch(error => {
      console.error('\nMigration failed:', error)
      process.exit(1)
    })
} 