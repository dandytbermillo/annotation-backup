export const DEFAULT_POPUP_WIDTH = 300
export const DEFAULT_POPUP_HEIGHT = 400
export const MIN_POPUP_WIDTH = 200
export const MIN_POPUP_HEIGHT = 200
export const MAX_POPUP_WIDTH = 900
export const MAX_POPUP_HEIGHT = 900

export const IDENTITY_TRANSFORM = { x: 0, y: 0, scale: 1 } as const

export const AUTO_SCROLL_CONFIG = {
  ENABLED: process.env.NEXT_PUBLIC_DISABLE_AUTOSCROLL !== 'true',
  THRESHOLD: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_THRESHOLD || '80', 10),
  MIN_SPEED: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_MIN_SPEED || '5', 10),
  MAX_SPEED: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_MAX_SPEED || '15', 10),
  ACCELERATION: 'ease-out' as const,
  DEBUG: process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_AUTOSCROLL === 'true',
} as const

export const FOLDER_COLORS = [
  { name: 'red', bg: '#ef4444', text: '#fff', border: '#dc2626' },
  { name: 'orange', bg: '#f97316', text: '#fff', border: '#ea580c' },
  { name: 'yellow', bg: '#eab308', text: '#000', border: '#ca8a04' },
  { name: 'amber', bg: '#f59e0b', text: '#000', border: '#d97706' },
  { name: 'green', bg: '#22c55e', text: '#fff', border: '#16a34a' },
  { name: 'emerald', bg: '#10b981', text: '#fff', border: '#059669' },
  { name: 'blue', bg: '#3b82f6', text: '#fff', border: '#2563eb' },
  { name: 'indigo', bg: '#6366f1', text: '#fff', border: '#4f46e5' },
  { name: 'purple', bg: '#a855f7', text: '#fff', border: '#9333ea' },
  { name: 'pink', bg: '#ec4899', text: '#fff', border: '#db2777' },
]
