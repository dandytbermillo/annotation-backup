import { ConstellationItem, ItemType, Position, Constellation } from '@/types/constellation';

// Calculate child position based on parent position and child's angle/distance
export function calculateChildPosition(
  child: ConstellationItem,
  parent: ConstellationItem,
  parentPos: Position
): Position {
  // Calculate child position based on parent position and child's angle/distance
  const angleRad = (child.angle * Math.PI) / 180;
  const x = parentPos.x + Math.cos(angleRad) * child.distance;
  const y = parentPos.y + Math.sin(angleRad) * child.distance;

  return { x, y };
}

// Helper function to recursively process children and add them to allItems
function processChildrenRecursively(
  parentItem: ConstellationItem,
  parentPos: { x: number; y: number },
  constellation: Constellation,
  allItems: ConstellationItem[],
  depth: number = 0
) {
  if (!parentItem.children || parentItem.children.length === 0) {
    return;
  }

  const MAX_VISIBLE_CHILDREN = 10;
  const childrenToShow = parentItem.children.slice(0, MAX_VISIBLE_CHILDREN);
  const hasMoreChildren = parentItem.children.length > MAX_VISIBLE_CHILDREN;

  childrenToShow.forEach(child => {
    const childRadian = (child.angle * Math.PI) / 180;
    const childX = parentPos.x + Math.cos(childRadian) * child.distance;
    const childY = parentPos.y + Math.sin(childRadian) * child.distance;

    const inheritedDepth = child.depthLayer !== undefined
      ? child.depthLayer
      : (parentItem.depthLayer !== undefined ? parentItem.depthLayer + 1 : 3 + depth);

    const fullChild: ConstellationItem = {
      ...child,
      constellation: constellation.id,
      x: childX,
      y: childY,
      color: constellation.color,
      parentId: parentItem.id, // ✅ Set parent reference
      depthLayer: inheritedDepth, // Ensure nested children start at Layer 3+
      content: child.content || `This is a ${child.type} from ${parentItem.title}. ${child.content || 'Part of your organized file structure.'}`,
      tags: child.tags || [parentItem.title.toLowerCase(), child.type]
    };
    allItems.push(fullChild);

    // Recursively process deeper descendants so they are ready when parent expands.
    if (fullChild.children && fullChild.children.length > 0) {
      processChildrenRecursively(
        fullChild,
        { x: childX, y: childY },
        constellation,
        allItems,
        depth + 1
      );
    }
  });

  // Overflow node logic (same as before)
  if (hasMoreChildren) {
    const remainingCount = parentItem.children.length - MAX_VISIBLE_CHILDREN;
    const moreNodeAngle = 360;
    const moreNodeRadian = (moreNodeAngle * Math.PI) / 180;
    const moreNodeX = parentPos.x + Math.cos(moreNodeRadian) * parentItem.distance;
    const moreNodeY = parentPos.y + Math.sin(moreNodeRadian) * parentItem.distance;

    const moreNode: ConstellationItem = {
      id: `${parentItem.id}_more`,
      title: `+${remainingCount} more`,
      type: 'folder',
      constellation: constellation.id,
      importance: 3,
      angle: moreNodeAngle,
      distance: parentItem.distance,
      x: moreNodeX,
      y: moreNodeY,
      color: constellation.color,
      parentId: parentItem.id,
      depthLayer: 3 + depth,
      content: `View all ${parentItem.children.length} items in ${parentItem.title}`,
      tags: ['overflow', 'more'],
      icon: '📋',
      isFolder: false,
      isOverflowNode: true,
      overflowParentId: parentItem.id,
      allChildren: parentItem.children
    };
    allItems.push(moreNode);
  }
}

