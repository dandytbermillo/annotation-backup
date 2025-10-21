/**
 * Diagnostic script to check actual dataStore values
 * Run this AFTER CanvasProvider has mounted and connections SVG has rendered
 */

const noteId = '81f99faa-8425-4666-901d-1b041c137163'

console.log('=== DataStore Diagnostic ===\n')

// Step 1: Check if window.canvasDataStore is available
if (!window.canvasDataStore) {
  console.error('❌ window.canvasDataStore is not available yet')
  console.log('Wait a few seconds for CanvasProvider effect to run, then try again')
  console.log('\nOr check if the dataStore is available under a different name:')
  console.log('window keys containing "data":', Object.keys(window).filter(k => k.toLowerCase().includes('data')))
} else {
  console.log('✅ window.canvasDataStore is available\n')

  // Step 2: Get all branch entries
  const allEntries = []
  window.canvasDataStore.forEach((value, key) => {
    if (key.includes('branch-')) {
      allEntries.push({
        storeKey: key,
        branchId: value.id,
        parentId: value.parentId,
        isNormalized: !value.parentId || value.parentId === 'main' || value.parentId.startsWith('branch-'),
        type: value.type,
        title: value.title || '(no title)'
      })
    }
  })

  console.log('Branch entries in dataStore:')
  console.table(allEntries)

  // Step 3: Check for raw UUIDs
  const rawUUIDs = allEntries.filter(e => !e.isNormalized)
  if (rawUUIDs.length > 0) {
    console.error('\n❌ FOUND RAW UUID parentId VALUES:')
    console.table(rawUUIDs)
    console.log('\n→ This is the root cause: normalization is not running for these entries')
  } else {
    console.log('\n✅ All parentId values are normalized')
    console.log('→ If connections are still missing, the issue is elsewhere (e.g., panel lookup failure)')
  }

  // Step 4: Check specific branch (replace UUID with your actual branch ID)
  console.log('\n--- Detailed check for specific branch ---')
  console.log('Replace the UUID below with your actual branch ID from the table above:\n')
  console.log(`const branchId = 'branch-PASTE_UUID_HERE'`)
  console.log(`const key = '${noteId}::\${branchId}'`)
  console.log(`const branch = window.canvasDataStore.get(key)`)
  console.log(`console.log('Branch data:', branch)`)
  console.log(`console.log('Parent ID:', branch?.parentId)`)
  console.log(`console.log('Is normalized?', branch?.parentId === 'main' || branch?.parentId?.startsWith('branch-'))`)
}

console.log('\n=== Run this script on BOTH "connections present" and "connections missing" reloads ===')
