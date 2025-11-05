import { Transform } from '@/lib/utils/coordinate-bridge';

export const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scale: 1 } as const;
export const DEFAULT_POPUP_WIDTH = 300;
export const DEFAULT_POPUP_HEIGHT = 400;
export const MIN_POPUP_WIDTH = 200;
export const MIN_POPUP_HEIGHT = 200;
export const MAX_POPUP_WIDTH = 900;
export const MAX_POPUP_HEIGHT = 900;

export const AUTO_SCROLL_CONFIG = {
  ENABLED: process.env.NEXT_PUBLIC_DISABLE_AUTOSCROLL !== 'true',
  THRESHOLD: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_THRESHOLD || '80'),
  MIN_SPEED: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_MIN_SPEED || '5'),
  MAX_SPEED: parseInt(process.env.NEXT_PUBLIC_AUTOSCROLL_MAX_SPEED || '15'),
  ACCELERATION: 'ease-out' as const,
  DEBUG: process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEBUG_AUTOSCROLL === 'true',
} as const;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
