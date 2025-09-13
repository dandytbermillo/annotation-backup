# UI Components Specification

## Layer Control Components

### 1. Layer Switcher
Visual indicator and control for active layer.

```tsx
interface LayerSwitcherProps {
  activeLayer: 'notes' | 'popups'
  popupCount: number
  onSwitch: (layer: LayerId) => void
}

const LayerSwitcher: React.FC<LayerSwitcherProps> = ({ 
  activeLayer, 
  popupCount, 
  onSwitch 
}) => {
  return (
    <div className="fixed top-4 left-80 z-50 flex bg-gray-800 rounded-lg p-1">
      <button
        onClick={() => onSwitch('notes')}
        className={`px-4 py-2 rounded transition-all ${
          activeLayer === 'notes' 
            ? 'bg-blue-600 text-white' 
            : 'text-gray-400 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2">
          <FileText size={16} />
          <span>Notes</span>
        </div>
      </button>
      
      <button
        onClick={() => onSwitch('popups')}
        className={`px-4 py-2 rounded transition-all ${
          activeLayer === 'popups' 
            ? 'bg-blue-600 text-white' 
            : 'text-gray-400 hover:text-white'
        }`}
      >
        <div className="flex items-center gap-2">
          <Folder size={16} />
          <span>Popups</span>
          {popupCount > 0 && (
            <span className="bg-gray-700 px-1.5 py-0.5 rounded text-xs">
              {popupCount}
            </span>
          )}
        </div>
      </button>
    </div>
  )
}
```

### 2. Layer Controls Panel
Sidebar section for layer management.

```tsx
const LayerControlsPanel: React.FC = () => {
  const { canvasState, updateCanvasState } = useCanvas()
  
  return (
    <div className="p-4 border-t border-gray-700">
      <h3 className="text-sm font-semibold text-gray-400 mb-3">
        LAYER CONTROLS
      </h3>
      
      {/* Visibility Toggles */}
      <div className="space-y-2 mb-4">
        <ToggleRow
          icon={<Eye size={16} />}
          label="Show Popups"
          checked={canvasState.layers.get('popups').visible}
          onChange={(checked) => toggleLayerVisibility('popups', checked)}
          badge={hoverPopovers.size}
        />
        
        <ToggleRow
          icon={<Link size={16} />}
          label="Sync Pan"
          checked={canvasState.syncPan}
          onChange={(checked) => updateCanvasState({ syncPan: checked })}
        />
        
        <ToggleRow
          icon={<Maximize size={16} />}
          label="Sync Zoom"
          checked={canvasState.syncZoom}
          onChange={(checked) => updateCanvasState({ syncZoom: checked })}
        />
      </div>
      
      {/* Opacity Slider */}
      <div className="mb-4">
        <label className="text-xs text-gray-400 mb-1 block">
          Popup Opacity
        </label>
        <input
          type="range"
          min="20"
          max="100"
          value={canvasState.layers.get('popups').opacity * 100}
          onChange={(e) => setLayerOpacity('popups', Number(e.target.value) / 100)}
          className="w-full"
        />
      </div>
      
      {/* Action Buttons */}
      <div className="space-y-2">
        <button
          onClick={resetView}
          className="w-full px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm flex items-center justify-center gap-2"
        >
          <RotateCcw size={14} />
          Reset View
        </button>
        
        <button
          onClick={clearAllPopups}
          className="w-full px-3 py-2 bg-red-900 hover:bg-red-800 rounded text-sm flex items-center justify-center gap-2"
          disabled={hoverPopovers.size === 0}
        >
          <X size={14} />
          Clear Popups ({hoverPopovers.size})
        </button>
      </div>
    </div>
  )
}
```

### 3. Toast Notification System
Non-intrusive feedback messages.

```tsx
interface ToastProps {
  message: string
  type?: 'info' | 'success' | 'warning' | 'error'
  duration?: number
  position?: 'top-right' | 'bottom-right' | 'bottom-center'
}