// Generate positions for constellation items - exact copy from original
export function initializeConstellations(constellations: Constellation[]): ConstellationItem[] {
  const allItems: ConstellationItem[] = [];

  constellations.forEach(constellation => {
    // Add constellation center
    const centerNode: ConstellationItem = {
      id: constellation.id + '_center',
      title: constellation.name,
      type: 'constellation',
      constellation: constellation.id,
      importance: 6,
      angle: 0,
      distance: 0,
      x: constellation.centerX,
      y: constellation.centerY,
      color: constellation.color,
      icon: constellation.icon,
      isCenter: true,
      content: `${constellation.name} constellation center`,
      tags: [constellation.name.toLowerCase()],
      depthLayer: constellation.depthLayer || 0 // Use constellation's depth layer
    };
    allItems.push(centerNode);

    // Add items
    constellation.items.forEach(item => {
      const radian = (item.angle * Math.PI) / 180;
      const x = constellation.centerX + Math.cos(radian) * item.distance;
      const y = constellation.centerY + Math.sin(radian) * item.distance;

      const fullItem: ConstellationItem = {
        ...item,
        constellation: constellation.id,
        x: x,
        y: y,
        color: constellation.color,
        content: item.content || `This is a ${item.type} from ${constellation.name}. It contains important information related to your ${constellation.name.toLowerCase()}.`,
        tags: item.tags || [constellation.name.toLowerCase(), item.type],
        // Ensure folder properties are preserved
        isFolder: item.isFolder || item.type === 'folder'
      };
      allItems.push(fullItem);

      // Recursively process children (handles nested folders)
      if (item.children && item.children.length > 0) {
        processChildrenRecursively(item, { x, y }, constellation, allItems, 0);
      }
    });
  });

  return allItems;
}

// Exact utility functions from the original HTML
export function getItemIcon(item: ConstellationItem): string {
  const iconMap: Record<string, string> = {
    'document': '📄',
    'note': '📝',
    'presentation': '📊',
    'spreadsheet': '📈',
    'email': '📧',
    'media': '🖼️',
    'receipt': '🧾',
    'chat': '💬',
    'event': '📅',
    'constellation': item.icon || '⭐',
    'folder': item.icon || '📁'
  };
  return iconMap[item.type] || '📄';
}

export function getItemColor(item: ConstellationItem): string {
  return item.color || '#3b82f6';
}

export function getItemSize(item: ConstellationItem): number {
  if (item.isCenter) return 20;
  const baseSize = 8;
  const sizeMultiplier = (item.importance || 3) / 5;
  return baseSize + (sizeMultiplier * 6);
}

export function transformPoint(
  x: number,
  y: number,
  z: number = 0,
  state: any
): { x: number; y: number; depth: number } {
  // Handle undefined state
  if (!state) {
    return { x, y, depth: z };
  }

  // Apply pan to X/Y
  let transformedX = x + (state.pan?.x || 0);
  let transformedY = y + (state.pan?.y || 0);
  let transformedZ = z; // This Z value ALREADY includes constellation offset from getConstellationDepthZ

  // Apply 3D rotation around center
  const centerX = state.centerX || (typeof window !== 'undefined' ? window.innerWidth / 2 : 400);
  const centerY = state.centerY || (typeof window !== 'undefined' ? window.innerHeight / 2 : 300);

  // Translate to origin
  transformedX -= centerX;
  transformedY -= centerY;

  // Apply rotation
  const rotX = (state.rotation?.x || 0) * Math.PI / 180;
  const rotY = (state.rotation?.y || 0) * Math.PI / 180;

  // Full 3D rotation calculations
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);

  // Rotate around Y axis (horizontal rotation) - affects X and Z
  const rotatedX = transformedX * cosY + transformedZ * sinY;
  const rotatedZ = -transformedX * sinY + transformedZ * cosY;

  // Rotate around X axis (vertical rotation) - affects Y and Z
  const finalY = transformedY * cosX - rotatedZ * sinX;
  const finalZ = transformedY * sinX + rotatedZ * cosX;

  // CRITICAL FIX: Use smaller perspective for dramatic effect
  const perspective = 800; // Reduced from 1000/2000 to 800 for MORE dramatic effect

  // Debug constellation focus - the Z already includes offset
  if (Math.abs(finalZ) > 200) {
    // console.log('🎯 CONSTELLATION FOCUS DETECTED:', {
    //   inputZ: z,
    //   finalZ: finalZ,
    //   perspective: perspective,
    //   denominator: perspective - finalZ,
    //   effect: finalZ > 0 ? '🔥 FOCUSED (MUCH CLOSER!)' : '❄️ PUSHED BACK (farther)'
    // });
  }

  // ENHANCED: More dramatic perspective calculation
  const denominator = perspective - finalZ;

  // Allow EXTREME perspective effects for focused constellations
  let projectedX, projectedY;

  if (denominator <= 100) {
    // Extreme close-up: create dramatic scaling
    const scaleFactor = perspective / 100; // 8x when very close
    projectedX = rotatedX * scaleFactor;
    projectedY = finalY * scaleFactor;
    // console.log('💥 EXTREME CLOSE-UP! Scale:', scaleFactor);
  } else {
    // Normal perspective projection
    projectedX = (rotatedX * perspective) / denominator;
    projectedY = (finalY * perspective) / denominator;
  }

  // Apply zoom
  const scaledX = projectedX * (state.zoom || 1);
  const scaledY = projectedY * (state.zoom || 1);

  // Translate back
  return {
    x: scaledX + centerX,
    y: scaledY + centerY,
    depth: finalZ // Return the final Z for depth sorting
  };
}

