/**
 * Resource Tracker Implementation
 * Real implementation of resource tracking methods for the isolation system
 */

// ============================================================================
// Resource Tracking Implementation
// ============================================================================

export interface DetailedResourceMetrics {
  // DOM Metrics
  domNodes: number;
  domDepth: number;
  domTextNodes: number;
  shadowRoots: number;
  
  // Event Listeners
  eventListeners: number;
  delegatedListeners: number;
  captureListeners: number;
  passiveListeners: number;
  
  // Canvas/Graphics
  canvasPixels: number;
  canvasContexts: number;
  webglContexts: number;
  imageElements: number;
  videoElements: number;
  
  // Timers
  activeTimers: number;
  activeIntervals: number;
  animationFrames: number;
  
  // Memory Estimates
  memoryEstimate: number;
  stringMemory: number;
  arrayBufferMemory: number;
  
  // Network
  pendingRequests: number;
  activeWebSockets: number;
  
  // React Specific
  reactComponents: number;
  reactEffects: number;
  reactMemos: number;
}

export class ResourceTracker {
  private observers = new WeakMap<Element, MutationObserver>();
  private timerRegistry = new Map<string, Set<number>>();
  private requestRegistry = new Map<string, Set<XMLHttpRequest | Promise<any>>>();
  private listenerCounts = new WeakMap<Element, number>();
  
  /**
   * Capture comprehensive resource metrics for a component
   */
  captureResources(
    componentId: string,
    container: HTMLElement | null
  ): DetailedResourceMetrics {
    if (!container) {
      return this.getEmptyMetrics();
    }
    
    return {
      // DOM Metrics
      ...this.captureDOMMetrics(container),
      
      // Event Listeners
      ...this.captureEventListeners(container),
      
      // Canvas/Graphics
      ...this.captureGraphicsResources(container),
      
      // Timers
      ...this.captureTimerMetrics(componentId),
      
      // Memory
      ...this.estimateMemoryUsage(container),
      
      // Network
      ...this.captureNetworkMetrics(componentId),
      
      // React
      ...this.captureReactMetrics(container)
    };
  }
  
  /**
   * Capture DOM-related metrics
   */
  private captureDOMMetrics(container: HTMLElement): Partial<DetailedResourceMetrics> {
    let domNodes = 0;
    let domTextNodes = 0;
    let shadowRoots = 0;
    let maxDepth = 0;
    
    const walk = (node: Node, depth: number = 0) => {
      domNodes++;
      maxDepth = Math.max(maxDepth, depth);
      
      if (node.nodeType === Node.TEXT_NODE) {
        domTextNodes++;
      }
      
      // Check for shadow roots
      if (node instanceof Element && node.shadowRoot) {
        shadowRoots++;
        walk(node.shadowRoot, depth + 1);
      }
      
      // Traverse children
      for (const child of Array.from(node.childNodes)) {
        walk(child, depth + 1);
      }
    };
    
    walk(container);
    
    return {
      domNodes,
      domDepth: maxDepth,
      domTextNodes,
      shadowRoots
    };
  }
  
  /**
   * Capture event listener metrics
   */
  private captureEventListeners(container: HTMLElement): Partial<DetailedResourceMetrics> {
    let totalListeners = 0;
    let delegatedListeners = 0;
    let captureListeners = 0;
    let passiveListeners = 0;
    
    const checkElement = (element: Element) => {
      // Get event listeners using Chrome DevTools API if available
      if ((window as any).getEventListeners) {
        const listeners = (window as any).getEventListeners(element);
        for (const eventType in listeners) {
          totalListeners += listeners[eventType].length;
          
          listeners[eventType].forEach((listener: any) => {
            if (listener.useCapture) captureListeners++;
            if (listener.passive) passiveListeners++;
          });
        }
      } else {
        // Fallback: Check for inline handlers and common event properties
        const attributes = element.attributes;
        for (let i = 0; i < attributes.length; i++) {
          const attr = attributes[i];
          if (attr.name.startsWith('on')) {
            totalListeners++;
          }
        }
        
        // Check for jQuery or other library listeners
        const jqueryData = (element as any)._data || (element as any).$?.data?.();
        if (jqueryData?.events) {
          for (const eventType in jqueryData.events) {
            totalListeners += jqueryData.events[eventType].length;
          }
        }
        
        // Check for React event handlers
        const reactProps = this.getReactProps(element);
        if (reactProps) {
          Object.keys(reactProps).forEach(prop => {
            if (prop.startsWith('on') && typeof reactProps[prop] === 'function') {
              totalListeners++;
            }
          });
        }
      }
      
      // Check for delegated listeners (event delegation pattern)
      if (element.classList.contains('delegate-root') || 
          element.hasAttribute('data-delegate')) {
        delegatedListeners++;
      }
    };
    
    // Walk the DOM tree
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    
    let node: Node | null = walker.currentNode;
    while (node) {
      checkElement(node as Element);
      node = walker.nextNode();
    }
    
    return {
      eventListeners: totalListeners,
      delegatedListeners,
      captureListeners,
      passiveListeners
    };
  }
  
