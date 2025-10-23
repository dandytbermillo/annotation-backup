/**
 * Jest Setup File
 *
 * Provides global mocks for browser APIs needed by integration tests
 */

// Polyfill IndexedDB for Node.js test environment
require('fake-indexeddb/auto')

// Set up global.window (needed for browser API tests)
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis
}

// Set up global.navigator with onLine property
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { onLine: true, userAgent: 'jest' }
} else if (!('onLine' in globalThis.navigator)) {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value: true,
    writable: true,
    configurable: true
  })
}

// Event handling for window events (online, offline, etc.)
const eventListeners = new Map()

globalThis.window.addEventListener = function(event, handler) {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, [])
  }
  eventListeners.get(event).push(handler)
}

globalThis.window.dispatchEvent = function(event) {
  const handlers = eventListeners.get(event.type) || []
  handlers.forEach(h => h(event))
  return true
}

// Bind setInterval/clearInterval from Node.js globals
globalThis.window.setInterval = globalThis.setInterval
globalThis.window.clearInterval = globalThis.clearInterval

// localStorage mock (Map-based in-memory storage)
if (!globalThis.localStorage) {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: (key) => { store.delete(key) },
    clear: () => store.clear(),
    get length() { return store.size },
    key: (index) => {
      const keys = Array.from(store.keys())
      return keys[index] || null
    }
  }
}

// Attach localStorage to window
globalThis.window.localStorage = globalThis.localStorage

// Attach IndexedDB to window (provided by fake-indexeddb)
globalThis.window.indexedDB = globalThis.indexedDB
