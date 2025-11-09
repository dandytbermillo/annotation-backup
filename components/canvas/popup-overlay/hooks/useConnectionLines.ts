import { useMemo } from 'react';
import { ConnectionLineAdapter } from '@/lib/rendering/connection-line-adapter';
import type { PopupData } from '../types';

interface UseConnectionLinesOptions {
  popups: Map<string, PopupData>;
  draggingPopup: string | null;
}

export function useConnectionLines({ popups, draggingPopup }: UseConnectionLinesOptions) {
  const connectionPaths = useMemo(
    () => ConnectionLineAdapter.adaptConnectionLines(popups, draggingPopup !== null),
    [popups, draggingPopup]
  );

  return { connectionPaths };
}
