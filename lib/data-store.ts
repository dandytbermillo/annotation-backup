export class DataStore {
  private data = new Map<string, any>()

  get(key: string) {
    return this.data.get(key)
  }

  set(key: string, value: any) {
    this.data.set(key, value)
  }

  has(key: string) {
    return this.data.has(key)
  }

  update(key: string, updates: any) {
    const existing = this.get(key) || {}
    this.set(key, { ...existing, ...updates })
  }

  forEach(callback: (value: any, key: string) => void) {
    this.data.forEach(callback)
  }

  delete(key: string) {
    return this.data.delete(key)
  }
}
