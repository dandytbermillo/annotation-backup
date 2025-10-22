/**
 * Check localStorage for ghost panel "main 4.1"
 * Run in browser console
 */

const noteId = '7ffe06d6-25d0-4b78-8669-2bf05f2c6b18'

console.log('=== Ghost Panel localStorage Check ===\n')

const snapshot = localStorage.getItem(`note-data-${noteId}`)

if (snapshot) {
  console.log('✅ localStorage snapshot EXISTS')
  const parsed = JSON.parse(snapshot)

  console.log('\nMain panel data:')
  console.log(parsed.main)

  console.log('\nAll panel states:')
  Object.entries(parsed).forEach(([key, value]) => {
    console.log(`${key}: state=${value.state || 'undefined'}`)
  })

  console.log('\n🔍 The problem: localStorage snapshot keeps reviving the panel')
  console.log('To fix: Delete this cache OR implement the proposed diff')
  console.log('\nRun this to delete cache:')
  console.log(`localStorage.removeItem('note-data-${noteId}')`)
} else {
  console.log('❌ No localStorage snapshot found')
  console.log('The panel is loading from database with state=active')
}