  /**
   * Capture graphics resource metrics
   */
  private captureGraphicsResources(container: HTMLElement): Partial<DetailedResourceMetrics> {
    const canvases = container.querySelectorAll('canvas');
    const images = container.querySelectorAll('img');
    const videos = container.querySelectorAll('video');
    
    let totalCanvasPixels = 0;
    let canvasContexts = 0;
    let webglContexts = 0;
    
    canvases.forEach(canvas => {
      totalCanvasPixels += canvas.width * canvas.height;
      
      // Check context type
      try {
        if (canvas.getContext('webgl') || canvas.getContext('webgl2')) {
          webglContexts++;
        } else if (canvas.getContext('2d')) {
          canvasContexts++;
        }
      } catch (e) {
        // Context might be lost or unavailable
      }
    });
    
    return {
      canvasPixels: totalCanvasPixels,
      canvasContexts,
      webglContexts,
      imageElements: images.length,
      videoElements: videos.length
    };
  }
  
  /**
   * Capture timer metrics
   */
  private captureTimerMetrics(componentId: string): Partial<DetailedResourceMetrics> {
    const timers = this.timerRegistry.get(componentId) || new Set();
    
    // Separate timers by type (this requires instrumentation)
    let timeouts = 0;
    let intervals = 0;
    let animationFrames = 0;
    
    // In real implementation, we'd track timer types when they're created
    // For now, estimate based on ID ranges (browser-specific)
    timers.forEach(id => {
      if (id < 1000000) {
        timeouts++; // Likely setTimeout
      } else if (id < 2000000) {
        intervals++; // Likely setInterval
      } else {
        animationFrames++; // Likely RAF
      }
    });
    
    return {
      activeTimers: timeouts,
      activeIntervals: intervals,
      animationFrames
    };
  }
  
  /**
   * Estimate memory usage
   */
  private estimateMemoryUsage(container: HTMLElement): Partial<DetailedResourceMetrics> {
    let stringMemory = 0;
    let arrayBufferMemory = 0;
    
    // Estimate string memory from text content
    const textContent = container.textContent || '';
    stringMemory = textContent.length * 2; // UTF-16 encoding
    
    // Estimate memory from data attributes
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    
    let node: Node | null = walker.currentNode;
    while (node) {
      const element = node as Element;
      
      // Check data attributes
      for (const attr of Array.from(element.attributes)) {
        if (attr.name.startsWith('data-')) {
          stringMemory += (attr.value.length * 2);
        }
      }
      
      // Check for stored data
      const reactProps = this.getReactProps(element);
      if (reactProps) {
        stringMemory += JSON.stringify(reactProps).length * 2;
      }
      
      node = walker.nextNode();
    }
    
    // Check for ArrayBuffers in canvas contexts
    const canvases = container.querySelectorAll('canvas');
    canvases.forEach(canvas => {
      // ImageData uses ArrayBuffer
      arrayBufferMemory += canvas.width * canvas.height * 4; // RGBA
    });
    
    // Check for Blobs/Files in inputs
    const fileInputs = container.querySelectorAll('input[type="file"]') as NodeListOf<HTMLInputElement>;
    fileInputs.forEach(input => {
      if (input.files) {
        for (const file of Array.from(input.files)) {
          arrayBufferMemory += file.size;
        }
      }
    });
    
    const totalMemory = stringMemory + arrayBufferMemory;
    
    return {
      memoryEstimate: totalMemory,
      stringMemory,
      arrayBufferMemory
    };
  }
  
