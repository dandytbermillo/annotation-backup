// jest.setup.js
require('fake-indexeddb/auto')

if (!global.window) global.window = global
if (!global.navigator) {
  global.navigator = { onLine: true, userAgent: 'jest' }
} else if (!('onLine' in global.navigator)) {
  Object.defineProperty(global.navigator, 'onLine', { value: true, writable: true, configurable: true })
} else {
  // Make existing onLine property writable
  Object.defineProperty(global.navigator, 'onLine', { value: true, writable: true, configurable: true })
}

if (!global.localStorage) {
  const store = new Map()
  global.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  }
}

global.window.localStorage = global.localStorage

// Event handling for window events (needed by offline queue)
const eventListeners = new Map()

global.window.addEventListener = function(event, handler) {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, [])
  }
  eventListeners.get(event).push(handler)
}

global.window.dispatchEvent = function(event) {
  const handlers = eventListeners.get(event.type) || []
  handlers.forEach(h => h(event))
  return true
}

// Bind setInterval/clearInterval from Node.js globals
global.window.setInterval = global.setInterval
global.window.clearInterval = global.clearInterval

// Attach IndexedDB to window (provided by fake-indexeddb)
global.window.indexedDB = global.indexedDB
