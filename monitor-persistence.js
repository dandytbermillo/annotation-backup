// Copy and paste this into the browser console to monitor PostgreSQL persistence

console.log('🔍 Starting PostgreSQL Persistence Monitor...');

// Intercept fetch to monitor persistence calls
const originalFetch = window.fetch;
let persistCalls = 0;
let lastPersistTime = null;

window.fetch = function(...args) {
  const url = args[0];
  
  if (url && url.includes('/api/persistence/persist')) {
    persistCalls++;
    lastPersistTime = new Date();
    
    console.log(`%c📤 PostgreSQL persist call #${persistCalls} at ${lastPersistTime.toLocaleTimeString()}`, 'color: #4CAF50; font-weight: bold');
    console.log('   URL:', url);
    
    if (args[1] && args[1].body) {
      try {
        const body = JSON.parse(args[1].body);
        console.log('   Doc:', body.docName);
        console.log('   Update size:', body.update ? body.update.length : 0);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }
  
  return originalFetch.apply(this, args);
};

console.log('%c✅ Monitoring active. Make some edits in the TipTap editor.', 'color: #2196F3; font-weight: bold');
console.log('You should see persist calls logged here.');

// Check status after 10 seconds
setTimeout(() => {
  console.log(`\n%cStatus Report:`, 'font-weight: bold; font-size: 14px');
  console.log(`Total persist calls: ${persistCalls}`);
  
  if (persistCalls === 0) {
    console.error('%c❌ No persist calls detected! TipTap changes are NOT being saved to PostgreSQL.', 'color: #F44336; font-weight: bold');
  } else {
    console.log(`%c✅ TipTap changes are being persisted to PostgreSQL! (${persistCalls} calls)`, 'color: #4CAF50; font-weight: bold');
  }
}, 10000);