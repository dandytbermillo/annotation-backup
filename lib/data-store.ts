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
    this.set(key, { ...existing, ...updates })
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
