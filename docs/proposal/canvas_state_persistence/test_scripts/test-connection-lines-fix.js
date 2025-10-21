/**
 * Test script for connection lines fix
 * Run this in browser console to verify localStorage normalization
 */

// Replace with your actual note ID
const noteId = '81f99faa-8425-4666-901d-1b041c137163'

console.log('=== Connection Lines Fix Test ===\n')

// Step 1: Check current localStorage state
console.log('Step 1: Checking current localStorage state...')
const currentSnapshot = localStorage.getItem(`note-data-${noteId}`)
if (currentSnapshot) {
  const parsed = JSON.parse(currentSnapshot)
  const branchParents = Object.entries(parsed)
    .filter(([k]) => k.startsWith('branch-'))
    .map(([k, v]) => ({
      branch: k,
      parentId: v.parentId,
      isNormalized: !v.parentId || v.parentId === 'main' || v.parentId.startsWith('branch-')
    }))

  console.log('Current branch parentId values:')
  console.table(branchParents)

  const hasRawUUIDs = branchParents.some(b => !b.isNormalized)
  if (hasRawUUIDs) {
    console.warn('⚠️  Found raw UUID parentId values in cache (will cause connection failures)')
  } else {
    console.log('✅ All parentId values are normalized')
  }
} else {
  console.log('No localStorage snapshot found')
}

// Step 2: Clear the cache
console.log('\nStep 2: Clearing localStorage cache...')
localStorage.removeItem(`note-data-${noteId}`)
console.log('✅ Cache cleared')

// Step 3: Provide reload instructions
console.log('\nStep 3: Testing Instructions')
console.log('─────────────────────────────────')
console.log('1. Reload the app now (the cache is cleared)')
console.log('2. Check if connection lines appear')
console.log('3. Reload 7-10 more times and verify connection lines appear EVERY time')
console.log('4. After testing, run this verification script:\n')

console.log(`
// Verification script - run after reloads
const snapshot = JSON.parse(localStorage.getItem('note-data-${noteId}'))
const branchParents = Object.entries(snapshot)
  .filter(([k]) => k.startsWith('branch-'))
  .map(([k, v]) => ({
    branch: k,
    parentId: v.parentId,
    isNormalized: !v.parentId || v.parentId === 'main' || v.parentId.startsWith('branch-')
  }))

console.log('Saved parentId values after fix:')
console.table(branchParents)

const allNormalized = branchParents.every(b => b.isNormalized)
if (allNormalized) {
  console.log('✅ SUCCESS: All parentId values are now normalized in localStorage')
} else {
  console.error('❌ FAILED: Some parentId values are still raw UUIDs')
}
`)

console.log('\n=== Ready to test - Reload the app now ===')
