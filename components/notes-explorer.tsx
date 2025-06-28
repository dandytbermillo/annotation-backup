"use client"

import { useState, useEffect } from "react"
import { Trash2, Plus, FileText, Search, X, Home, ZoomIn, ZoomOut, ToggleLeft, ToggleRight } from "lucide-react"

interface Note {
  id: string
  title: string
  createdAt: Date
  lastModified: Date
}

interface NotesExplorerProps {
  onNoteSelect: (noteId: string) => void
  isOpen: boolean
  onClose: () => void
  // Navigation controls props
  zoom?: number
  onZoomIn?: () => void
  onZoomOut?: () => void
  onResetView?: () => void
  onToggleConnections?: () => void
  showConnections?: boolean
}

export function NotesExplorer({ 
  onNoteSelect, 
  isOpen, 
  onClose,
  zoom = 100,
  onZoomIn,
  onZoomOut,
  onResetView,
  onToggleConnections,
  showConnections = true
}: NotesExplorerProps) {
  const [notes, setNotes] = useState<Note[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")

  // Load notes from localStorage on mount
  useEffect(() => {
    const savedNotes = localStorage.getItem('annotation-notes')
    if (savedNotes) {
      const parsed = JSON.parse(savedNotes)
      setNotes(parsed.map((note: any) => ({
        ...note,
        createdAt: new Date(note.createdAt),
        lastModified: new Date(note.lastModified)
      })))
    } else {
      // Create a default note if none exist
      const defaultNote: Note = {
        id: 'default-note',
        title: 'AI in Healthcare Research',
        createdAt: new Date(),
        lastModified: new Date()
      }
      setNotes([defaultNote])
      localStorage.setItem('annotation-notes', JSON.stringify([defaultNote]))
      
      // Store the default AI healthcare data for this note
      const defaultData = {
        'main': {
          title: 'AI in Healthcare Research',
          type: 'main',
          content: `
            <p>The integration of <span class="annotation note" data-branch="ai-integration">artificial intelligence in healthcare systems</span> represents a paradigm shift in medical practice. Recent studies have shown that <span class="annotation explore" data-branch="diagnostic-accuracy">AI diagnostic tools can achieve 94% accuracy</span> in certain medical imaging tasks.</p>
            
            <p>However, the implementation faces significant challenges. <span class="annotation promote" data-branch="ethical-concerns">Ethical considerations around patient privacy and algorithmic bias</span> remain paramount concerns for healthcare institutions.</p>
            
            <p>The economic impact is substantial, with <span class="annotation note" data-branch="cost-savings">projected cost savings of $150 billion annually</span> by 2026 through improved efficiency and reduced diagnostic errors.</p>
          `,
          branches: ['ai-integration', 'diagnostic-accuracy', 'ethical-concerns', 'cost-savings'],
          position: { x: 2000, y: 1500 },
          isEditable: false
        },
        'ai-integration': {
          title: 'AI Integration Analysis',
          type: 'note',
          originalText: 'artificial intelligence in healthcare systems',
          content: `<p>The integration requires careful consideration of existing infrastructure, staff training, and regulatory compliance. Key factors include interoperability with current EMR systems, data standardization protocols, and the establishment of clear governance frameworks.</p><p>A phased implementation approach is recommended, starting with pilot programs in controlled environments before full-scale deployment.</p>`,
          branches: [],
          parentId: 'main',
          position: { x: 2900, y: 1200 },
          isEditable: true
        },
        'diagnostic-accuracy': {
          title: 'Diagnostic Accuracy Deep Dive',
          type: 'explore',
          originalText: 'AI diagnostic tools can achieve 94% accuracy',
          content: `<p>This 94% accuracy rate is particularly impressive when compared to traditional diagnostic methods. The study analyzed performance across radiology, pathology, and dermatology. However, accuracy varies significantly by medical specialty and image quality.</p><p>Further research needed on edge cases and rare conditions where AI may struggle with limited training data.</p>`,
          branches: [],
          parentId: 'main',
          position: { x: 2900, y: 1850 },
          isEditable: true
        },
        'ethical-concerns': {
          title: 'Critical Ethical Framework',
          type: 'promote',
          originalText: 'Ethical considerations around patient privacy and algorithmic bias',
          content: `<p><strong>CRITICAL:</strong> These ethical frameworks should be mandatory industry standards. Privacy-preserving AI techniques like federated learning and differential privacy must be implemented.</p><p>Algorithmic bias testing should be continuous, not one-time. Recommend immediate policy adoption.</p>`,
          branches: [],
          parentId: 'main',
          position: { x: 2900, y: 2500 },
          isEditable: true
        },
        'cost-savings': {
          title: 'Economic Impact Analysis',
          type: 'note',
          originalText: 'projected cost savings of $150 billion annually',
          content: `<p>This $150B projection breaks down as: $60B from reduced diagnostic errors, $45B from improved efficiency, $30B from preventive care improvements, and $15B from administrative automation.</p><p>Timeline assumes 60% adoption rate by 2026.</p>`,
          branches: [],
          parentId: 'main',
          position: { x: 2900, y: 3150 },
          isEditable: true
        }
      }
      
      localStorage.setItem('note-data-default-note', JSON.stringify(defaultData))
    }
  }, [])

  // Save notes to localStorage whenever they change
  const saveNotes = (updatedNotes: Note[]) => {
    setNotes(updatedNotes)
    localStorage.setItem('annotation-notes', JSON.stringify(updatedNotes))
  }

  const createNewNote = () => {
    const newNote: Note = {
      id: `note-${Date.now()}`,
      title: `New Note ${notes.length + 1}`,
      createdAt: new Date(),
      lastModified: new Date()
    }
    saveNotes([...notes, newNote])
  }

  const deleteNote = (noteId: string) => {
    if (confirm('Are you sure you want to delete this note?')) {
      const updatedNotes = notes.filter(note => note.id !== noteId)
      saveNotes(updatedNotes)
      
      // If the deleted note was selected, clear selection
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null)
      }
      
      // Also remove the note's data from localStorage
      localStorage.removeItem(`note-data-${noteId}`)
    }
  }

  const handleNoteSelect = (noteId: string) => {
    setSelectedNoteId(noteId)
    onNoteSelect(noteId)
  }

  const filteredNotes = notes.filter(note =>
    note.title.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const startEditingTitle = (noteId: string, currentTitle: string) => {
    setEditingNoteId(noteId)
    setEditingTitle(currentTitle)
  }

  const saveTitle = (noteId: string) => {
    if (editingTitle.trim()) {
      const updatedNotes = notes.map(note =>
        note.id === noteId
          ? { ...note, title: editingTitle.trim(), lastModified: new Date() }
          : note
      )
      saveNotes(updatedNotes)
    }
    setEditingNoteId(null)
    setEditingTitle("")
  }

  const cancelEditing = () => {
    setEditingNoteId(null)
    setEditingTitle("")
  }

  return (
    <div 
      className={`h-screen w-80 bg-gray-900 text-white flex flex-col border-r border-gray-800 fixed left-0 top-0 z-50 transition-transform duration-300 ease-in-out ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Notes</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-800 rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Search notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Notes List */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            {searchTerm ? 'No notes found' : 'No notes yet'}
          </div>
        ) : (
          <div className="p-2">
            {filteredNotes.map(note => (
              <div
                key={note.id}
                onClick={() => handleNoteSelect(note.id)}
                className={`group p-3 mb-2 rounded-lg cursor-pointer transition-all ${
                  selectedNoteId === note.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 hover:bg-gray-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <FileText size={16} />
                      {editingNoteId === note.id ? (
                        <input
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => saveTitle(note.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveTitle(note.id)
                            } else if (e.key === 'Escape') {
                              cancelEditing()
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-gray-700 px-2 py-1 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          autoFocus
                        />
                      ) : (
                        <h3
                          className="font-medium truncate"
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            startEditingTitle(note.id, note.title)
                          }}
                        >
                          {note.title}
                        </h3>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      Modified {note.lastModified.toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteNote(note.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-600 rounded transition-all"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Note Button */}
      <div className="p-4 border-t border-gray-800">
        <button
          onClick={createNewNote}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors mb-4"
        >
          <Plus size={18} />
          <span>Create New Note</span>
        </button>
      </div>

      {/* Navigation Controls */}
      {selectedNoteId && (
        <div className="px-4 pb-4">
          {/* Navigation Section */}
          <div className="mb-4">
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Navigation</div>
            <div className="space-y-2">
              <button
                onClick={onResetView}
                className="w-full flex items-center gap-3 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
              >
                <Home size={16} />
                <span>Reset View</span>
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onZoomIn}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
                >
                  <ZoomIn size={16} />
                  <span>Zoom In</span>
                </button>
                <button
                  onClick={onZoomOut}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors"
                >
                  <ZoomOut size={16} />
                  <span>Zoom Out</span>
                </button>
              </div>
              <div className="text-center py-2 px-3 bg-gray-800 rounded-lg text-sm font-medium text-gray-300">
                {Math.round(zoom)}%
              </div>
            </div>
          </div>

          {/* Connections Section */}
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Connections</div>
            <button
              onClick={onToggleConnections}
              className={`w-full flex items-center justify-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                showConnections
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
              }`}
            >
              {showConnections ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
              <span>Toggle Lines</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
} 