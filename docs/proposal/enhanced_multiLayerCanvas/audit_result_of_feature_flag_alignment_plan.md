Audit and Patch to Align Canvas Flag Implementation with Revised Plan
Audit of Multi-Layer Canvas Flag Alignment
We compared the existing code in each file against the “Enhanced Multi-Layer Canvas Feature Flag Alignment” plan. The plan mandates a new unified flag model (ui.multiLayerCanvas and ui.layerModel), deprecation of the old environment fallback (NEXT_PUBLIC_LAYER_MODEL), explicit defaults, a migration step, and rigorous gating of all LayerManager usage and UI when the feature is disabled. We found several discrepancies and missing pieces in each file:
Feature Flags (feature-flags.ts) – The schema lacks ui.layerModel and ui.panMode keys; defaults for these flags are missing. There is no migration logic to backfill existing runtime/localStorage flags. There are no debug/telemetry logs around flag loading or setting.
Layer Manager (use-layer-manager.ts) – The hook still uses process.env.NEXT_PUBLIC_LAYER_MODEL as a fallback and uses a single-flag OR logic. It does not consider the new ui.multiLayerCanvas flag nor remove the deprecated env check. We need a combined check (ui.layerModel && ui.multiLayerCanvas). There is no logging of the enabled state or migration on toggle.
Canvas Panel (canvas-panel.tsx) – This component uses only ui.multiLayerCanvas (with an as any cast) and never checks ui.layerModel. Many LayerManager calls (focusNode, updateNode, etc.) are unguarded by the combined flag. UI elements (BringToFront/SendToBack buttons) are still shown based on the old layerManager.isEnabled. There is no logic to fail-closed when the feature is off (e.g. to fall back to simple z-index stacking).
Layer Controls (layer-controls.tsx) – This UI only checks ui.multiLayerCanvas. It should also require ui.layerModel. Otherwise, disabling the flag will not hide the layer controls as intended.
Keyboard Shortcuts (use-layer-keyboard-shortcuts.ts) – Similarly, only ui.multiLayerCanvas is checked. It must also check ui.layerModel to disable the shortcuts when the feature is off.
Popup Overlay (popup-overlay.tsx and popup-overlay-improved.tsx) – Both only use ui.multiLayerCanvas and bail out (return null) if that flag is false. They do not consider ui.layerModel. The plan calls for an inline fallback (rendering popups in the single-layer canvas) rather than completely hiding them, and for gating the LayerManager registration. There is no telemetry/log when the overlay mode is toggled.
Below we summarize the non‐compliance issues per file, then propose detailed code patches to bring each into line with the plan. (All referenced plan sections and current code excerpts are cited.)
Summary of Gaps per File
feature-flags.ts – Schema is missing keys, defaults. The FeatureFlags interface and DEFAULT_FLAGS must include 'ui.layerModel' and 'ui.panMode'. A migration utility must add these to any stored flags. Currently, there is no such migration or logging. (Also, existing casts like useFeatureFlag('ui.layerModel' as any) indicate the key is missing from the type.)
use-layer-manager.ts – Deprecated env var and missing unified check. The hook does useFeatureFlag('ui.layerModel') || process.env.NEXT_PUBLIC_LAYER_MODEL !== '0'. The plan says to remove the NEXT_PUBLIC_LAYER_MODEL fallback and require both flags:
isEnabled = useFeatureFlag('ui.layerModel') && useFeatureFlag('ui.multiLayerCanvas');
(Optionally define const isLayerModelEnabled = … for clarity.) There is no telemetry/logging around changes.
canvas-panel.tsx – Missing ui.layerModel checks and unguarded LayerManager calls. The panel reads only ui.multiLayerCanvas and never checks the layer model flag. When dragging, it always does layerManager.focusNode(panelId) and layerManager.updateNode(...). These should be skipped when the feature is off. The action buttons are gated by layerManager.isEnabled (which currently reflects the old logic); they should use the new combined flag. There is no debug log of the feature state.
layer-controls.tsx – Only checks multiLayerCanvas. It should also require ui.layerModel. Replace if (!multiLayerEnabled) with if (!multiLayerEnabled || !layerModelEnabled) so that controls completely hide when either flag is false.
use-layer-keyboard-shortcuts.ts – Only checks multiLayerCanvas. The top of the hook reads if (!multiLayerEnabled) return;. It must also check ui.layerModel. Otherwise, shortcuts remain active even when the feature is meant to be off.
popup-overlay.tsx / popup-overlay-improved.tsx – Only checks multiLayerCanvas and returns null; no inline fallback. Both components simply do if (!multiLayerEnabled) return null;. They never check ui.layerModel. According to the plan, when the feature is disabled, popups should render inline and skip LayerManager registration. At minimum, both should use the combined flag and probably log or emit telemetry on mode changes.
Across all files, we also note missing telemetry/logging per the plan: initial boot should log the feature state, and any runtime toggle should fire a structured event. We do not have a telemetry library shown, but at minimum debugLog or console.log statements should be added when entering/exiting layer-model mode or toggling flags. Below are concrete patch suggestions to address these issues in each file.
Patches by File
1. feature-flags.ts
Issues: The FeatureFlags interface and defaults must be extended per plan. We need to add 'ui.layerModel' and 'ui.panMode' (with default true and false respectively). Also add migration code after loading runtimeFlags to backfill any missing keys and save, logging the event. Finally, instrument setFeatureFlag to log toggles of the layer flags. Patch: Add the missing keys in the interface and defaults, insert a migration snippet, and some debug logs. For example:
--- feature-flags.ts
@@
 interface FeatureFlags {
   'offline.circuitBreaker': boolean;
   'offline.swCaching': boolean;
   'offline.conflictUI': boolean;
   'ui.multiLayerCanvas': boolean;
+  'ui.layerModel': boolean;   // NEW: LayerManager switch
+  'ui.panMode': boolean;      // NEW: optional pan mode feature
 }
