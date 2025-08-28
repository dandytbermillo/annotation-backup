// Basic Electron type declarations for the project
// This is a minimal subset needed for our IPC handlers

declare module 'electron' {
  export interface IpcMainInvokeEvent {
    processId: number
    frameId: number
    sender: any
  }
  
  export interface IpcMain {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any): void
    removeHandler(channel: string): void
  }
  
  export interface IpcRenderer {
    invoke(channel: string, ...args: any[]): Promise<any>
    send(channel: string, ...args: any[]): void
    on(channel: string, listener: (event: any, ...args: any[]) => void): void
  }
  
  export interface ContextBridge {
    exposeInMainWorld(apiKey: string, api: any): void
  }
  
  export const ipcMain: IpcMain
  export const ipcRenderer: IpcRenderer
  export const contextBridge: ContextBridge
}