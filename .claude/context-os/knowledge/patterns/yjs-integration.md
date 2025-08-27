# YJS Integration Patterns

## Binary Data Handling

### ❌ Wrong Way
```typescript
// Never try to parse Y.Doc binary directly
const binary = Y.encodeStateAsUpdate(ydoc);
const parsed = JSON.parse(binary); // This will fail!
```

### ✅ Correct Way
```typescript
// Use YJS methods to extract data
import * as Y from 'yjs';

function extractYDocData(ydoc: Y.Doc) {
  const data: any = {};
  
  // Iterate through shared types
  ydoc.share.forEach((value, key) => {
    if (value instanceof Y.Text) {
      data[key] = value.toString();
    } else if (value instanceof Y.Map) {
      data[key] = value.toJSON();
    } else if (value instanceof Y.Array) {
      data[key] = value.toArray();
    } else if (value instanceof Y.XmlFragment) {
      // For TipTap content
      data[key] = yXmlFragmentToJson(value);
    }
  });
  
  return data;
}
```

## TipTap Content Extraction

### Pattern: Convert Y.XmlFragment to JSON
```typescript
function yXmlFragmentToJson(xmlFragment: Y.XmlFragment): any {
  const json: any = {
    type: 'doc',
    content: []
  };
  
  xmlFragment.forEach((xmlElement) => {
    if (xmlElement instanceof Y.XmlElement) {
      json.content.push(yXmlElementToJson(xmlElement));
    } else if (xmlElement instanceof Y.XmlText) {
      json.content.push({
        type: 'text',
        text: xmlElement.toString()
      });
    }
  });
  
  return json;
}
```

## Sync Patterns

### Pattern: Queue-based sync
```typescript
class YjsSyncQueue {
  private queue: SyncTask[] = [];
  private processing = false;
  
  async addUpdate(noteId: string, update: Uint8Array) {
    this.queue.push({ noteId, update, timestamp: Date.now() });
    if (!this.processing) {
      this.processQueue();
    }
  }
  
  private async processQueue() {
    this.processing = true;
    
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 10); // Process in batches
      try {
        await this.syncBatch(batch);
      } catch (error) {
        // Re-queue failed items
        this.queue.unshift(...batch);
        await this.backoff();
      }
    }
    
    this.processing = false;
  }
}
```

## Connection Handling

### Pattern: Resilient WebSocket
```typescript
class ResilientYjsConnection {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timer | null = null;
  private reconnectDelay = 1000;
  
  connect() {
    this.ws = new WebSocket(this.url);
    
    this.ws.onclose = () => {
      this.scheduleReconnect();
    };
    
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }
  
  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }, this.reconnectDelay);
  }
}
```

## Memory Management

### Pattern: Document lifecycle
```typescript
class YDocManager {
  private docs = new Map<string, Y.Doc>();
  private timers = new Map<string, NodeJS.Timer>();
  
  getDoc(id: string): Y.Doc {
    let doc = this.docs.get(id);
    
    if (!doc) {
      doc = new Y.Doc();
      this.docs.set(id, doc);
    }
    
    // Reset cleanup timer
    this.resetCleanupTimer(id);
    
    return doc;
  }
  
  private resetCleanupTimer(id: string) {
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    
    const timer = setTimeout(() => {
      this.cleanup(id);
    }, 5 * 60 * 1000); // 5 minutes
    
    this.timers.set(id, timer);
  }
  
  private cleanup(id: string) {
    const doc = this.docs.get(id);
    if (doc) {
      doc.destroy();
      this.docs.delete(id);
      this.timers.delete(id);
    }
  }
}
```

## Testing Patterns

### Pattern: Mock Y.Doc for tests
```typescript
export function createMockYDoc(content: any): Y.Doc {
  const doc = new Y.Doc();
  const xmlFragment = doc.getXmlFragment('default');
  
  // Build Y.Doc from JSON
  if (content.type === 'doc' && content.content) {
    content.content.forEach((node: any) => {
      const element = createYjsElement(doc, node);
      xmlFragment.push([element]);
    });
  }
  
  return doc;
}
```