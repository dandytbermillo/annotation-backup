import { PersistenceProvider } from '../enhanced-yjs-provider'

/**
 * Web-based PostgreSQL adapter that uses API routes
 * This runs in the browser and communicates with the server
 */
export class WebPostgresAdapter implements PersistenceProvider {
  private baseUrl: string

  constructor(baseUrl: string = '/api/persistence') {
    this.baseUrl = baseUrl
  }

  async persist(docName: string, update: Uint8Array): Promise<void> {
    const response = await fetch(`${this.baseUrl}/persist`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        docName,
        update: Array.from(update), // Convert Uint8Array to array for JSON
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to persist: ${response.statusText}`)
    }
  }

  async load(docName: string): Promise<Uint8Array | null> {
    const response = await fetch(`${this.baseUrl}/load/${encodeURIComponent(docName)}`)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Failed to load: ${response.statusText}`)
    }

    const data = await response.json()
    return data.content ? new Uint8Array(data.content) : null
  }

  async getAllUpdates(docName: string): Promise<Uint8Array[]> {
    const response = await fetch(`${this.baseUrl}/updates/${encodeURIComponent(docName)}`)

    if (!response.ok) {
      throw new Error(`Failed to get updates: ${response.statusText}`)
    }

    const data = await response.json()
    return data.updates.map((update: number[]) => new Uint8Array(update))
  }

  async clearUpdates(docName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/updates/${encodeURIComponent(docName)}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      throw new Error(`Failed to clear updates: ${response.statusText}`)
    }
  }

  async saveSnapshot(docName: string, snapshot: Uint8Array): Promise<void> {
    const response = await fetch(`${this.baseUrl}/snapshot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        docName,
        snapshot: Array.from(snapshot),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to save snapshot: ${response.statusText}`)
    }
  }

  async loadSnapshot(docName: string): Promise<Uint8Array | null> {
    const response = await fetch(`${this.baseUrl}/snapshot/${encodeURIComponent(docName)}`)

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new Error(`Failed to load snapshot: ${response.statusText}`)
    }

    const data = await response.json()
    return data.snapshot ? new Uint8Array(data.snapshot) : null
  }

  async compact(docName: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/compact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ docName }),
    })

    if (!response.ok) {
      throw new Error(`Failed to compact: ${response.statusText}`)
    }
  }
}