const Toast: React.FC<ToastProps> = ({ 
  message, 
  type = 'info', 
  duration = 2000,
  position = 'bottom-right' 
}) => {
  const [isVisible, setIsVisible] = useState(true)
  const [isLeaving, setIsLeaving] = useState(false)
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLeaving(true)
      setTimeout(() => setIsVisible(false), 300)
    }, duration)
    
    return () => clearTimeout(timer)
  }, [duration])
  
  if (!isVisible) return null
  
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2'
  }
  
  const typeClasses = {
    info: 'bg-gray-800 text-white',
    success: 'bg-green-600 text-white',
    warning: 'bg-yellow-600 text-white',
    error: 'bg-red-600 text-white'
  }
  
  return (
    <div
      className={`
        fixed z-50 px-4 py-3 rounded-lg shadow-lg
        ${positionClasses[position]}
        ${typeClasses[type]}
        ${isLeaving ? 'animate-slide-out' : 'animate-slide-in'}
      `}
    >
      <div className="flex items-center gap-2">
        {type === 'success' && <Check size={16} />}
        {type === 'warning' && <AlertTriangle size={16} />}
        {type === 'error' && <X size={16} />}
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  )
}
```

### 4. Keyboard Shortcuts Display
Visual guide for available shortcuts.

```tsx
const KeyboardShortcutsPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  
  const shortcuts = [
    { key: 'Tab', action: 'Switch layers' },
    { key: 'Esc', action: 'Return to notes' },
    { key: '⌘1', action: 'Focus notes layer' },
    { key: '⌘2', action: 'Focus popup layer' },
    { key: '⌘B', action: 'Toggle sidebar' },
    { key: 'Alt+Drag', action: 'Pan popups only' },
    { key: 'Space+Drag', action: 'Pan active layer' },
    { key: '⌘0', action: 'Reset view' }
  ]
  
  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 left-4 p-2 bg-gray-800 rounded-lg hover:bg-gray-700"
        title="Keyboard shortcuts"
      >
        <Keyboard size={20} />
      </button>
      
      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-700 rounded"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-2">
              {shortcuts.map(({ key, action }) => (
                <div key={key} className="flex justify-between items-center py-2">
                  <span className="text-gray-400">{action}</span>
                  <kbd className="px-2 py-1 bg-gray-700 rounded text-sm font-mono">
                    {key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

### 5. Layer Indicator Badge
Floating indicator showing current active layer.

```tsx
const LayerIndicatorBadge: React.FC = () => {
  const { activeLayer, popupCount } = useCanvas()
  const [isAnimating, setIsAnimating] = useState(false)
  
  useEffect(() => {
    setIsAnimating(true)
    const timer = setTimeout(() => setIsAnimating(false), 300)
    return () => clearTimeout(timer)
  }, [activeLayer])
  
  return (
    <div
      className={`
        fixed top-20 left-80 z-40
        px-3 py-1.5 bg-blue-600 text-white rounded-full
        text-xs font-medium
        transition-all duration-300
        ${isAnimating ? 'scale-110' : 'scale-100'}
      `}
    >
      <div className="flex items-center gap-2">
        {activeLayer === 'notes' ? (
          <>
            <FileText size={14} />
            <span>Notes Canvas</span>
          </>
        ) : (
          <>
            <Folder size={14} />
            <span>Popup Layer</span>
            {popupCount > 0 && (
              <span className="bg-blue-700 px-1.5 rounded-full">
                {popupCount}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
```

### 6. Performance Monitor Widget
Shows FPS and performance metrics.

```tsx
const PerformanceWidget: React.FC = () => {
  const [stats, setStats] = useState({ fps: 60, frameTime: '0', isOptimized: false })
  const [isExpanded, setIsExpanded] = useState(false)
  
  useEffect(() => {
    const interval = setInterval(() => {
      setStats(performanceMonitor.getStats())
    }, 100)
    
    return () => clearInterval(interval)
  }, [])
  
  const fpsColor = stats.fps >= 50 ? 'text-green-400' : 
                   stats.fps >= 30 ? 'text-yellow-400' : 'text-red-400'
  
  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 rounded-lg p-2 text-xs">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2"
      >
        <Activity size={14} className={fpsColor} />
        <span className={fpsColor}>{stats.fps} FPS</span>
        <ChevronUp 
          size={14} 
          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      
      {isExpanded && (
        <div className="mt-2 pt-2 border-t border-gray-700 space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-400">Frame Time:</span>
            <span>{stats.frameTime}ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Optimized:</span>
            <span>{stats.isOptimized ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Popups:</span>
            <span>{hoverPopovers.size}</span>
          </div>
        </div>
      )}
    </div>
  )
}
```

## CSS Animations

```css
/* animations.css */

@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes slide-out {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(10px);
  }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.animate-slide-in {
  animation: slide-in 0.3s ease-out forwards;
}

.animate-slide-out {
  animation: slide-out 0.3s ease-in forwards;
}

.animate-fade-in {
  animation: fade-in 0.3s ease-in forwards;
}

.animate-fade-out {
  animation: fade-out 0.3s ease-out forwards;
}

.animate-pulse {
  animation: pulse 2s ease-in-out infinite;
}

/* Layer transition effects */
.layer-transition {
  transition: opacity 0.3s ease, filter 0.3s ease, transform 0.3s ease;
}

.layer-active {
  opacity: 1;
  filter: none;
  pointer-events: auto;
}

.layer-inactive {
  opacity: 0.6;
  filter: brightness(0.8);
  pointer-events: none;
}

/* Smooth pan and zoom */
.canvas-transform {
  transition: transform 0.1s ease-out;
}

/* Toast animations */
.toast-enter {
  animation: slide-in 0.3s ease-out forwards;
}

.toast-exit {
  animation: slide-out 0.3s ease-in forwards;
}
```

---

*Document Version: 1.0*  
*UI Specification Complete*  
*Ready for Component Implementation*