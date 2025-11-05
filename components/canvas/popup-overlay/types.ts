import React from 'react';
import { PopupState } from '@/lib/rendering/connection-line-adapter';

export type PopupChildNode = {
  id: string;
  type?: string;
  name?: string;
  title?: string;
  parentId?: string;
  icon?: string | null;
  color?: string | null;
  hasChildren?: boolean;
  createdAt?: string;
  updatedAt?: string;
  path?: string;
  level?: number;
  children?: PopupChildNode[];
};

export interface PopupData extends PopupState {
  id: string;
  folder: any;
  folderName?: string;
  position: { x: number; y: number };
  canvasPosition: { x: number; y: number };
  parentId?: string;
  level: number;
  isDragging?: boolean;
  isLoading?: boolean;
  isHighlighted?: boolean;
  closeMode?: 'normal' | 'closing';
  isPinned?: boolean;
  width?: number;
  height?: number;
  sizeMode?: 'default' | 'auto' | 'user';
}

export interface PopupOverlayProps {
  popups: Map<string, PopupData>;
  draggingPopup: string | null;
  onClosePopup: (id: string) => void;
  onInitiateClose?: (popupId: string) => void;
  onConfirmClose?: (parentId: string) => void;
  onCancelClose?: (parentId: string) => void;
  onTogglePin?: (popupId: string) => void;
  onDragStart?: (id: string, event: React.MouseEvent) => void;
  onHoverFolder?: (folder: any, event: React.MouseEvent, parentPopupId: string, isPersistent?: boolean) => void;
  onLeaveFolder?: (folderId?: string, parentPopoverId?: string) => void;
  onPopupHover?: (folderId: string, parentPopupId?: string) => void;
  onSelectNote?: (noteId: string) => void;
  onDeleteSelected?: (popupId: string, selectedIds: Set<string>) => void;
  onBulkMove?: (itemIds: string[], targetFolderId: string, sourcePopupId: string) => Promise<void>;
  onFolderCreated?: (popupId: string, newFolder: PopupChildNode) => void;
  onFolderRenamed?: (folderId: string, newName: string) => void;
  onPopupCardClick?: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onPopupPositionChange?: (
    popupId: string,
    positions: {
      screenPosition?: { x: number; y: number };
      canvasPosition?: { x: number; y: number };
      size?: { width: number; height: number };
    }
  ) => void;
  onResizePopup?: (
    popupId: string,
    size: { width: number; height: number },
    options?: { source: 'auto' | 'user' }
  ) => void;
  isLocked?: boolean;
  sidebarOpen?: boolean;
  backdropStyle?: string;
}
