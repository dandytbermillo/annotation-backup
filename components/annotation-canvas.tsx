"use client"

import { useEffect, useRef } from "react"

export default function AnnotationCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Initialize the application with a simpler rich text editor approach
    const initializeApp = () => {
      const script = document.createElement("script")
      script.textContent = `
        // Yjs-Ready Architecture with Enhanced Rich Text Editors
        class AnnotationCanvas {
            constructor() {
                // Canvas state
                this.canvasState = {
                    zoom: 1,
                    translateX: -1000,
                    translateY: -1200,
                    isDragging: false,
                    lastMouseX: 0,
                    lastMouseY: 0,
                    showConnections: true
                };

                // App state - Yjs-ready structure
                this.state = {
                    panels: new Map(),
                    panelOrder: [],
                    selectedText: '',
                    selectedRange: null,
                    currentPanel: null,
                    panelZIndex: 10,
                    childPositions: new Map(),
                    branchFilters: new Map(),
                    editors: new Map() // Store editor instances
                };

                // Panel dimensions
                this.PANEL_WIDTH = 800;
                this.PANEL_HEIGHT = 600;
                this.PANEL_SPACING_X = 900;
                this.PANEL_SPACING_Y = 650;

                // Data store - this would be replaced with Yjs Y.Map
                this.dataStore = new DataStore();
                
                // Event emitter for reactive updates
                this.events = new EventEmitter();
                
                // Setup event listeners
                this.setupEventListeners();
                
                // Initialize data
                this.initializeData();
            }

            initializeData() {
                // Initial branch data - in Yjs, this would be Y.Map
                const initialData = {
                    'main': {
                        title: 'AI in Healthcare Research',
                        type: 'main',
                        content: \`
                            <p>The integration of <span class="annotation note" data-branch="ai-integration">artificial intelligence in healthcare systems</span> represents a paradigm shift in medical practice. Recent studies have shown that <span class="annotation explore" data-branch="diagnostic-accuracy">AI diagnostic tools can achieve 94% accuracy</span> in certain medical imaging tasks.</p>
                            
                            <p>However, the implementation faces significant challenges. <span class="annotation promote" data-branch="ethical-concerns">Ethical considerations around patient privacy and algorithmic bias</span> remain paramount concerns for healthcare institutions.</p>
                            
                            <p>The economic impact is substantial, with <span class="annotation note" data-branch="cost-savings">projected cost savings of $150 billion annually</span> by 2026 through improved efficiency and reduced diagnostic errors.</p>
                        \`,
                        branches: ['ai-integration', 'diagnostic-accuracy', 'ethical-concerns', 'cost-savings'],
                        position: { x: 2000, y: 1500 },
                        isEditable: false
                    },
                    'ai-integration': {
                        title: 'AI Integration Analysis',
                        type: 'note',
                        originalText: 'artificial intelligence in healthcare systems',
                        content: \`<p>The integration requires careful consideration of existing infrastructure, staff training, and regulatory compliance. Key factors include interoperability with current EMR systems, data standardization protocols, and the establishment of clear governance frameworks.</p><p>A phased implementation approach is recommended, starting with pilot programs in controlled environments before full-scale deployment.</p>\`,
                        branches: [],
                        parentId: 'main',
                        position: { x: 2900, y: 1200 },
                        isEditable: true
                    },
                    'diagnostic-accuracy': {
                        title: 'Diagnostic Accuracy Deep Dive',
                        type: 'explore',
                        originalText: 'AI diagnostic tools can achieve 94% accuracy',
                        content: \`<p>This 94% accuracy rate is particularly impressive when compared to traditional diagnostic methods. The study analyzed performance across radiology, pathology, and dermatology. However, accuracy varies significantly by medical specialty and image quality.</p><p>Further research needed on edge cases and rare conditions where AI may struggle with limited training data.</p>\`,
                        branches: [],
                        parentId: 'main',
                        position: { x: 2900, y: 1850 },
                        isEditable: true
                    },
                    'ethical-concerns': {
                        title: 'Critical Ethical Framework',
                        type: 'promote',
                        originalText: 'Ethical considerations around patient privacy and algorithmic bias',
                        content: \`<p><strong>CRITICAL:</strong> These ethical frameworks should be mandatory industry standards. Privacy-preserving AI techniques like federated learning and differential privacy must be implemented.</p><p>Algorithmic bias testing should be continuous, not one-time. Recommend immediate policy adoption.</p>\`,
                        branches: [],
                        parentId: 'main',
                        position: { x: 2900, y: 2500 },
                        isEditable: true
                    },
                    'cost-savings': {
                        title: 'Economic Impact Analysis',
                        type: 'note',
                        originalText: 'projected cost savings of $150 billion annually',
                        content: \`<p>This $150B projection breaks down as: $60B from reduced diagnostic errors, $45B from improved efficiency, $30B from preventive care improvements, and $15B from administrative automation.</p><p>Timeline assumes 60% adoption rate by 2026.</p>\`,
                        branches: [],
                        parentId: 'main',
                        position: { x: 2900, y: 3150 },
                        isEditable: true
                    }
                };

                // Initialize data store
                Object.entries(initialData).forEach(([id, data]) => {
                    this.dataStore.set(id, data);
                });
            }

            setupEventListeners() {
                // Listen for data changes
                this.events.on('branch-added', (data) => this.handleBranchAdded(data));
                this.events.on('branch-updated', (data) => this.handleBranchUpdated(data));
                this.events.on('branch-deleted', (data) => this.handleBranchDeleted(data));
                this.events.on('filter-changed', (data) => this.handleFilterChanged(data));
                this.events.on('panel-moved', (data) => this.handlePanelMoved(data));
            }

            initializeApp() {
                this.setupCanvasEvents();
                this.createMainPanel();
                this.updateCanvasTransform();
                this.updateZoomDisplay();
                this.updateMinimap();
                this.updateConnections();
            }

            // Event handlers for data changes
            handleBranchAdded(data) {
                const { parentId, branchId } = data;
                const parentPanel = this.state.panels.get(parentId);
                if (parentPanel) {
                    this.updateBranchList(parentId);
                }
            }

            handleBranchUpdated(data) {
                const { branchId, content } = data;
                // Update would trigger through Yjs observers
            }

            handleFilterChanged(data) {
                const { panelId, filterType } = data;
                this.updateBranchList(panelId);
            }

            handlePanelMoved(data) {
                const { panelId, position } = data;
                this.updateConnections();
                this.updateMinimap();
            }

            // Data operations
            getBranch(branchId) {
                return this.dataStore.get(branchId);
            }

            setBranch(branchId, data) {
                this.dataStore.set(branchId, data);
                this.events.emit('branch-updated', { branchId, ...data });
            }

            addBranch(parentId, branchId, branchData) {
                // Add to data store
                this.dataStore.set(branchId, branchData);
                
                // Update parent's branches
                const parent = this.getBranch(parentId);
                if (parent) {
                    const branches = [...(parent.branches || [])];
                    branches.push(branchId);
                    this.dataStore.update(parentId, { branches });
                }
                
                this.events.emit('branch-added', { parentId, branchId, ...branchData });
            }

            // Update branch list using data store
            updateBranchList(panelId) {
                const panel = this.state.panels.get(panelId);
                if (!panel) return;

                const branchesContainer = panel.element.querySelector(\`#branches-\${panelId}\`);
                if (branchesContainer) {
                    branchesContainer.innerHTML = this.generateBranchItems(panelId);
                }
            }

            // Create enhanced rich text editor
            createRichEditor(element, content, isEditable, panelId) {
                element.innerHTML = content;
                element.contentEditable = isEditable;
                
                // Add rich text functionality for both editable and non-editable
                element.addEventListener('input', () => {
                    this.handleAutoSave(panelId, element.innerHTML);
                });

                element.addEventListener('mouseup', (e) => {
                    this.handleTextSelection(e, panelId, element);
                });

                element.addEventListener('keyup', (e) => {
                    this.handleTextSelection(e, panelId, element);
                });

                // Store editor reference
                this.state.editors.set(panelId, element);

                return element;
            }

            // Handle text selection for annotations
            handleTextSelection(e, panelId, element) {
                const selection = window.getSelection();
                const selectedText = selection.toString().trim();
                
                if (selectedText.length > 0) {
                    this.state.selectedText = selectedText;
                    this.state.currentPanel = panelId;
                    this.state.selectedRange = selection.getRangeAt(0);
                    
                    // Show annotation toolbar
                    const toolbar = document.getElementById('annotation-toolbar');
                    toolbar.style.left = e.pageX + 'px';
                    toolbar.style.top = (e.pageY - 80) + 'px';
                    toolbar.classList.add('visible');
                } else {
                    this.state.selectedText = '';
                    this.state.currentPanel = null;
                    this.state.selectedRange = null;
                    document.getElementById('annotation-toolbar').classList.remove('visible');
                }
            }

            // Format text using document.execCommand (fallback approach)
            formatText(panelId, command, value = null) {
                const editor = this.state.editors.get(panelId);
                if (!editor) return;

                editor.focus();
                
                try {
                    switch (command) {
                        case 'bold':
                            document.execCommand('bold', false, null);
                            break;
                        case 'italic':
                            document.execCommand('italic', false, null);
                            break;
                        case 'heading':
                            document.execCommand('formatBlock', false, \`h\${value}\`);
                            break;
                        case 'bulletList':
                            document.execCommand('insertUnorderedList', false, null);
                            break;
                        case 'orderedList':
                            document.execCommand('insertOrderedList', false, null);
                            break;
                        case 'blockquote':
                            document.execCommand('formatBlock', false, 'blockquote');
                            break;
                        case 'underline':
                            document.execCommand('underline', false, null);
                            break;
                        case 'removeFormat':
                            document.execCommand('removeFormat', false, null);
                            break;
                    }
                    
                    // Update content in data store
                    this.handleAutoSave(panelId, editor.innerHTML);
                } catch (error) {
                    console.warn('Format command not supported:', command);
                }
            }

            // Canvas event setup
            setupCanvasEvents() {
                const container = document.getElementById('canvas-container');

                container.addEventListener('mousedown', (e) => this.startDrag(e));
                document.addEventListener('mousemove', (e) => this.drag(e));
                document.addEventListener('mouseup', () => this.endDrag());
                container.addEventListener('wheel', (e) => this.handleZoom(e));
                container.addEventListener('contextmenu', e => e.preventDefault());
            }

            startDrag(e) {
                if (e.target.closest('.panel') && !e.target.closest('.panel-header')) return;
                
                this.canvasState.isDragging = true;
                this.canvasState.lastMouseX = e.clientX;
                this.canvasState.lastMouseY = e.clientY;
                document.getElementById('canvas-container').classList.add('dragging');
                document.body.classList.add('no-select');
                
                document.getElementById('annotation-toolbar').classList.remove('visible');
                
                e.preventDefault();
            }

            drag(e) {
                if (!this.canvasState.isDragging) return;
                
                e.preventDefault();

                const deltaX = e.clientX - this.canvasState.lastMouseX;
                const deltaY = e.clientY - this.canvasState.lastMouseY;

                this.canvasState.translateX += deltaX;
                this.canvasState.translateY += deltaY;
                this.canvasState.lastMouseX = e.clientX;
                this.canvasState.lastMouseY = e.clientY;

                this.updateCanvasTransform();
                this.updateMinimap();
            }

            endDrag() {
                this.canvasState.isDragging = false;
                document.getElementById('canvas-container').classList.remove('dragging');
                document.body.classList.remove('no-select');
            }

            handleZoom(e) {
                e.preventDefault();
                
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                const newZoom = Math.max(0.3, Math.min(2, this.canvasState.zoom * zoomFactor));
                
                const rect = document.getElementById('canvas-container').getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                const zoomChange = newZoom / this.canvasState.zoom;
                this.canvasState.translateX = mouseX - (mouseX - this.canvasState.translateX) * zoomChange;
                this.canvasState.translateY = mouseY - (mouseY - this.canvasState.translateY) * zoomChange;
                this.canvasState.zoom = newZoom;

                this.updateCanvasTransform();
                this.updateZoomDisplay();
                this.updateMinimap();
            }

            updateCanvasTransform() {
                const canvas = document.getElementById('infinite-canvas');
                canvas.style.transform = \`translate(\${this.canvasState.translateX}px, \${this.canvasState.translateY}px) scale(\${this.canvasState.zoom})\`;
            }

            updateZoomDisplay() {
                document.getElementById('zoom-display').textContent = Math.round(this.canvasState.zoom * 100) + '%';
            }

            // Panel creation
            createMainPanel() {
                const branch = this.getBranch('main');
                const panel = this.createPanelElement('main', branch);
                
                document.getElementById('infinite-canvas').appendChild(panel);
                this.state.panels.set('main', { element: panel, branchId: 'main' });
                this.state.panelOrder.push('main');
                
                this.setupPanelEvents('main');
                this.setupPanelDragging('main');
            }

            createBranchPanel(branchId, parentPanelId) {
                if (this.state.panels.has(branchId)) {
                    const panel = this.state.panels.get(branchId);
                    panel.element.style.zIndex = ++this.state.panelZIndex;
                    this.smoothPanToPanel(branchId);
                    return;
                }
                
                const branch = this.getBranch(branchId);
                if (!branch) return;
                
                const parentBranch = this.getBranch(parentPanelId);
                const siblingCount = this.state.childPositions.get(parentPanelId) || 0;
                
                const targetX = parentBranch.position.x + this.PANEL_SPACING_X;
                const targetY = parentBranch.position.y + (siblingCount * this.PANEL_SPACING_Y);
                
                // Update position in data store
                this.dataStore.update(branchId, {
                    position: { x: targetX, y: targetY }
                });
                
                this.state.childPositions.set(parentPanelId, siblingCount + 1);
                
                const panel = this.createPanelElement(branchId, this.getBranch(branchId));
                panel.style.zIndex = ++this.state.panelZIndex;
                
                document.getElementById('infinite-canvas').appendChild(panel);
                this.state.panels.set(branchId, { element: panel, branchId: branchId });
                this.state.panelOrder.push(branchId);
                
                this.setupPanelEvents(branchId);
                this.setupPanelDragging(branchId);
                this.updateConnections();
                this.updateMinimap();
                
                this.smoothPanToPanel(branchId);
            }

            // Unified panel creation
            createPanelElement(panelId, branch) {
                const panel = document.createElement('div');
                panel.className = \`panel \${branch.type}\`;
                panel.id = \`panel-\${panelId}\`;
                panel.style.left = branch.position.x + 'px';
                panel.style.top = branch.position.y + 'px';
                
                const headerHTML = this.createPanelHeader(panelId, branch);
                const editorHTML = this.createEditorSection(panelId, branch);
                const branchesHTML = this.createBranchesSection(panelId, branch);
                
                panel.innerHTML = \`
                    \${headerHTML}
                    <div style="display: flex; flex: 1; overflow: hidden;" ondragstart="return false">
                        \${editorHTML}
                        \${branchesHTML}
                    </div>
                    \${panelId !== 'main' ? '<div class="connection-point input"></div>' : ''}
                    <div class="connection-point output"></div>
                \`;

                // Initialize rich text editor after DOM insertion
                setTimeout(() => {
                    const editorElement = panel.querySelector('.rich-editor');
                    if (editorElement) {
                        this.createRichEditor(editorElement, branch.content, branch.isEditable !== false, panelId);
                    }
                }, 100);

                return panel;
            }

            createPanelHeader(panelId, branch) {
                return \`
                    <div class="panel-header" ondragstart="return false">
                        <span>\${branch.title}</span>
                        \${panelId !== 'main' ? \`<button class="panel-close" onclick="window.app.closeBranchPanel('\${panelId}')">×</button>\` : ''}
                    </div>
                \`;
            }

            createEditorSection(panelId, branch) {
                const breadcrumb = this.generateBreadcrumb(panelId);
                const isEditable = branch.isEditable !== false;
                
                return \`
                    <div class="editor-section">
                        <div class="auto-save" id="auto-save-\${panelId}">Saved</div>
                        <div class="editor-header">
                            <div class="editor-title">\${branch.title}</div>
                            \${breadcrumb ? \`<div class="breadcrumb">\${breadcrumb}</div>\` : ''}
                        </div>
                        
                        <div class="editor-content">
                            \${branch.originalText ? \`<div class="quoted-text">"\${branch.originalText}"</div>\` : ''}
                            <div class="rich-editor-wrapper">
                                <div class="rich-toolbar" id="toolbar-\${panelId}" style="display: \${panelId === 'main' ? 'flex' : (isEditable ? 'flex' : 'none')}">
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'bold')" title="Bold">
                                        <strong>B</strong>
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'italic')" title="Italic">
                                        <em>I</em>
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'underline')" title="Underline">
                                        <u>U</u>
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'heading', 2)" title="Heading 2">
                                        H2
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'heading', 3)" title="Heading 3">
                                        H3
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'bulletList')" title="Bullet List">
                                        •
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'orderedList')" title="Numbered List">
                                        1.
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'blockquote')" title="Quote">
                                        "
                                    </button>
                                    <button class="toolbar-btn" onclick="window.app.formatText('\${panelId}', 'removeFormat')" title="Clear Format">
                                        ✕
                                    </button>
                                    \${panelId === 'main' ? \`
                                    <button class="toolbar-btn special" onclick="window.app.toggleMainEditing('\${panelId}')" title="Toggle Editing">
                                        📝 Edit
                                    </button>
                                    \` : ''}
                                </div>
                                <div class="rich-editor" data-panel="\${panelId}"></div>
                            </div>
                        </div>
                    </div>
                \`;
            }

            createBranchesSection(panelId, branch) {
                return \`
                    <div class="branches-section">
                        <div class="branches-title">
                            📚 Branches
                            <button class="add-branch-btn" onclick="window.app.showHelpMessage('\${panelId}')">+ Add</button>
                        </div>
                        
                        <div class="filter-buttons">
                            <button class="filter-btn all active" onclick="window.app.filterBranches('\${panelId}', 'all')">All</button>
                            <button class="filter-btn note" onclick="window.app.filterBranches('\${panelId}', 'note')">Note</button>
                            <button class="filter-btn explore" onclick="window.app.filterBranches('\${panelId}', 'explore')">Explore</button>
                            <button class="filter-btn promote" onclick="window.app.filterBranches('\${panelId}', 'promote')">Promote</button>
                        </div>
                        
                        <div class="branch-list" id="branches-\${panelId}">
                            \${this.generateBranchItems(panelId)}
                        </div>
                    </div>
                \`;
            }

            setupPanelDragging(panelId) {
                const panel = this.state.panels.get(panelId).element;
                const header = panel.querySelector('.panel-header');
                
                let isDragging = false;
                let dragStartX = 0;
                let dragStartY = 0;
                let panelStartX = 0;
                let panelStartY = 0;
                
                panel.addEventListener('dragstart', (e) => {
                    e.preventDefault();
                    return false;
                });
                
                const preventSelection = (e) => {
                    if (isDragging) {
                        e.preventDefault();
                        e.stopPropagation();
                        return false;
                    }
                };
                
                const handleMouseMove = (e) => {
                    if (!isDragging) return;
                    
                    e.preventDefault();
                    
                    const deltaX = (e.clientX - dragStartX) / this.canvasState.zoom;
                    const deltaY = (e.clientY - dragStartY) / this.canvasState.zoom;
                    
                    const newX = panelStartX + deltaX;
                    const newY = panelStartY + deltaY;
                    
                    panel.style.left = newX + 'px';
                    panel.style.top = newY + 'px';
                    
                    // Update position in data store
                    this.dataStore.update(panelId, {
                        position: { x: newX, y: newY }
                    });
                    
                    this.events.emit('panel-moved', {
                        panelId,
                        position: { x: newX, y: newY }
                    });
                    
                    this.updateConnections();
                };
                
                const handleMouseUp = () => {
                    if (!isDragging) return;
                    
                    isDragging = false;
                    panel.style.transition = '';
                    panel.classList.remove('dragging');
                    document.body.classList.remove('no-select');
                    
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                    document.removeEventListener('selectstart', preventSelection);
                    panel.removeEventListener('selectstart', preventSelection);
                    
                    this.updateMinimap();
                };
                
                header.addEventListener('mousedown', (e) => {
                    if (e.target.closest('.panel-close')) return;
                    
                    isDragging = true;
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    panelStartX = parseFloat(panel.style.left);
                    panelStartY = parseFloat(panel.style.top);
                    
                    panel.style.zIndex = ++this.state.panelZIndex;
                    panel.style.transition = 'none';
                    panel.classList.add('dragging');
                    document.body.classList.add('no-select');
                    
                    document.getElementById('annotation-toolbar').classList.remove('visible');
                    
                    document.addEventListener('selectstart', preventSelection);
                    panel.addEventListener('selectstart', preventSelection);
                    
                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp);
                    
                    e.preventDefault();
                    e.stopPropagation();
                });
            }

            generateBreadcrumb(branchId) {
                const breadcrumbs = [];
                let currentId = branchId;
                
                while (currentId && this.dataStore.has(currentId)) {
                    const branch = this.getBranch(currentId);
                    breadcrumbs.unshift({
                        id: currentId,
                        title: branch.title
                    });
                    currentId = branch.parentId;
                }
                
                if (breadcrumbs.length <= 1) return '';
                
                return breadcrumbs.map((crumb, index) => {
                    if (index === breadcrumbs.length - 1) {
                        return \`<span>\${crumb.title}</span>\`;
                    }
                    return \`<a href="#" class="breadcrumb-item" onclick="window.app.panToPanel('\${crumb.id}')">\${crumb.title}</a>\`;
                }).join('<span class="breadcrumb-separator">›</span>');
            }

            generateBranchItems(parentId) {
                const parent = this.getBranch(parentId);
                if (!parent || !parent.branches || parent.branches.length === 0) {
                    return '<div class="empty-branches">No branches yet.<br>Select text to create annotations!</div>';
                }

                const activeFilter = this.state.branchFilters.get(parentId) || 'all';
                
                const filteredBranches = parent.branches.filter(branchId => {
                    if (activeFilter === 'all') return true;
                    const branch = this.getBranch(branchId);
                    return branch && branch.type === activeFilter;
                });

                if (filteredBranches.length === 0) {
                    return \`<div class="empty-branches">No \${activeFilter} branches found.<br>Try selecting "All" or create new \${activeFilter} annotations!</div>\`;
                }

                return filteredBranches.map(branchId => {
                    const branch = this.getBranch(branchId);
                    const basePreview = branch.preview && branch.preview.trim()
                        ? branch.preview.trim()
                        : (branch.content ? String(branch.content).replace(/<[^>]*>/g, '').trim() : '');
                    const preview = basePreview.length > 100 ? basePreview.slice(0, 100) + '...' : basePreview;
                    
                    return \`
                        <div class="branch-item \${branch.type}" onclick="window.app.openBranch('\${branchId}', '\${parentId}')">
                            <div class="branch-name">\${this.getTypeIcon(branch.type)} \${branch.title}</div>
                            <div class="branch-preview">\${preview}</div>
                        </div>
                    \`;
                }).join('');
            }

            getTypeIcon(type) {
                const icons = { note: '📝', explore: '🔍', promote: '⭐', main: '📄' };
                return icons[type] || '📝';
            }

            openBranch(branchId, parentPanelId) {
                this.createBranchPanel(branchId, parentPanelId);
            }

            closeBranchPanel(branchId) {
                const panel = this.state.panels.get(branchId);
                if (panel) {
                    // Remove editor reference
                    this.state.editors.delete(branchId);
                    
                    panel.element.remove();
                    this.state.panels.delete(branchId);
                    
                    const index = this.state.panelOrder.indexOf(branchId);
                    if (index > -1) {
                        this.state.panelOrder.splice(index, 1);
                    }
                    
                    const branch = this.getBranch(branchId);
                    if (branch && branch.parentId) {
                        const count = this.state.childPositions.get(branch.parentId) || 0;
                        if (count > 0) {
                            this.state.childPositions.set(branch.parentId, count - 1);
                        }
                    }
                    
                    this.state.branchFilters.delete(branchId);
                    
                    this.events.emit('branch-deleted', { branchId });
                    
                    this.updateConnections();
                    this.updateMinimap();
                }
            }

            smoothPanToPanel(panelId) {
                const branch = this.getBranch(panelId);
                if (!branch) return;
                
                const targetX = window.innerWidth / 2 - (branch.position.x + this.PANEL_WIDTH / 2) * this.canvasState.zoom;
                const targetY = window.innerHeight / 2 - (branch.position.y + this.PANEL_HEIGHT / 2) * this.canvasState.zoom;
                
                this.animateToPosition(targetX, targetY);
            }

            panToPanel(panelId) {
                const panel = this.state.panels.get(panelId);
                if (panel) {
                    panel.element.style.zIndex = ++this.state.panelZIndex;
                }
                this.smoothPanToPanel(panelId);
            }

            animateToPosition(targetX, targetY) {
                const startX = this.canvasState.translateX;
                const startY = this.canvasState.translateY;
                const duration = 600;
                const startTime = Date.now();

                const animate = () => {
                    const elapsed = Date.now() - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    const eased = 1 - Math.pow(1 - progress, 3);

                    this.canvasState.translateX = startX + (targetX - startX) * eased;
                    this.canvasState.translateY = startY + (targetY - startY) * eased;

                    this.updateCanvasTransform();
                    this.updateMinimap();

                    if (progress < 1) {
                        requestAnimationFrame(animate);
                    }
                };

                animate();
            }

            setupPanelEvents(panelId) {
                const panel = this.state.panels.get(panelId).element;
                
                panel.addEventListener('mousedown', () => {
                    panel.style.zIndex = ++this.state.panelZIndex;
                });
            }

            handleAutoSave(panelId, content) {
                const indicator = document.getElementById(\`auto-save-\${panelId}\`);
                
                indicator.textContent = 'Saving...';
                indicator.classList.add('saving');
                indicator.classList.remove('saved');
                
                clearTimeout(window.autoSaveTimeout);
                window.autoSaveTimeout = setTimeout(() => {
                    // Update content in data store
                    this.dataStore.update(panelId, { content });
                    
                    indicator.textContent = 'Saved';
                    indicator.classList.remove('saving');
                    indicator.classList.add('saved');
                    
                    setTimeout(() => {
                        indicator.style.opacity = '0';
                        setTimeout(() => indicator.style.opacity = '1', 2000);
                    }, 1500);
                }, 500);
            }

            createAnnotation(type) {
                if (!this.state.selectedText || !this.state.selectedRange || !this.state.currentPanel) return;
                
                const newBranchId = \`\${this.state.currentPanel}-\${type}-\${Date.now()}\`;
                
                // Create annotation span
                const annotationSpan = document.createElement('span');
                annotationSpan.className = \`annotation \${type}\`;
                annotationSpan.setAttribute('data-branch', newBranchId);
                annotationSpan.textContent = this.state.selectedText;
                
                // Insert annotation
                this.state.selectedRange.deleteContents();
                this.state.selectedRange.insertNode(annotationSpan);
                
                // Add branch to data store
                const newBranchData = {
                    title: \`\${this.state.selectedText.substring(0, 40)}\${this.state.selectedText.length > 40 ? '...' : ''}\`,
                    type: type,
                    originalText: this.state.selectedText,
                    content: \`<p>Start your \${type} analysis here...</p>\`,
                    branches: [],
                    parentId: this.state.currentPanel,
                    isEditable: true,
                    position: { x: 0, y: 0 } // Will be set properly in createBranchPanel
                };
                
                this.addBranch(this.state.currentPanel, newBranchId, newBranchData);
                
                // Clear filter if needed
                const currentFilter = this.state.branchFilters.get(this.state.currentPanel) || 'all';
                if (currentFilter !== 'all' && currentFilter !== type) {
                    this.filterBranches(this.state.currentPanel, 'all');
                }
                
                // Clear selection
                window.getSelection().removeAllRanges();
                document.getElementById('annotation-toolbar').classList.remove('visible');
                
                // Auto-create and display panel
                this.createBranchPanel(newBranchId, this.state.currentPanel);
                
                this.state.selectedText = '';
                this.state.selectedRange = null;
                this.state.currentPanel = null;
            }

            updateConnections() {
                if (!this.canvasState.showConnections) return;
                
                const svg = document.getElementById('connections-svg');
                svg.innerHTML = svg.querySelector('defs').outerHTML;
                
                this.state.panels.forEach(panel => {
                    const branch = this.getBranch(panel.branchId);
                    if (branch && branch.parentId) {
                        const parentPanel = this.state.panels.get(branch.parentId);
                        if (parentPanel) {
                            this.drawConnection(panel.branchId, branch.parentId, branch.type, false);
                        }
                    }
                });
            }

            drawConnection(fromId, toId, type, isPreview) {
                const fromPanel = this.state.panels.get(toId);
                const toPanel = this.state.panels.get(fromId);
                const svg = document.getElementById('connections-svg');
                
                if (!fromPanel || !toPanel) return;
                
                const fromX = parseFloat(fromPanel.element.style.left) + this.PANEL_WIDTH;
                const fromY = parseFloat(fromPanel.element.style.top) + this.PANEL_HEIGHT / 2;
                const toX = parseFloat(toPanel.element.style.left);
                const toY = parseFloat(toPanel.element.style.top) + this.PANEL_HEIGHT / 2;
                
                const pathData = this.createSmoothCurve(fromX, fromY, toX, toY);
                
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', pathData);
                path.setAttribute('class', \`workflow-curve \${type} \${isPreview ? 'preview' : ''}\`);
                path.setAttribute('marker-end', \`url(#arrow-end-\${type})\`);
                
                svg.appendChild(path);
            }

            createSmoothCurve(fromX, fromY, toX, toY) {
                const dx = toX - fromX;
                const dy = toY - fromY;
                
                const tension = Math.min(Math.abs(dx) * 0.5, 150);
                const controlX1 = fromX + tension;
                const controlY1 = fromY;
                const controlX2 = toX - tension;
                const controlY2 = toY;
                
                return \`M \${fromX} \${fromY} C \${controlX1} \${controlY1}, \${controlX2} \${controlY2}, \${toX} \${toY}\`;
            }

            // Canvas controls
            resetView() {
                this.canvasState.zoom = 1;
                this.canvasState.translateX = -1000;
                this.canvasState.translateY = -1200;
                this.updateCanvasTransform();
                this.updateZoomDisplay();
                this.updateMinimap();
            }

            zoomIn() {
                this.canvasState.zoom = Math.min(2, this.canvasState.zoom * 1.2);
                this.updateCanvasTransform();
                this.updateZoomDisplay();
                this.updateMinimap();
            }

            zoomOut() {
                this.canvasState.zoom = Math.max(0.3, this.canvasState.zoom / 1.2);
                this.updateCanvasTransform();
                this.updateZoomDisplay();
                this.updateMinimap();
            }

            showAllBranches() {
                this.dataStore.forEach((branch, branchId) => {
                    if (branchId !== 'main' && !this.state.panels.has(branchId)) {
                        this.createBranchPanel(branchId, branch.parentId);
                    }
                });
            }

            organizeLayout() {
                this.state.childPositions.clear();
                
                const levels = new Map();
                levels.set(0, ['main']);
                
                let currentLevel = 0;
                while (true) {
                    const nextLevel = [];
                    const currentLevelPanels = levels.get(currentLevel) || [];
                    
                    currentLevelPanels.forEach(parentId => {
                        const parent = this.getBranch(parentId);
                        if (parent && parent.branches) {
                            parent.branches.forEach(branchId => {
                                if (this.state.panels.has(branchId)) {
                                    nextLevel.push(branchId);
                                }
                            });
                        }
                    });
                    
                    if (nextLevel.length === 0) break;
                    
                    currentLevel++;
                    levels.set(currentLevel, nextLevel);
                }
                
                levels.forEach((levelPanels, level) => {
                    levelPanels.forEach((panelId, index) => {
                        const panel = this.state.panels.get(panelId);
                        if (panel) {
                            const newX = 2000 + (level * this.PANEL_SPACING_X);
                            const newY = 1500 + (index * this.PANEL_SPACING_Y);
                            
                            panel.element.style.left = newX + 'px';
                            panel.element.style.top = newY + 'px';
                            
                            this.dataStore.update(panelId, {
                                position: { x: newX, y: newY }
                            });
                        }
                    });
                });
                
                this.updateConnections();
                this.updateMinimap();
            }

            closeAllBranches() {
                const branchPanels = [...this.state.panels.keys()].filter(id => id !== 'main');
                branchPanels.forEach(panelId => {
                    this.closeBranchPanel(panelId);
                });
                
                this.state.childPositions.clear();
                this.state.branchFilters.clear();
            }

            showHelpMessage(panelId) {
                alert(\`To create new branches:
1. Select any text in the editor
2. Choose annotation type from the toolbar
3. New panel will appear beside this one

Rich Text Features:
• Use the toolbar buttons for formatting
• Bold, Italic, Underline, Headings
• Lists, Quotes, Clear formatting
• Select text to create annotations

Filter branches:
• Click All/Note/Explore/Promote to filter displayed branches
• "All" shows all branch types (default)
• Individual type buttons show only that type\`);
            }

            updateMinimap() {
                const minimap = document.getElementById('minimap-content');
                const viewport = document.getElementById('minimap-viewport');
                
                minimap.querySelectorAll('.minimap-panel').forEach(p => p.remove());
                
                this.state.panels.forEach(panel => {
                    const branch = this.getBranch(panel.branchId);
                    const minimapPanel = document.createElement('div');
                    minimapPanel.className = \`minimap-panel \${branch.type}\`;
                    
                    const scale = 0.03;
                    minimapPanel.style.left = (branch.position.x * scale) + 'px';
                    minimapPanel.style.top = (branch.position.y * scale) + 'px';
                    minimapPanel.style.width = (this.PANEL_WIDTH * scale) + 'px';
                    minimapPanel.style.height = (this.PANEL_HEIGHT * scale) + 'px';
                    
                    minimap.appendChild(minimapPanel);
                });
                
                const viewportScale = 0.03;
                viewport.style.left = (-this.canvasState.translateX * viewportScale) + 'px';
                viewport.style.top = (-this.canvasState.translateY * viewportScale) + 'px';
                viewport.style.width = (window.innerWidth / this.canvasState.zoom * viewportScale) + 'px';
                viewport.style.height = (window.innerHeight / this.canvasState.zoom * viewportScale) + 'px';
            }

            toggleConnections() {
                this.canvasState.showConnections = !this.canvasState.showConnections;
                this.updateConnections();
                
                const toggleBtn = document.querySelector('.control-panel:nth-child(3) .control-btn');
                toggleBtn.classList.toggle('active', this.canvasState.showConnections);
            }

            filterBranches(panelId, filterType) {
                this.state.branchFilters.set(panelId, filterType);
                
                const panel = this.state.panels.get(panelId);
                if (panel) {
                    const filterButtons = panel.element.querySelectorAll('.filter-btn');
                    filterButtons.forEach(btn => {
                        btn.classList.remove('active');
                        if (btn.classList.contains(filterType)) {
                            btn.classList.add('active');
                        }
                    });
                }
                
                this.events.emit('filter-changed', { panelId, filterType });
                this.updateBranchList(panelId);
            }

            // Toggle editing mode for main panel
            toggleMainEditing(panelId) {
                const editor = this.state.editors.get(panelId);
                const branch = this.getBranch(panelId);
                
                if (editor && branch) {
                    const isCurrentlyEditable = editor.contentEditable === 'true';
                    const newEditableState = !isCurrentlyEditable;
                    
                    editor.contentEditable = newEditableState;
                    
                    // Update the button text
                    const toggleBtn = document.querySelector(\`#toolbar-\${panelId} .toolbar-btn.special\`);
                    if (toggleBtn) {
                        toggleBtn.innerHTML = newEditableState ? '💾 Save' : '📝 Edit';
                        toggleBtn.title = newEditableState ? 'Save Changes' : 'Edit Content';
                    }
                    
                    // Update branch data
                    this.dataStore.update(panelId, { isEditable: newEditableState });
                    
                    // Focus editor if now editable
                    if (newEditableState) {
                        editor.focus();
                    }
                }
            }
        }

        // Simple data store that mimics Yjs Y.Map behavior
        class DataStore {
            constructor() {
                this.data = new Map();
            }

            get(key) {
                return this.data.get(key);
            }

            set(key, value) {
                this.data.set(key, value);
            }

            has(key) {
                return this.data.has(key);
            }

            update(key, updates) {
                const existing = this.get(key) || {};
                this.set(key, { ...existing, ...updates });
            }

            forEach(callback) {
                this.data.forEach(callback);
            }
        }

        // Simple event emitter for reactive updates
        class EventEmitter {
            constructor() {
                this.events = {};
            }

            on(event, listener) {
                if (!this.events[event]) {
                    this.events[event] = [];
                }
                this.events[event].push(listener);
            }

            emit(event, data) {
                if (this.events[event]) {
                    this.events[event].forEach(listener => listener(data));
                }
            }

            off(event, listenerToRemove) {
                if (this.events[event]) {
                    this.events[event] = this.events[event].filter(listener => listener !== listenerToRemove);
                }
            }
        }

        // Hide toolbar when clicking elsewhere
        document.addEventListener('click', function(e) {
            if (!e.target.closest('.annotation-toolbar') && !e.target.closest('.rich-editor') && !e.target.closest('.rich-editor-wrapper')) {
                document.getElementById('annotation-toolbar').classList.remove('visible');
            }
        });

        // Initialize the app and expose it globally
        window.app = new AnnotationCanvas();
        window.app.initializeApp();
      `

      document.head.appendChild(script)
    }

    // Initialize immediately without external dependencies
    initializeApp()
  }, [])

  return (
    <div ref={containerRef}>
      <style jsx global>{`
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            overflow: hidden;
            height: 100vh;
        }

        .canvas-container {
            position: relative;
            width: 100vw;
            height: 100vh;
            cursor: grab;
            overflow: hidden;
        }

        .canvas-container.dragging {
            cursor: grabbing;
        }

        /* Prevent text selection during dragging */
        body.no-select,
        body.no-select * {
            user-select: none !important;
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            -webkit-touch-callout: none !important;
        }

        .infinite-canvas {
            position: absolute;
            width: 8000px;
            height: 4000px;
            transform-origin: 0 0;
            transition: transform 0.3s ease-out;
        }

        .canvas-grid {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            opacity: 0.02;
            background-image: 
                linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px);
            background-size: 40px 40px;
        }

        .panel {
            position: absolute;
            width: 800px;
            height: 600px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
            overflow: hidden;
            display: flex;
            flex-direction: column;
            transition: all 0.3s ease;
            border: 2px solid transparent;
            z-index: 1;
        }

        .panel.main {
            border-color: #667eea;
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.3);
        }

        .panel.note {
            border-color: #2196f3;
            box-shadow: 0 10px 30px rgba(33, 150, 243, 0.2);
        }

        .panel.explore {
            border-color: #ff9800;
            box-shadow: 0 10px 30px rgba(255, 152, 0, 0.2);
        }

        .panel.promote {
            border-color: #4caf50;
            box-shadow: 0 10px 30px rgba(76, 175, 80, 0.2);
        }

        .panel:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 40px rgba(0,0,0,0.2);
            z-index: 1000;
        }

        .panel-header {
            position: relative;
            background: rgba(255,255,255,0.05);
            color: #667eea;
            padding: 12px 16px;
            border-bottom: 1px solid rgba(102, 126, 234, 0.2);
            font-size: 14px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: grab;
            user-select: none;
        }
        
        .panel.dragging .panel-header {
            cursor: grabbing;
        }

        .panel-close {
            background: rgba(255, 71, 87, 0.1);
            border: 1px solid rgba(255, 71, 87, 0.3);
            color: #ff4757;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            cursor: pointer;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }

        .panel-close:hover {
            background: rgba(255, 71, 87, 0.2);
            border-color: #ff4757;
            transform: scale(1.1);
        }

        .editor-section {
            flex: 2;
            padding: 20px 25px 25px 25px;
            border-right: 1px solid #e9ecef;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        .editor-header {
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #f1f3f4;
        }

        .editor-title {
            font-size: 20px;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 8px;
        }

        .breadcrumb {
            display: flex;
            align-items: center;
            font-size: 12px;
            color: #6c757d;
            gap: 5px;
        }

        .breadcrumb-item {
            color: #667eea;
            cursor: pointer;
            text-decoration: none;
            padding: 2px 4px;
            border-radius: 3px;
            transition: background 0.2s ease;
        }

        .breadcrumb-item:hover {
            background: rgba(102, 126, 234, 0.1);
        }

        .breadcrumb-separator {
            color: #adb5bd;
        }

        .editor-content {
            flex: 1;
            overflow-y: auto;
        }

        .quoted-text {
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
            padding: 15px;
            border-left: 4px solid #2196f3;
            margin-bottom: 20px;
            font-style: italic;
            border-radius: 0 8px 8px 0;
            color: #1565c0;
            font-size: 14px;
        }

        /* Rich Text Editor Styles */
        .rich-editor-wrapper {
            background: #fafbfc;
            border: 1px solid #e1e8ed;
            border-radius: 8px;
            overflow: hidden;
        }

        .rich-toolbar {
            background: #f8f9fa;
            border-bottom: 1px solid #e1e8ed;
            padding: 8px 12px;
            display: flex;
            gap: 4px;
            flex-wrap: wrap;
        }

        .toolbar-btn {
            background: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 6px 10px;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
            min-width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .toolbar-btn:hover {
            background: #e9ecef;
            border-color: #adb5bd;
        }

        .toolbar-btn:active {
            background: #667eea;
            color: white;
            border-color: #667eea;
        }

        .toolbar-btn.special {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-color: #667eea;
            font-size: 10px;
            padding: 6px 8px;
        }

        .toolbar-btn.special:hover {
            background: linear-gradient(135deg, #5a6fd8 0%, #6a4190 100%);
        }

        .rich-editor {
            padding: 20px;
            min-height: 250px;
            font-family: 'Georgia', serif;
            line-height: 1.8;
            outline: none;
            font-size: 15px;
            color: #2c3e50;
        }

        .rich-editor:focus {
            outline: none;
        }

        .rich-editor p {
            margin-bottom: 16px;
        }

        .rich-editor h1, .rich-editor h2, .rich-editor h3 {
            margin-bottom: 12px;
            margin-top: 20px;
            font-weight: 600;
        }

        .rich-editor h1 { font-size: 24px; }
        .rich-editor h2 { font-size: 20px; }
        .rich-editor h3 { font-size: 18px; }

        .rich-editor ul, .rich-editor ol {
            margin-left: 20px;
            margin-bottom: 16px;
        }

        .rich-editor li {
            margin-bottom: 4px;
        }

        .rich-editor blockquote {
            border-left: 4px solid #667eea;
            padding-left: 16px;
            margin: 16px 0;
            font-style: italic;
            color: #6c757d;
        }

        .rich-editor strong {
            font-weight: 600;
        }

        .rich-editor em {
            font-style: italic;
        }

        .rich-editor u {
            text-decoration: underline;
        }

        .annotation {
            background: linear-gradient(135deg, #ffeaa7 0%, #fab1a0 100%);
            padding: 2px 6px;
            border-radius: 4px;
            cursor: pointer;
            position: relative;
            transition: all 0.3s ease;
            font-weight: 600;
            border-bottom: 2px solid transparent;
        }

        .annotation:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }

        .annotation.note {
            background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
            border-bottom-color: #2196f3;
            color: #1565c0;
        }

        .annotation.explore {
            background: linear-gradient(135deg, #fff3e0 0%, #ffcc80 100%);
            border-bottom-color: #ff9800;
            color: #ef6c00;
        }

        .annotation.promote {
            background: linear-gradient(135deg, #e8f5e8 0%, #c8e6c9 100%);
            border-bottom-color: #4caf50;
            color: #2e7d32;
        }

        .branches-section {
            flex: 1;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }

        .branches-title {
            color: white;
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .filter-buttons {
            display: flex;
            gap: 6px;
            margin-bottom: 16px;
            background: rgba(255,255,255,0.1);
            padding: 4px;
            border-radius: 8px;
        }

        .filter-btn {
            background: rgba(255,255,255,0.15);
            color: white;
            border: 1px solid rgba(255,255,255,0.2);
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 11px;
            font-weight: 500;
            transition: all 0.3s ease;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .filter-btn:hover {
            background: rgba(255,255,255,0.25);
            transform: translateY(-1px);
        }

        .filter-btn.active {
            background: rgba(255,255,255,0.35);
            border-color: rgba(255,255,255,0.5);
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        .add-branch-btn {
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 6px 12px;
            border-radius: 16px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            margin-left: auto;
            transition: all 0.3s ease;
        }

        .add-branch-btn:hover {
            background: rgba(255,255,255,0.3);
            transform: translateY(-1px);
        }

        .branch-list {
            flex: 1;
        }

        .branch-item {
            background: rgba(255,255,255,0.15);
            backdrop-filter: blur(10px);
            border-radius: 10px;
            padding: 15px;
            margin-bottom: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
            border-left: 4px solid rgba(255,255,255,0.5);
        }

        .branch-item:hover {
            background: rgba(255,255,255,0.25);
            transform: translateX(5px);
        }

        .branch-item.note {
            border-left-color: #64b5f6;
        }

        .branch-item.explore {
            border-left-color: #ffb74d;
        }

        .branch-item.promote {
            border-left-color: #81c784;
        }

        .branch-name {
            color: white;
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .branch-preview {
            color: rgba(255,255,255,0.85);
            font-size: 12px;
            line-height: 1.4;
        }

        .empty-branches {
            text-align: center;
            color: rgba(255,255,255,0.6);
            font-style: italic;
            padding: 40px 20px;
            font-size: 14px;
        }

        .connections-svg {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 0;
        }

        /* Smooth workflow curves */
        .workflow-curve {
            stroke: #00ff88;
            stroke-width: 3;
            fill: none;
            stroke-linecap: round;
            stroke-linejoin: round;
            filter: drop-shadow(0 0 6px rgba(0, 255, 136, 0.4));
            opacity: 0.9;
        }

        .workflow-curve.note {
            stroke: #2196f3;
            filter: drop-shadow(0 0 6px rgba(33, 150, 243, 0.4));
        }

        .workflow-curve.explore {
            stroke: #ff9800;
            filter: drop-shadow(0 0 6px rgba(255, 152, 0, 0.4));
        }

        .workflow-curve.promote {
            stroke: #4caf50;
            filter: drop-shadow(0 0 6px rgba(76, 175, 80, 0.4));
        }

        .workflow-curve.preview {
            stroke: #ff6b9d;
            stroke-dasharray: 8,4;
            animation: previewFlow 2s ease-in-out infinite;
            filter: drop-shadow(0 0 8px rgba(255, 107, 157, 0.6));
        }

        @keyframes previewFlow {
            0% { 
                opacity: 0.6; 
                stroke-width: 2; 
                stroke-dashoffset: 0;
            }
            50% { 
                opacity: 1; 
                stroke-width: 4;
                stroke-dashoffset: -12;
            }
            100% { 
                opacity: 0.6; 
                stroke-width: 2;
                stroke-dashoffset: -24;
            }
        }

        /* Connection end markers */
        .connection-marker {
            fill: #00ff88;
            stroke: none;
            filter: drop-shadow(0 0 3px rgba(0, 255, 136, 0.8));
        }

        .connection-marker.note { 
            fill: #2196f3;
            filter: drop-shadow(0 0 3px rgba(33, 150, 243, 0.8));
        }

        .connection-marker.explore { 
            fill: #ff9800;
            filter: drop-shadow(0 0 3px rgba(255, 152, 0, 0.8));
        }

        .connection-marker.promote { 
            fill: #4caf50;
            filter: drop-shadow(0 0 3px rgba(76, 175, 80, 0.8));
        }

        /* Connection points on panels */
        .connection-point {
            position: absolute;
            width: 8px;
            height: 8px;
            background: rgba(102, 126, 234, 0.6);
            border: 2px solid rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 5;
        }

        .panel:hover .connection-point {
            opacity: 0.8;
        }

        .connection-point.output {
            right: -6px;
            top: 50%;
            transform: translateY(-50%);
        }

        .connection-point.input {
            left: -6px;
            top: 50%;
            transform: translateY(-50%);
        }

        .canvas-controls {
            position: fixed;
            top: 60px;
            left: 20px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 1000;
        }

        .control-panel {
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(20px);
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
            border: 1px solid rgba(255,255,255,0.2);
            min-width: 160px;
        }

        .control-title {
            font-size: 11px;
            font-weight: 600;
            color: #6c757d;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .control-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.3s ease;
            width: 100%;
            margin-bottom: 6px;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .control-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
        }

        .control-btn:active {
            transform: translateY(0);
            box-shadow: 0 2px 10px rgba(102, 126, 234, 0.3);
        }

        .control-btn.active {
            background: linear-gradient(135deg, #00ff88 0%, #00b359 100%);
            box-shadow: 0 4px 15px rgba(0, 255, 136, 0.3);
        }

        .zoom-display {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 6px;
            padding: 6px 8px;
            text-align: center;
            font-size: 12px;
            font-weight: 600;
            color: #495057;
        }

        .minimap {
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 200px;
            height: 120px;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(20px);
            border-radius: 12px;
            border: 1px solid rgba(255,255,255,0.2);
            overflow: hidden;
            z-index: 1000;
            box-shadow: 0 8px 32px rgba(0,0,0,0.1);
        }

        .minimap-content {
            width: 100%;
            height: 100%;
            position: relative;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
        }

        .minimap-panel {
            position: absolute;
            border-radius: 2px;
            border: 1px solid rgba(0,0,0,0.2);
        }

        .minimap-panel.main { background: #667eea; }
        .minimap-panel.note { background: #2196f3; }
        .minimap-panel.explore { background: #ff9800; }
        .minimap-panel.promote { background: #4caf50; }

        .minimap-viewport {
            position: absolute;
            border: 2px solid #667eea;
            background: rgba(102, 126, 234, 0.1);
            pointer-events: none;
        }

        .demo-header {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: rgba(0,0,0,0.9);
            backdrop-filter: blur(20px);
            color: white;
            padding: 12px 20px;
            font-size: 13px;
            font-weight: 500;
            z-index: 1000;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }

        .popup {
            position: fixed;
            background: rgba(0,0,0,0.9);
            backdrop-filter: blur(20px);
            color: white;
            border-radius: 10px;
            padding: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            z-index: 2000;
            max-width: 320px;
            display: none;
            border: 1px solid rgba(255,255,255,0.2);
        }

        .popup.visible {
            display: block;
            animation: popupShow 0.3s ease;
        }

        @keyframes popupShow {
            from {
                opacity: 0;
                transform: translateY(10px) scale(0.95);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }

        .popup-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: #fff;
        }

        .popup-text {
            font-size: 13px;
            line-height: 1.5;
            color: rgba(255,255,255,0.9);
        }

        .annotation-toolbar {
            position: fixed;
            background: rgba(0,0,0,0.9);
            backdrop-filter: blur(20px);
            border-radius: 10px;
            padding: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            z-index: 2000;
            display: none;
            border: 1px solid rgba(255,255,255,0.2);
        }

        .annotation-toolbar.visible {
            display: flex;
            gap: 8px;
            animation: popupShow 0.3s ease;
        }

        .annotation-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.3s ease;
        }

        .annotation-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }

        .annotation-btn.note { background: #2196f3; }
        .annotation-btn.explore { background: #ff9800; }
        .annotation-btn.promote { background: #4caf50; }

        .auto-save {
            position: absolute;
            top: 12px;
            right: 15px;
            padding: 4px 8px;
            background: #28a745;
            color: white;
            border-radius: 12px;
            font-size: 10px;
            opacity: 0;
            transition: opacity 0.3s ease;
            z-index: 2;
        }

        .auto-save.saving {
            opacity: 1;
            background: #ffc107;
            color: #333;
        }

        .auto-save.saved {
            opacity: 1;
        }

        /* Scrollbar styling */
        .editor-content::-webkit-scrollbar,
        .branches-section::-webkit-scrollbar {
            width: 6px;
        }

        .editor-content::-webkit-scrollbar-track,
        .branches-section::-webkit-scrollbar-track {
            background: rgba(0,0,0,0.05);
        }

        .editor-content::-webkit-scrollbar-thumb {
            background: rgba(0,0,0,0.2);
            border-radius: 3px;
        }

        .branches-section::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.3);
            border-radius: 3px;
        }
      `}</style>

      <div className="demo-header">
        🚀 Yjs-Ready Unified Knowledge Canvas • Collaborative-Ready Architecture with Rich Text
      </div>

      <div className="canvas-controls">
        <div className="control-panel">
          <div className="control-title">Navigation</div>
          <button className="control-btn" onClick={() => window.app?.resetView()}>
            🏠 Reset View
          </button>
          <button className="control-btn" onClick={() => window.app?.zoomIn()}>
            🔍 Zoom In
          </button>
          <button className="control-btn" onClick={() => window.app?.zoomOut()}>
            🔍 Zoom Out
          </button>
          <div className="zoom-display" id="zoom-display">
            100%
          </div>
        </div>

        <div className="control-panel">
          <div className="control-title">Panels</div>
          <button className="control-btn" onClick={() => window.app?.showAllBranches()}>
            📋 Show All
          </button>
          <button className="control-btn" onClick={() => window.app?.organizeLayout()}>
            🗂️ Organize
          </button>
          <button className="control-btn" onClick={() => window.app?.closeAllBranches()}>
            ❌ Close All
          </button>
        </div>

        <div className="control-panel">
          <div className="control-title">Connections</div>
          <button className="control-btn active" onClick={() => window.app?.toggleConnections()}>
            Toggle Lines
          </button>
        </div>
      </div>

      <div className="minimap">
        <div className="minimap-content" id="minimap-content">
          <div className="minimap-viewport" id="minimap-viewport"></div>
        </div>
      </div>

      <div className="canvas-container" id="canvas-container">
        <div className="infinite-canvas" id="infinite-canvas">
          <div className="canvas-grid"></div>
          <svg className="connections-svg" id="connections-svg">
            <defs>
              <marker
                id="arrow-end"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" className="connection-marker" />
              </marker>
              <marker
                id="arrow-end-note"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" className="connection-marker note" />
              </marker>
              <marker
                id="arrow-end-explore"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" className="connection-marker explore" />
              </marker>
              <marker
                id="arrow-end-promote"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L0,6 L9,3 z" className="connection-marker promote" />
              </marker>
            </defs>
          </svg>
        </div>
      </div>

      <div className="popup" id="annotation-popup">
        <div className="popup-title">Branch Preview</div>
        <div className="popup-text" id="popup-text"></div>
      </div>

      <div className="annotation-toolbar" id="annotation-toolbar">
        <button className="annotation-btn note" onClick={() => window.app?.createAnnotation("note")}>
          📝 Note
        </button>
        <button className="annotation-btn explore" onClick={() => window.app?.createAnnotation("explore")}>
          🔍 Explore
        </button>
        <button className="annotation-btn promote" onClick={() => window.app?.createAnnotation("promote")}>
          ⭐ Promote
        </button>
      </div>
    </div>
  )
}