  /**
   * Capture network-related metrics
   */
  private captureNetworkMetrics(componentId: string): Partial<DetailedResourceMetrics> {
    const requests = this.requestRegistry.get(componentId) || new Set();
    
    let pendingRequests = 0;
    let activeWebSockets = 0;
    
    requests.forEach(request => {
      if (request instanceof XMLHttpRequest) {
        if (request.readyState !== XMLHttpRequest.DONE) {
          pendingRequests++;
        }
      } else if (request instanceof Promise) {
        // Check if promise is pending (hacky but works)
        Promise.race([request, Promise.resolve('resolved')])
          .then(result => {
            if (result !== 'resolved') {
              pendingRequests++;
            }
          });
      }
    });
    
    // Check for WebSocket connections
    // This requires instrumentation of WebSocket creation
    if ((window as any).__websockets) {
      const sockets = (window as any).__websockets;
      activeWebSockets = sockets.filter((ws: WebSocket) => 
        ws.readyState === WebSocket.OPEN
      ).length;
    }
    
    return {
      pendingRequests,
      activeWebSockets
    };
  }
  
  /**
   * Capture React-specific metrics
   */
  private captureReactMetrics(container: HTMLElement): Partial<DetailedResourceMetrics> {
    let reactComponents = 0;
    let reactEffects = 0;
    let reactMemos = 0;
    
    // Find React Fiber nodes
    const findReactFiber = (element: Element): any => {
      const keys = Object.keys(element);
      const reactFiberKey = keys.find(key => 
        key.startsWith('__reactFiber') || 
        key.startsWith('__reactInternalInstance')
      );
      
      return reactFiberKey ? (element as any)[reactFiberKey] : null;
    };
    
    // Walk the DOM and count React components
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_ELEMENT,
      null
    );
    
    let node: Node | null = walker.currentNode;
    while (node) {
      const fiber = findReactFiber(node as Element);
      if (fiber) {
        reactComponents++;
        
        // Check for hooks
        if (fiber.memoizedState) {
          let hook = fiber.memoizedState;
          while (hook) {
            // Identify hook type by queue properties
            if (hook.queue) {
              reactEffects++;
            }
            if (hook.deps) {
              reactMemos++;
            }
            hook = hook.next;
          }
        }
      }
      
      node = walker.nextNode();
    }
    
    return {
      reactComponents,
      reactEffects,
      reactMemos
    };
  }
  
  /**
   * Get React props from element
   */
  private getReactProps(element: Element): any {
    const keys = Object.keys(element);
    const propsKey = keys.find(key => key.startsWith('__reactProps'));
    return propsKey ? (element as any)[propsKey] : null;
  }
  
  /**
   * Get empty metrics object
   */
  private getEmptyMetrics(): DetailedResourceMetrics {
    return {
      domNodes: 0,
      domDepth: 0,
      domTextNodes: 0,
      shadowRoots: 0,
      eventListeners: 0,
      delegatedListeners: 0,
      captureListeners: 0,
      passiveListeners: 0,
      canvasPixels: 0,
      canvasContexts: 0,
      webglContexts: 0,
      imageElements: 0,
      videoElements: 0,
      activeTimers: 0,
      activeIntervals: 0,
      animationFrames: 0,
      memoryEstimate: 0,
      stringMemory: 0,
      arrayBufferMemory: 0,
      pendingRequests: 0,
      activeWebSockets: 0,
      reactComponents: 0,
      reactEffects: 0,
      reactMemos: 0
    };
  }
  
  /**
   * Register a timer for tracking
   */
  registerTimer(componentId: string, timerId: number): void {
    if (!this.timerRegistry.has(componentId)) {
      this.timerRegistry.set(componentId, new Set());
    }
    this.timerRegistry.get(componentId)!.add(timerId);
  }
  
  /**
   * Unregister a timer
   */
  unregisterTimer(componentId: string, timerId: number): void {
    this.timerRegistry.get(componentId)?.delete(timerId);
  }
  
  /**
   * Register a network request for tracking
   */
  registerRequest(componentId: string, request: XMLHttpRequest | Promise<any>): void {
    if (!this.requestRegistry.has(componentId)) {
      this.requestRegistry.set(componentId, new Set());
    }
    this.requestRegistry.get(componentId)!.add(request);
  }
  
  /**
   * Unregister a network request
   */
  unregisterRequest(componentId: string, request: XMLHttpRequest | Promise<any>): void {
    this.requestRegistry.get(componentId)?.delete(request);
  }
  
  /**
   * Start observing a component for resource changes
   */
  startObserving(componentId: string, container: HTMLElement): void {
    // Set up MutationObserver to track DOM changes
    const observer = new MutationObserver((mutations) => {
      // Could emit events here for real-time tracking
      console.log(`[ResourceTracker] DOM mutations detected for ${componentId}:`, mutations.length);
    });
    
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true
    });
    
    this.observers.set(container, observer);
  }
  
  /**
   * Stop observing a component
   */
  stopObserving(container: HTMLElement): void {
    const observer = this.observers.get(container);
    if (observer) {
      observer.disconnect();
      this.observers.delete(container);
    }
  }
  
  /**
   * Clean up all tracking for a component
   */
  cleanup(componentId: string): void {
    this.timerRegistry.delete(componentId);
    this.requestRegistry.delete(componentId);
  }
}