/**
 * Inverse transform from screen coordinates back to world coordinates
 * This reverses the transformPoint operation
 */
export function inverseTransformPoint(
  screenX: number,
  screenY: number,
  currentZ: number = 0,
  state: any
): { x: number; y: number } {
  if (!state) {
    return { x: screenX, y: screenY };
  }

  const centerX = state.centerX || (typeof window !== 'undefined' ? window.innerWidth / 2 : 400);
  const centerY = state.centerY || (typeof window !== 'undefined' ? window.innerHeight / 2 : 300);

  // First, reverse the zoom scaling
  const unscaledX = (screenX - centerX) / (state.zoom || 1);
  const unscaledY = (screenY - centerY) / (state.zoom || 1);

  // Apply inverse perspective
  const perspective = 800;
  const denominator = perspective - currentZ;
  const scaleFactor = denominator / perspective;

  const unprojectedX = unscaledX * scaleFactor;
  const unprojectedY = unscaledY * scaleFactor;

  // Apply inverse rotation (transpose of rotation matrix)
  const rotX = (state.rotation?.x || 0) * Math.PI / 180;
  const rotY = (state.rotation?.y || 0) * Math.PI / 180;

  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);

  // Inverse Y rotation (transpose)
  const tempX = unprojectedX * cosY - currentZ * sinY;
  const tempZ = unprojectedX * sinY + currentZ * cosY;

  // Inverse X rotation (transpose)
  const worldY = unprojectedY * cosX + tempZ * sinX;

  // Apply inverse pan
  const worldX = tempX + centerX - (state.pan?.x || 0);
  const worldYFinal = worldY + centerY - (state.pan?.y || 0);

  return { x: worldX, y: worldYFinal };
}

// Get current position of a node (custom position or default)
export function getNodePosition(
  item: ConstellationItem,
  nodePositions: Record<string, { x: number; y: number }>,
  allItems?: ConstellationItem[]
): { x: number; y: number } {
  // Check if we have a custom position first
  if (nodePositions[item.id]) {
    return nodePositions[item.id];
  }

  // If item has x,y coordinates, use them
  if (item.x !== undefined && item.y !== undefined) {
    return { x: item.x, y: item.y };
  }

  // If item has a parent and we have allItems, calculate position relative to parent
  if (item.parentId && allItems) {
    const parent = allItems.find(i => i.id === item.parentId);
    if (parent) {
      const parentPos = getNodePosition(parent, nodePositions, allItems);
      return calculateChildPosition(item, parent, parentPos);
    }
  }

  // Fallback to origin
  return { x: 0, y: 0 };
}

// Get depth Z coordinate for depth layers
export function getDepthZ(depthLayer: number): number {
  // Handle fractional layers (MVP: only 1.5, no 0.5)
  if (depthLayer === 1.5) return -100;  // Constellation center when expanded

  const depthMap: Record<number, number> = {
    0: 0,      // Foreground (children of expanded constellation, Knowledge Base center)
    1: -150,   // Level 1 back (Subfolder centers)
    2: -300,   // Level 2 back (Subfolder contents)
    3: -450,   // Level 3 back (hidden children)
    4: -600,   // Level 4 back (deep hidden)
    999: -2000 // Hidden layer
  };
  return depthMap[depthLayer] || (-depthLayer * 150);
}

