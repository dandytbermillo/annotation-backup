// Debug logging utilities for constellation
export function logConstellationFocus(...args: any[]) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[ConstellationFocus]', ...args);
  }
}

export function logDepthCalculation(...args: any[]) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[DepthCalc]', ...args);
  }
}

export function logDoubleClick(...args: any[]) {
  if (process.env.NODE_ENV === 'development') {
    console.log('[DoubleClick]', ...args);
  }
}
