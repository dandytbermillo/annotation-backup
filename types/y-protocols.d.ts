declare module 'y-protocols/awareness' {
  import { Doc } from 'yjs'
  
  export class Awareness {
    constructor(doc: Doc)
    clientID: number
    getLocalState(): any
    setLocalState(state: any): void
    setLocalStateField(field: string, value: any): void
    getStates(): Map<number, any>
    on(event: string, handler: Function): void
    off(event: string, handler: Function): void
    destroy(): void
  }
  
  export const removeAwarenessStates: (awareness: Awareness, clients: number[], origin: any) => void
}