'use client';

import React, { useState, useEffect, useCallback, createContext, useContext, useRef } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export type WorkspaceToastType = 'success' | 'info' | 'warning' | 'error';

export interface WorkspaceToastMessage {
  id: string;
  message: string;
  type: WorkspaceToastType;
  duration?: number;
  visible: boolean;
}

interface WorkspaceToastContextValue {
  showToast: (message: string, type?: WorkspaceToastType, duration?: number) => void;
  // Convenience methods
  success: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
}

// ============================================================================
// CONTEXT
// ============================================================================

const WorkspaceToastContext = createContext<WorkspaceToastContextValue | null>(null);

export function useWorkspaceToast() {
  const context = useContext(WorkspaceToastContext);
  if (!context) {
    // Return no-op functions if used outside provider (graceful degradation)
    return {
      showToast: () => {},
      success: () => {},
      info: () => {},
      warning: () => {},
      error: () => {},
    };
  }
  return context;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_DURATION = 2500; // ms
const Z_INDEX_WORKSPACE_TOAST = 100001; // Above dock popovers (99998-99999)

const TYPE_STYLES: Record<WorkspaceToastType, { bg: string; border: string; icon: string }> = {
  success: {
    bg: 'rgba(34, 197, 94, 0.15)',
    border: 'rgba(34, 197, 94, 0.3)',
    icon: '✓',
  },
  info: {
    bg: 'rgba(99, 102, 241, 0.15)',
    border: 'rgba(99, 102, 241, 0.3)',
    icon: 'ℹ',
  },
  warning: {
    bg: 'rgba(234, 179, 8, 0.15)',
    border: 'rgba(234, 179, 8, 0.3)',
    icon: '⚠',
  },
  error: {
    bg: 'rgba(239, 68, 68, 0.15)',
    border: 'rgba(239, 68, 68, 0.3)',
    icon: '✕',
  },
};

// ============================================================================
// TOAST COMPONENT
// ============================================================================

function WorkspaceToastItem({
  toast,
  onDismiss
}: {
  toast: WorkspaceToastMessage;
  onDismiss: () => void;
}) {
  const styles = TYPE_STYLES[toast.type];
  const [isVisible, setIsVisible] = useState(false);

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 10);
    return () => clearTimeout(timer);
  }, []);

  // Auto-dismiss after duration
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      // Wait for animation to complete before removing
      setTimeout(onDismiss, 200);
    }, toast.duration || DEFAULT_DURATION);
    return () => clearTimeout(timer);
  }, [toast.duration, onDismiss]);

  const handleClick = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 200);
  };

  return (
    <div
      style={{
        background: styles.bg,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: `1px solid ${styles.border}`,
        borderRadius: 12,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.95)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        pointerEvents: 'auto',
      }}
      onClick={handleClick}
    >
      <span style={{ fontSize: 14 }}>{styles.icon}</span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.95)',
          whiteSpace: 'nowrap',
        }}
      >
        {toast.message}
      </span>
    </div>
  );
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

export function WorkspaceToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<WorkspaceToastMessage[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: WorkspaceToastType = 'info', duration?: number) => {
    const id = `toast-${++toastIdRef.current}`;
    const newToast: WorkspaceToastMessage = { id, message, type, duration, visible: true };

    setToasts(prev => {
      // Limit to 3 toasts max, remove oldest if needed
      const updated = [...prev, newToast];
      if (updated.length > 3) {
        return updated.slice(-3);
      }
      return updated;
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const contextValue: WorkspaceToastContextValue = {
    showToast,
    success: (message, duration) => showToast(message, 'success', duration),
    info: (message, duration) => showToast(message, 'info', duration),
    warning: (message, duration) => showToast(message, 'warning', duration),
    error: (message, duration) => showToast(message, 'error', duration),
  };

  return (
    <WorkspaceToastContext.Provider value={contextValue}>
      {children}

      {/* Toast Container - Positioned above dock */}
      <div
        style={{
          position: 'fixed',
          bottom: 100, // Above dock (dock is at bottom: 24px with ~76px height)
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: Z_INDEX_WORKSPACE_TOAST,
          display: 'flex',
          flexDirection: 'column-reverse',
          alignItems: 'center',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(toast => (
          <WorkspaceToastItem
            key={toast.id}
            toast={toast}
            onDismiss={() => dismissToast(toast.id)}
          />
        ))}
      </div>
    </WorkspaceToastContext.Provider>
  );
}

// ============================================================================
// GLOBAL TOAST API (for use outside React components)
// ============================================================================

let globalShowToast: WorkspaceToastContextValue['showToast'] | null = null;

export function setGlobalWorkspaceToast(showToast: WorkspaceToastContextValue['showToast']) {
  globalShowToast = showToast;
}

export function workspaceToast(message: string, type: WorkspaceToastType = 'info', duration?: number) {
  if (globalShowToast) {
    globalShowToast(message, type, duration);
  } else {
    console.warn('[WorkspaceToast] Provider not mounted, toast skipped:', message);
  }
}

// Convenience exports
workspaceToast.success = (message: string, duration?: number) => workspaceToast(message, 'success', duration);
workspaceToast.info = (message: string, duration?: number) => workspaceToast(message, 'info', duration);
workspaceToast.warning = (message: string, duration?: number) => workspaceToast(message, 'warning', duration);
workspaceToast.error = (message: string, duration?: number) => workspaceToast(message, 'error', duration);
