'use client'

import { useState, useEffect, useCallback } from 'react'
import { 
  Clock, 
  RotateCcw, 
  ChevronDown, 
  ChevronRight,
  FileText,
  GitBranch,
  AlertCircle,
  Check,
  X,
  Download
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatDistanceToNow } from 'date-fns'

interface Version {
  id: string
  version: number
  size_bytes: string
  created_at: string
  updated_at: string
  is_current: boolean
}

interface VersionComparison {
  identical: boolean
  stats: {
    additions: number
    deletions: number
    changes: number
  }
  diff: any[]
  diffType: string
}

interface VersionHistoryProps {
  noteId: string
  panelId: string
  onRestore?: (version: number) => void
  onVersionSelect?: (version: number) => void
  className?: string
}

export function VersionHistoryPanel({ 
  noteId, 
  panelId, 
  onRestore,
  onVersionSelect,
  className 
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)
  const [selectedVersions, setSelectedVersions] = useState<[number, number] | null>(null)
  const [comparison, setComparison] = useState<VersionComparison | null>(null)
  const [showDiff, setShowDiff] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [showRestoreDialog, setShowRestoreDialog] = useState(false)
  const [versionToRestore, setVersionToRestore] = useState<number | null>(null)
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set())
  
  // Fetch versions
  useEffect(() => {
    fetchVersions()
  }, [noteId, panelId])
  
  const fetchVersions = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/versions/${noteId}/${panelId}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch versions')
      }
      
      const data = await response.json()
      setVersions(data.versions)
      setCurrentVersion(data.current?.version || null)
    } catch (err) {
      console.error('Failed to fetch versions:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch versions')
    } finally {
      setLoading(false)
    }
  }
  
  // Handle restore
  const handleRestore = async (version: number) => {
    setRestoring(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/versions/${noteId}/${panelId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', version })
      })
      
      if (!response.ok) {
        throw new Error('Failed to restore version')
      }
      
      const data = await response.json()
      
      // Refresh versions list
      await fetchVersions()
      
      // Callback
      onRestore?.(data.new_version)
      
      // Close dialog
      setShowRestoreDialog(false)
      setVersionToRestore(null)
    } catch (err) {
      console.error('Failed to restore version:', err)
      setError(err instanceof Error ? err.message : 'Failed to restore version')
    } finally {
      setRestoring(false)
    }
  }
  
  // Compare two versions
  const handleCompare = async (v1: number, v2: number) => {
    try {
      const response = await fetch('/api/versions/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          panelId,
          version1: v1,
          version2: v2,
          diffType: 'unified'
        })
      })
      
      if (!response.ok) {
        throw new Error('Failed to compare versions')
      }
      
      const data = await response.json()
      setComparison(data)
      setSelectedVersions([v1, v2])
      setShowDiff(true)
    } catch (err) {
      console.error('Failed to compare versions:', err)
      setError(err instanceof Error ? err.message : 'Failed to compare versions')
    }
  }
  
  // Format file size
  const formatSize = (bytes: string) => {
    const size = parseInt(bytes)
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }
  
  // Toggle version expansion
  const toggleVersionExpanded = (version: number) => {
    const newExpanded = new Set(expandedVersions)
    if (newExpanded.has(version)) {
      newExpanded.delete(version)
    } else {
      newExpanded.add(version)
    }
    setExpandedVersions(newExpanded)
  }
  
  // Export version as JSON
  const exportVersion = async (version: number) => {
    try {
      const response = await fetch(`/api/versions/${noteId}/${panelId}?version=${version}`)
      if (!response.ok) throw new Error('Failed to fetch version')
      
      const data = await response.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `version-${version}-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Failed to export version:', err)
      setError('Failed to export version')
    }
  }
  
  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }
  
  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    )
  }
  
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Version History</h2>
        </div>
        <Badge variant="outline">
          {versions.length} versions
        </Badge>
      </div>
      
      {/* Diff Viewer */}
      {showDiff && comparison && (
        <Card className="border-blue-200">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">
                Comparing v{selectedVersions?.[0]} → v{selectedVersions?.[1]}
              </CardTitle>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowDiff(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {comparison.identical ? (
              <Alert>
                <Check className="h-4 w-4" />
                <AlertDescription>Versions are identical</AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="flex gap-4 mb-3 text-sm">
                  <span className="text-green-600">
                    +{comparison.stats.additions} additions
                  </span>
                  <span className="text-red-600">
                    -{comparison.stats.deletions} deletions
                  </span>
                  <span className="text-yellow-600">
                    ~{comparison.stats.changes} changes
                  </span>
                </div>
                <ScrollArea className="h-[200px] w-full border rounded p-2 bg-muted/20">
                  <div className="space-y-1 text-xs font-mono">
                    {comparison.diff.map((line: any, idx: number) => (
                      <div
                        key={idx}
                        className={`px-2 py-0.5 ${
                          line.type === 'added' ? 'bg-green-100 text-green-800' :
                          line.type === 'removed' ? 'bg-red-100 text-red-800' :
                          ''
                        }`}
                      >
                        <span className="select-none mr-2 text-muted-foreground">
                          {line.type === 'added' ? '+' :
                           line.type === 'removed' ? '-' : ' '}
                        </span>
                        {line.content}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Version List */}
      <ScrollArea className="h-[400px]">
        <div className="space-y-2">
          {versions.map((version, index) => (
            <Card
              key={version.id}
              className={`${version.is_current ? 'border-primary' : ''}`}
            >
              <Collapsible
                open={expandedVersions.has(version.version)}
                onOpenChange={() => toggleVersionExpanded(version.version)}
              >
                <CollapsibleTrigger className="w-full">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {expandedVersions.has(version.version) ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                        <div className="flex items-center gap-2">
                          <Badge variant={version.is_current ? "default" : "secondary"}>
                            v{version.version}
                          </Badge>
                          {version.is_current && (
                            <Badge variant="outline" className="text-xs">
                              Current
                            </Badge>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{formatSize(version.size_bytes)}</span>
                        <span>•</span>
                        <span>
                          {formatDistanceToNow(new Date(version.updated_at), { addSuffix: true })}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </CollapsibleTrigger>
                
                <CollapsibleContent>
                  <CardContent className="pt-0 pb-3 px-3">
                    <div className="flex gap-2 justify-end">
                      {!version.is_current && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCompare(version.version, currentVersion!)}
                          >
                            <GitBranch className="w-3 h-3 mr-1" />
                            Compare
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setVersionToRestore(version.version)
                              setShowRestoreDialog(true)
                            }}
                          >
                            <RotateCcw className="w-3 h-3 mr-1" />
                            Restore
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => exportVersion(version.version)}
                      >
                        <Download className="w-3 h-3 mr-1" />
                        Export
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onVersionSelect?.(version.version)}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        View
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))}
        </div>
      </ScrollArea>
      
      {/* Restore Confirmation Dialog */}
      <Dialog open={showRestoreDialog} onOpenChange={setShowRestoreDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Version {versionToRestore}?</DialogTitle>
            <DialogDescription>
              This will create a new version with the content from version {versionToRestore}.
              Your current version will not be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRestoreDialog(false)
                setVersionToRestore(null)
              }}
              disabled={restoring}
            >
              Cancel
            </Button>
            <Button
              onClick={() => versionToRestore && handleRestore(versionToRestore)}
              disabled={restoring}
            >
              {restoring ? 'Restoring...' : 'Restore Version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}