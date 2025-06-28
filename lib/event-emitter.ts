export class EventEmitter {
  private events: { [key: string]: Function[] } = {}

  on(event: string, listener: Function) {
    if (!this.events[event]) {
      this.events[event] = []
    }
    this.events[event].push(listener)
  }

  emit(event: string, data?: any) {
    if (this.events[event]) {
      this.events[event].forEach((listener) => listener(data))
    }
  }

  off(event: string, listenerToRemove: Function) {
    if (this.events[event]) {
      this.events[event] = this.events[event].filter((listener) => listener !== listenerToRemove)
    }
  }
}
