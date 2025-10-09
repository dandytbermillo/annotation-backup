import { EventEmitter } from './event-emitter'

export class DataStore extends EventEmitter {
  private data = new Map<string, any>()

  get(key: string) {
    return this.data.get(key)
  }

  set(key: string, value: any) {
    this.data.set(key, value)
    this.emit('set', key)
  }

  has(key: string) {
    return this.data.has(key)
  }

  update(key: string, updates: any) {
    const existing = this.get(key) || {}
    const newValue = { ...existing, ...updates }

    // Debug: Log all updates to 'main' panel
    if (key === 'main') {
      console.log('[DataStore] UPDATE to main panel:', {
        key,
        oldBranches: existing?.branches,
        newBranches: newValue?.branches,
        updates,
        stackTrace: new Error().stack?.split('\n').slice(2, 6).join('\n')
      })
    }

    this.set(key, newValue)
    this.emit('update', key)
  }

  forEach(callback: (value: any, key: string) => void) {
    this.data.forEach(callback)
  }

  delete(key: string) {
    const result = this.data.delete(key)
    if (result) {
      this.emit('delete', key)
    }
    return result
  }
}