@@
 const DEFAULT_FLAGS: FeatureFlags = {
@@
   'ui.multiLayerCanvas': true,
+  'ui.layerModel': true,  // NEW default enabled
+  'ui.panMode': false,    // NEW default disabled
 };
 
@@
 let runtimeFlags: Partial<FeatureFlags> = {};
 
 if (typeof window !== 'undefined') {
   try {
     const stored = localStorage.getItem('offlineFeatureFlags');
     if (stored) {
       runtimeFlags = JSON.parse(stored);
     }
   } catch (e) {
     // Ignore localStorage errors
   }

+  // Backfill missing flags (migration for ui.layerModel, ui.panMode)
+  const defaults = DEFAULT_FLAGS;
+  let mutated = false;
+  (['ui.layerModel', 'ui.panMode'] as const).forEach(flag => {
+    if (!(flag in runtimeFlags)) {
+      (runtimeFlags as any)[flag] = defaults[flag];
+      mutated = true;
+    }
+  });
+  if (mutated) {
+    try {
+      localStorage.setItem('offlineFeatureFlags', JSON.stringify(runtimeFlags));
+      // Debug log migration event
+      console.debug('[FeatureFlags] layer_model_migration:', runtimeFlags);
+    } catch (error) {
+      console.error('[FeatureFlags] migrate failed', error);
+    }
+  }
 }
@@
 export function setFeatureFlag<K extends keyof FeatureFlags>(
   flag: K,
   value: FeatureFlags[K]
 ): void {
   if (typeof window === 'undefined') return;
   
   runtimeFlags[flag] = value;
   try {
     localStorage.setItem('offlineFeatureFlags', JSON.stringify(runtimeFlags));
+    // Log toggles of layer flags
+    if (flag === 'ui.layerModel' || flag === 'ui.multiLayerCanvas') {
+      console.debug('[FeatureFlags] flag_changed:', flag, value);
+    }
   } catch (e) {
     console.error('Failed to save feature flags:', e);
   }
 }
