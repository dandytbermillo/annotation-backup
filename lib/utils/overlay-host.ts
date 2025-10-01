export const FLOATING_OVERLAY_HOST_ID = 'floating-notes-overlay-root'

export function ensureFloatingOverlayHost(): HTMLElement | null {
  if (typeof window === 'undefined') {
    return null
  }

  let host = document.getElementById(FLOATING_OVERLAY_HOST_ID) as HTMLElement | null
  if (!host) {
    host = document.createElement('div')
    host.id = FLOATING_OVERLAY_HOST_ID
    host.style.position = 'fixed'
    host.style.top = '0'
    host.style.left = '0'
    host.style.right = '0'
    host.style.bottom = '0'
    host.style.width = '100vw'
    host.style.height = '100vh'
    host.style.pointerEvents = 'none'
    host.style.zIndex = '20000'
    document.body.appendChild(host)
  }

  return host
}