// Get item depth layer
export function getItemDepthLayer(item: ConstellationItem): number {
  if (item.depthLayer !== undefined) return item.depthLayer;
  if (item.parentId) return 1.5; // Children come FORWARD when expanded
  return 0; // Default foreground
}

// Calculate hierarchy level based on parent chain
export function calculateHierarchyLevel(
  item: ConstellationItem,
  allItems: ConstellationItem[]
): number {
  if (!item.parentId) {
    // Root level item (constellation center or root folder)
    return item.isCenter ? 0 : 1;
  }

  // Find parent and recursively calculate depth
  const parent = allItems.find(i => i.id === item.parentId);
  if (!parent) return 1;

  return calculateHierarchyLevel(parent, allItems) + 1;
}

// Build ancestor chain for an item
export function getAncestorChain(
  item: ConstellationItem,
  allItems: ConstellationItem[]
): string[] {
  const ancestors: string[] = [];
  let currentItem = item;

  while (currentItem.parentId) {
    ancestors.unshift(currentItem.parentId);
    const parent = allItems.find(i => i.id === currentItem.parentId);
    if (!parent) break;
    currentItem = parent;
  }

  return ancestors;
}

// Check if all ancestors are expanded
export function areAllAncestorsExpanded(
  item: ConstellationItem,
  expandedFolders: Set<string>,
  allItems: ConstellationItem[]
): boolean {
  const ancestors = getAncestorChain(item, allItems);
  return ancestors.every(ancestorId => expandedFolders.has(ancestorId));
}

// Check if mouse is over a node
export function getNodeAtPosition(
  clientX: number,
  clientY: number,
  allItems: ConstellationItem[],
  nodePositions: Record<string, Position>,
  state: any,
  svgElement: SVGElement | null,
  getItemDepthLayer?: (item: ConstellationItem) => number,
  getDepthScale?: (depthLayer: number) => number,
  getConstellationDepthZ?: (item: ConstellationItem, depthLayer: number) => number
): ConstellationItem | null {
  if (!svgElement) return null;

  const rect = svgElement.getBoundingClientRect();
  const screenX = clientX - rect.left;
  const screenY = clientY - rect.top;

  // Get depth calculation functions
  const calculateDepthLayer = getItemDepthLayer || ((item: ConstellationItem) => {
    // Default depth layer calculation
    return 0;
  });

  const calculateDepthScale = getDepthScale || ((depthLayer: number) => {
    return Math.max(0.3, 1 - depthLayer * 0.2);
  });

  const calculateDepthZ = getConstellationDepthZ || ((item: ConstellationItem, depthLayer: number) => {
    return getDepthZ(depthLayer);
  });

  // Sort items by depth (front to back) and check hit detection
  const visibleItems = allItems.filter(item => {
    const depthLayer = calculateDepthLayer(item);
    return depthLayer < 3;
  }).sort((a, b) => {
    const depthA = calculateDepthZ(a, calculateDepthLayer(a));
    const depthB = calculateDepthZ(b, calculateDepthLayer(b));
    return depthA - depthB;
  });

  for (const item of visibleItems) {
    const position = nodePositions[item.id] || { x: item.x || 0, y: item.y || 0 };
    const depthLayer = calculateDepthLayer(item);
    const zPosition = calculateDepthZ(item, depthLayer);
    const depthScale = calculateDepthScale(depthLayer);

    if (depthScale <= 0) continue;

    // Transform item position to screen coordinates
    const transformed = transformPoint(position.x, position.y, zPosition, state);
    const baseSize = getItemSize(item);
    const scaledSize = baseSize * depthScale;

    const distance = Math.sqrt(
      Math.pow(screenX - transformed.x, 2) + Math.pow(screenY - transformed.y, 2)
    );

    const hitBuffer = (item.type === 'folder' || item.isFolder) ? 15 : 8;
    const hitRadius = scaledSize + hitBuffer;

    if (distance <= hitRadius) {
      return item;
    }
  }
  return null;
}
