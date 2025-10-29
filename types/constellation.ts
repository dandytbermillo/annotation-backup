export interface ConstellationItem {
  id: string;
  title: string;
  type: ItemType;
  importance: number;
  angle: number;
  distance: number;
  constellation?: string;
  x?: number;
  y?: number;
  color?: string;
  content?: string;
  tags?: string[];
  isCenter?: boolean;
  icon?: string;
  depthLayer?: number;
  isExpanded?: boolean;
  isFocused?: boolean;
  originalPosition?: { x: number; y: number };
  targetPosition?: { x: number; y: number };
  animationProgress?: number;
  children?: ConstellationItem[];
  parentId?: string;
  isFolder?: boolean;
  folderPath?: string;

  // New properties for hierarchical depth system
  hierarchyLevel?: number;        // 0 for root, 1 for children, 2 for grandchildren, etc.
  ancestorIds?: string[];         // Array of all ancestor IDs for tracking hierarchy
  isRootFolder?: boolean;         // Flag for root-level folders
  absoluteDepthLayer?: number;    // Calculated absolute depth in the scene

  // Overflow node properties (for "+N more" nodes)
  isOverflowNode?: boolean;       // Flag indicating this is an overflow/more node
  overflowParentId?: string;      // ID of the parent folder with overflow
  allChildren?: ConstellationItem[]; // All children of the parent (including hidden ones)
}

export interface Constellation {
  id: string;
  name: string;
  icon: string;
  color: string;
  centerX: number;
  centerY: number;
  items: ConstellationItem[];
  isExpanded?: boolean;
  depthLayer?: number;
}

export interface AppState {
  // View state
  rotation: { x: number; y: number };
  pan: { x: number; y: number };
  zoom: number;
  centerX: number;
  centerY: number;

  // Interaction state
  isDragging: boolean;
  dragMode: 'rotate' | 'pan' | 'node';
  draggedNode: string | null;
  lastMousePos: { x: number; y: number };
  clickedNodeForExpansion: string | null;

  // UI state
  showConnections: boolean;
  showLabels: boolean;
  showHint: boolean;
  hintText: string;
  isShiftPressed: boolean;
  depthAnimationActive: boolean;
  maxDepthLayers: number;

  // Panel visibility state
  showWelcomePanel: boolean;
  showSidebar: boolean;
  showStatusPanel: boolean;
  showDebugPanel: boolean;
  showSearchControls: boolean;

  // Selection and filtering
  selectedItem: ConstellationItem | null;
  hoveredItem: ConstellationItem | null;
  highlightedConstellation: string | null;
  searchQuery: string;
  filterType: ItemType | 'all';

  // Group selection for folders (UI state only, logic handled by state machine)
  selectedGroupItems: Set<string>;
  groupParentId: string | null;

  // Node positioning
  nodePositions: Record<string, Position>;

  // Depth system
  expandedConstellations: Set<string>;
  focusedItems: Set<string>;

  // Constellation focus system - enhanced for progressive focusing
  focusedConstellation: string | null;
  constellationDepthOffsets: Record<string, number>;
  constellationFocusLevels: Record<string, number>;
  focusTransitionActive: boolean;
  maxFocusLevel: number;

  // Gravity Core Control System
  globalDepthOffset: number;
  gravityCorePosition: { x: number; y: number };
  isDraggingGravityCore: boolean;
  gravityCoreVisible: boolean;
  gravityCoreLocked: boolean;

  // Smart Connection Controls
  connectionFocusMode: boolean;
  hiddenConnectionTypes: Set<string>;
  minConnectionStrength: number;
  enableConnectionBundling: boolean;

  // Edge scrolling state
  isEdgeScrolling: boolean;
  edgeScrollDirection: { x: number; y: number };
  edgeScrollSpeed: number;
  edgeScrollAcceleration: number;
}

export type ItemType =
  | 'document'
  | 'note'
  | 'presentation'
  | 'spreadsheet'
  | 'email'
  | 'media'
  | 'receipt'
  | 'chat'
  | 'event'
  | 'constellation'
  | 'folder';

export interface Position {
  x: number;
  y: number;
}

export interface Connection {
  from: string;
  to: string;
}

export type NotificationType = 'success' | 'info' | 'warning' | 'error';

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number;
}