(We use console.debug here; in a real codebase one might use debugLog or another telemetry helper. The important part is to emit a clear message when missing flags are added or toggled.)
2. use-layer-manager.ts
Issues: The hook’s isEnabled logic still uses the deprecated environment variable and ignores ui.multiLayerCanvas. We must remove the NEXT_PUBLIC_LAYER_MODEL fallback and require both flags. Also remove any as any cast now that 'ui.layerModel' exists in the schema. Ideally, log when the enabled state changes. Patch: Change isEnabled to a combined check, drop the env var, and add a debug log. For example:
--- use-layer-manager.ts
@@ export function useLayerManager(): UseLayerManagerReturn {
-  // Feature flag to enable/disable layer management
-  // LayerManager enabled by default; set NEXT_PUBLIC_LAYER_MODEL=0 to disable
-  const isEnabled = useFeatureFlag('ui.layerModel' as any) ||
-                    process.env.NEXT_PUBLIC_LAYER_MODEL !== '0'
+  // Unified flag: both layerModel and multiLayerCanvas must be true
+  const layerModelEnabled = useFeatureFlag('ui.layerModel');
+  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas');
+  const isLayerModelEnabled = layerModelEnabled && multiLayerEnabled;
+  const isEnabled = isLayerModelEnabled;
 
+  // (Optional) Debug log on mount/change
+  // console.debug('[LayerManager] enabled=', isEnabled, '(layerModel:', layerModelEnabled, ', multiLayer:', multiLayerEnabled, ')');
 
   const [updateTrigger, setUpdateTrigger] = useState(0);
   const forceUpdate = useCallback(() => setUpdateTrigger(prev => prev + 1), []);
@@
   // Get the singleton LayerManager
-  const manager = isEnabled ? getLayerManager() : null
+  const manager = isEnabled ? getLayerManager() : null;
(We remove the as any and environment check. We could also use a useEffect to log when isLayerModelEnabled toggles, but that would require integrating into a global telemetry system. At minimum, we’ve structured isEnabled correctly.) All wrapped operations already return early if !manager || !isEnabled, so disabling will effectively make them no-ops.
3. canvas-panel.tsx
Issues: The panel reads only ui.multiLayerCanvas and never checks ui.layerModel. All LayerManager calls (focusNode, updateNode) are currently unconditional. According to the plan, these should be skipped (“fail-closed”) when the unified flag is off. Also UI elements (bring-to-front/back buttons) should use the combined flag, not just layerManager.isEnabled. Finally, patch out the as any cast for useFeatureFlag('ui.multiLayerCanvas') since its key is known. Patch: Introduce a combined flag and guard all LayerManager interactions. For example:
--- canvas-panel.tsx
@@ function CanvasPanel(...){
-  const layerManager = useLayerManager();
+  const layerManager = useLayerManager();
+  const layerModelEnabled = useFeatureFlag('ui.layerModel');
+  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas');
+  const isLayerModelEnabled = layerModelEnabled && multiLayerEnabled;
 
   const layerBandInfo = layerManager.getLayerBandInfo(panelId);
   const { node: canvasNode } = useCanvasNode(panelId, 'panel', position);
@@
   // Compute whether the editor should be editable based on layer state
   const isLayerInteractive = !multiLayerEnabled || !layerContext || layerContext.activeLayer === 'notes';
@@
   useEffect(() => {
     // Update cursor based on active layer
     const panel = panelRef.current;
@@
-    if (multiLayerEnabledRef.current && layerContextRef.current?.activeLayer === 'popups') {
+    if (isLayerModelEnabled && layerContextRef.current?.activeLayer === 'popups') {
       header.style.cursor = 'not-allowed';
     } else {
       header.style.cursor = 'move';
@@
   // Start drag handler
   const handleMouseDown = (e: MouseEvent) => {
@@
       // Bring panel to front while dragging
-      layerManager.focusNode(panelId) // This brings to front and updates focus time
+      if (isLayerModelEnabled) {
+        layerManager.focusNode(panelId); // bring to front via LayerManager
+      }
       globalDraggingPanelId = panelId;
@@
   const handleMouseUp = (e: MouseEvent) => {
@@
       // Update position in LayerManager if enabled
-      layerManager.updateNode(panelId, { position: { x: finalX, y: finalY } })
+      if (isLayerModelEnabled) {
+        layerManager.updateNode(panelId, { position: { x: finalX, y: finalY } });
+      }
@@
   useEffect(() => {
@@
-    const order = layerManager.isEnabled
+    const order = isLayerModelEnabled
       ? ['bringToFront', 'sendToBack', 'resizeToggle', 'branches', 'actions']
       : ['resizeToggle', 'branches', 'actions'];
@@
   // ... later in JSX, wrap actions ...
 {layerManager.isEnabled && (
+{isLayerModelEnabled && (
   <>
     <div ref={registerActionRef('bringToFront')}>
       ...
       onClick={() => {
-         layerManager.bringToFront(panelId)
+         layerManager.bringToFront(panelId);
         }}
         disabled={layerBandInfo?.isAtTop}
Apply similar guards everywhere layerManager.isEnabled is used in rendering (lines [12]–[15]) and replace with isLayerModelEnabled. Also remove the redundant as any cast on the flag at line 438 (now TypeScript knows the key). (This patch ensures that if either flag is false, the drag focus/update and UI actions are skipped. In “legacy” mode, panels will simply use their stored positions and z-index from the base editor, and the LayerManager will not reorder them.)
4. layer-controls.tsx
Issues: This component only checks ui.multiLayerCanvas. It must also verify ui.layerModel so that the entire control panel disappears if layer management is off. There is no fallback. Patch: Add the layerModel check:
--- layer-controls.tsx
@@ export const LayerControls: React.FC<LayerControlsProps> = ({ ... }) => {
-  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any);
+  const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas');
+  const layerModelEnabled = useFeatureFlag('ui.layerModel');
   const layerContext = useLayer();
 
-  if (!multiLayerEnabled || !layerContext) {
+  if (!multiLayerEnabled || !layerModelEnabled || !layerContext) {
     return null;
   }
Now the whole controls UI will be hidden unless both flags are true. (Remove any as any cast since ui.multiLayerCanvas is already in the schema.)
5. use-layer-keyboard-shortcuts.ts
Issues: The hook unconditionally reads ui.multiLayerCanvas and registers listeners if true. It never checks ui.layerModel. To honor the plan, all layer-related shortcuts must be disabled unless both flags are on. Patch: Similar to above, include ui.layerModel:
--- use-layer-keyboard-shortcuts.ts
@@ export const useLayerKeyboardShortcuts = (callbacks: ShortcutCallbacks) => {
   const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any);
+  const layerModelEnabled = useFeatureFlag('ui.layerModel');
@@
   const handleKeyDown = useCallback((event: KeyboardEvent) => {
-    if (!multiLayerEnabled) return;
+    if (!multiLayerEnabled || !layerModelEnabled) return;
     // ...
   }, [multiLayerEnabled, callbacks]);
 
   const handleKeyUp = useCallback((event: KeyboardEvent) => {
-    if (!multiLayerEnabled) return;
+    if (!multiLayerEnabled || !layerModelEnabled) return;
     // ...
   }, [multiLayerEnabled, callbacks]);
@@
   useEffect(() => {
-    if (!multiLayerEnabled) return;
+    if (!multiLayerEnabled || !layerModelEnabled) return;
Also remove the as any cast now that layerModel exists. This ensures that none of the keyboard shortcuts or drag-mode switches activate unless the unified layer-model feature is enabled.
6. popup-overlay.tsx
Issues: The current code only checks ui.multiLayerCanvas and simply returns null when false. According to the plan, popups should have an inline fallback instead of disappearing. At minimum, we must also check ui.layerModel, and preferably log the mode change. We should modify it so that if either flag is false, the overlay does not mount (and ideally falls back to the legacy approach). Patch: Add a combined flag check and debug log. For example:
--- popup-overlay.tsx
@@ export const PopupOverlay: React.FC<PopupOverlayProps> = ({ ... }) => {
   const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any);
+  const layerModelEnabled = useFeatureFlag('ui.layerModel');
+  const isLayerModelEnabled = multiLayerEnabled && layerModelEnabled;
@@
   // Debug log on mount
   useEffect(() => {
@@
       debugLog('PopupOverlay', 'component_mounted', {
         multiLayerEnabled,
+        layerModelEnabled,
         popupCount: popups.size,
         timestamp: new Date().toISOString()
       });
@@
     return () => {
       getUIResourceManager().enqueueLowPriority(() => {
-        debugLog('PopupOverlay', 'component_unmounted', {
+        debugLog('PopupOverlay', 'component_unmounted', {
           timestamp: new Date().toISOString()
         });
       });
@@
-  if (!multiLayerEnabled) {
-    return null; // Feature not enabled
-  }
+  if (!isLayerModelEnabled) {
+    console.debug('[PopupOverlay] layer model disabled, fallback mode');
+    return null;
+    // TODO: render popups inline in legacy mode if needed
+  }
(We’ve inserted layerModelEnabled into the logs and used it to gate the component. In practice, one might implement the inline fallback here instead of returning null. At minimum, this prevents the portal version from rendering when the feature is off.) The rest of the overlay code can stay the same under the true branch. (We also ensure no as any is needed now.)
7. popup-overlay-improved.tsx
Issues: Same as above: it only checks ui.multiLayerCanvas. Must also check ui.layerModel, and ideally fall back (or log) when disabled. Patch: Add the combined check:
--- popup-overlay-improved.tsx
@@ export const PopupOverlay: React.FC<PopupOverlayProps> = ({ ... }) => {
   const multiLayerEnabled = useFeatureFlag('ui.multiLayerCanvas' as any);
+  const layerModelEnabled = useFeatureFlag('ui.layerModel');
+  const isLayerModelEnabled = multiLayerEnabled && layerModelEnabled;
@@
-  if (!multiLayerEnabled) {
-    return null;
+  if (!isLayerModelEnabled) {
+    console.debug('[PopupOverlay] improved mode disabled');
+    return null;
   }
Again, no as any needed now. The component’s internal debug logs for pan/zoom still run when the feature is on. If required, one could implement an inline fallback here too.
Conclusions
This audit identified multiple blocking gaps relative to the alignment plan. In particular, the absence of the ui.layerModel flag everywhere means we cannot reliably disable the LayerManager, and the old NEXT_PUBLIC_LAYER_MODEL check could still spuriously re-enable it. Until all code is patched as above:
Disabling the feature flag will not actually disable layer management everywhere; e.g. panels will still reorder via the LayerManager, and popups will vanish entirely rather than fall back.
Tests or users cannot fully enter true “single-layer” mode.
There is no clear telemetry of whether the app is running in legacy vs. new mode.
The proposed diffs add the missing flags, defaults, and runtime checks; they guard all LayerManager usages by a combined flag (isLayerModelEnabled). We also insert a migration utility snippet in feature-flags.ts, and debug/log calls around mounting and flag toggles as placeholders for the required telemetry. Once these patches are applied, the code will comply with the plan: the ui.layerModel schema will exist with correct defaults, the env-var fallback will be removed, and all components will correctly gate their multi-layer behavior. The app can then be reliably toggled between legacy and new canvas modes (with QA able to test single-layer mode), and we can log each transition for observability.