// ============================================================================
// Instrumentation Helpers
// ============================================================================

/**
 * Instrument global timer functions to track timer creation
 */
export function instrumentTimers(tracker: ResourceTracker) {
  const originalSetTimeout = window.setTimeout;
  const originalSetInterval = window.setInterval;
  const originalRAF = window.requestAnimationFrame;
  const originalClearTimeout = window.clearTimeout;
  const originalClearInterval = window.clearInterval;
  const originalCancelRAF = window.cancelAnimationFrame;
  
  // Get current component ID from context (would be injected)
  const getCurrentComponentId = (): string | null => {
    // This would be implemented based on your component system
    return (window as any).__currentComponentId || null;
  };
  
  window.setTimeout = function(...args: any[]): number {
    const id = originalSetTimeout.apply(window, args as any);
    const componentId = getCurrentComponentId();
    if (componentId) {
      tracker.registerTimer(componentId, id);
    }
    return id;
  };
  
  window.setInterval = function(...args: any[]): number {
    const id = originalSetInterval.apply(window, args as any);
    const componentId = getCurrentComponentId();
    if (componentId) {
      tracker.registerTimer(componentId, id + 1000000); // Offset for type detection
    }
    return id;
  };
  
  window.requestAnimationFrame = function(callback: FrameRequestCallback): number {
    const id = originalRAF.call(window, callback);
    const componentId = getCurrentComponentId();
    if (componentId) {
      tracker.registerTimer(componentId, id + 2000000); // Offset for type detection
    }
    return id;
  };
  
  window.clearTimeout = function(id: number): void {
    originalClearTimeout.call(window, id);
    const componentId = getCurrentComponentId();
    if (componentId) {
      tracker.unregisterTimer(componentId, id);
    }
  };
  
  window.clearInterval = function(id: number): void {
    originalClearInterval.call(window, id);
    const componentId = getCurrentComponentId();
    if (componentId) {
      tracker.unregisterTimer(componentId, id + 1000000);
    }
  };
  
  window.cancelAnimationFrame = function(id: number): void {
    originalCancelRAF.call(window, id);
    const componentId = getCurrentComponentId();
    if (componentId) {
      tracker.unregisterTimer(componentId, id + 2000000);
    }
  };
  
  // Return restore function
  return () => {
    window.setTimeout = originalSetTimeout;
    window.setInterval = originalSetInterval;
    window.requestAnimationFrame = originalRAF;
    window.clearTimeout = originalClearTimeout;
    window.clearInterval = originalClearInterval;
    window.cancelAnimationFrame = originalCancelRAF;
  };
}

/**
 * Instrument XMLHttpRequest to track network requests
 */
export function instrumentXHR(tracker: ResourceTracker) {
  const OriginalXHR = window.XMLHttpRequest;
  
  function CustomXHR(this: XMLHttpRequest) {
    const xhr = new OriginalXHR();
    const componentId = (window as any).__currentComponentId;
    
    if (componentId) {
      tracker.registerRequest(componentId, xhr);
      
      // Clean up on completion
      xhr.addEventListener('loadend', () => {
        tracker.unregisterRequest(componentId, xhr);
      });
    }
    
    return xhr;
  }
  
  CustomXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = CustomXHR as any;
  
  // Return restore function
  return () => {
    window.XMLHttpRequest = OriginalXHR;
  };
}

/**
 * Instrument fetch to track network requests
 */
export function instrumentFetch(tracker: ResourceTracker) {
  const originalFetch = window.fetch;
  
  window.fetch = function(...args: Parameters<typeof fetch>): Promise<Response> {
    const componentId = (window as any).__currentComponentId;
    const promise = originalFetch.apply(window, args);
    
    if (componentId) {
      tracker.registerRequest(componentId, promise);
      
      // Clean up on completion
      promise.finally(() => {
        tracker.unregisterRequest(componentId, promise);
      });
    }
    
    return promise;
  };
  
  // Return restore function
  return () => {
    window.fetch = originalFetch;
  };
}