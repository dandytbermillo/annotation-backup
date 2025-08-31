/**
 * Electron IPC Bridge for Offline Status
 * Phase 2: OFF-P2-FE-006
 */

import { networkService, NetworkStatus } from './network-service';
import { swManager } from './service-worker-manager';

declare global {
  interface Window {
    electronAPI?: {
      sendOfflineStatus: (status: any) => void;
      onOfflineStatusRequest: (callback: () => void) => void;
      sendQueueStatus: (status: any) => void;
      onSyncRequest: (callback: () => void) => void;
    };
  }
}

class ElectronIPCBridge {
  private isElectron = false;
  private statusUpdateInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize IPC bridge
   */
  init(): void {
    // Check if running in Electron
    this.isElectron = typeof window !== 'undefined' && 
                      window.electronAPI !== undefined;

    if (!this.isElectron) {
      console.log('[IPCBridge] Not running in Electron environment');
      return;
    }

    console.log('[IPCBridge] Initializing Electron IPC bridge');

    // Set up listeners
    this.setupListeners();

    // Start sending periodic status updates
    this.startStatusUpdates();
  }

  /**
   * Set up IPC listeners
   */
  private setupListeners(): void {
    if (!window.electronAPI) return;

    // Listen for status requests from main process
    window.electronAPI.onOfflineStatusRequest(() => {
      this.sendCurrentStatus();
    });

    // Listen for sync requests
    window.electronAPI.onSyncRequest(async () => {
      await swManager.triggerSync();
      this.sendQueueStatus();
    });

    // Listen for network status changes
    networkService.onStatusChange((status) => {
      this.sendNetworkStatus(status);
    });

    // Listen for SW messages
    swManager.onMessage('write-queued', () => {
      this.sendQueueStatus();
    });

    swManager.onMessage('write-completed', () => {
      this.sendQueueStatus();
    });

    swManager.onMessage('write-failed', () => {
      this.sendQueueStatus();
    });
  }

  /**
   * Start periodic status updates
   */
  private startStatusUpdates(): void {
    // Send status every 10 seconds
    this.statusUpdateInterval = setInterval(() => {
      this.sendCurrentStatus();
    }, 10000);

    // Send initial status
    this.sendCurrentStatus();
  }

  /**
   * Send current status to main process
   */
  private async sendCurrentStatus(): Promise<void> {
    const networkStatus = networkService.getStatus();
    const queueStatus = await swManager.getQueueStatus();

    this.sendNetworkStatus(networkStatus);
    if (queueStatus) {
      this.sendQueueStatus(queueStatus);
    }
  }

  /**
   * Send network status to main process
   */
  private sendNetworkStatus(status: NetworkStatus): void {
    if (!window.electronAPI?.sendOfflineStatus) return;

    window.electronAPI.sendOfflineStatus({
      type: 'network-status',
      isOnline: status.isOnline,
      quality: status.quality,
      circuitState: status.circuitState,
      rtt: status.rtt,
      lastProbeTime: status.lastProbeTime,
      lastSyncTime: status.lastSyncTime,
    });
  }

  /**
   * Send queue status to main process
   */
  private async sendQueueStatus(status?: any): Promise<void> {
    if (!window.electronAPI?.sendQueueStatus) return;

    const queueStatus = status || await swManager.getQueueStatus();
    
    if (queueStatus) {
      window.electronAPI.sendQueueStatus({
        type: 'queue-status',
        queueLength: queueStatus.queueLength,
        hasPending: queueStatus.queueLength > 0,
      });
    }
  }

  /**
   * Stop status updates
   */
  stop(): void {
    if (this.statusUpdateInterval) {
      clearInterval(this.statusUpdateInterval);
      this.statusUpdateInterval = null;
    }
  }
}

// Singleton instance
let ipcBridgeInstance: ElectronIPCBridge | null = null;

/**
 * Get IPC bridge instance
 */
export function getElectronIPCBridge(): ElectronIPCBridge {
  if (!ipcBridgeInstance) {
    ipcBridgeInstance = new ElectronIPCBridge();
  }
  return ipcBridgeInstance;
}

// Export convenience functions
export const electronIPCBridge = {
  init: () => getElectronIPCBridge().init(),
  stop: () => getElectronIPCBridge().stop(),
};