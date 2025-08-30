'use client'

import { useState, useEffect } from 'react'
import { 
  AlertTriangle, 
  FileText, 
  GitBranch,
  CheckCircle,
  XCircle,
  Info,
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ConflictInfo } from '@/lib/sync/conflict-detector'

interface ConflictResolutionDialogProps {
  conflict: ConflictInfo | null
  noteId: string
  panelId: string
  onResolve: (resolution: 'local' | 'remote' | 'merge' | 'force') => Promise<void>
  onCancel: () => void
  open: boolean
}

export function ConflictResolutionDialog({
  conflict,
  noteId,
  panelId,
  onResolve,
  onCancel,
  open
}: ConflictResolutionDialogProps) {
  const [selectedResolution, setSelectedResolution] = useState<'local' | 'remote' | 'merge' | 'force'>('local')
  const [isResolving, setIsResolving] = useState(false)
  const [comparison, setComparison] = useState<any>(null)
  const [loadingComparison, setLoadingComparison] = useState(false)
  
  // Load version comparison when conflict changes
  useEffect(() => {
    if (conflict && conflict.localVersion !== undefined && conflict.remoteVersion !== undefined) {
      loadComparison()
    }
  }, [conflict])
  
  const loadComparison = async () => {
    if (!conflict || conflict.localVersion === undefined || conflict.remoteVersion === undefined) {
      return
    }
    
    setLoadingComparison(true)
    try {
      const response = await fetch('/api/versions/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          panelId,
          version1: conflict.localVersion,
          version2: conflict.remoteVersion,
          diffType: 'unified'
        })
      })
      
      if (response.ok) {
        const data = await response.json()
        setComparison(data)
      }
    } catch (error) {
      console.error('Failed to load comparison:', error)
    } finally {
      setLoadingComparison(false)
    }
  }
  
  const handleResolve = async () => {
    setIsResolving(true)
    try {
      await onResolve(selectedResolution)
    } finally {
      setIsResolving(false)
    }
  }
  
  if (!conflict) return null
  
  // Get severity color
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'minor': return 'text-yellow-600 bg-yellow-50'
      case 'major': return 'text-orange-600 bg-orange-50'
      case 'critical': return 'text-red-600 bg-red-50'
      default: return 'text-gray-600 bg-gray-50'
    }
  }
  
  // Get conflict type label
  const getConflictTypeLabel = (type: string) => {
    switch (type) {
      case 'version_mismatch': return 'Version Conflict'
      case 'content_drift': return 'Content Drift'
      case 'deleted_remotely': return 'Deleted Remotely'
      case 'concurrent_edit': return 'Concurrent Edit'
      default: return 'Conflict Detected'
    }
  }
  
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            {getConflictTypeLabel(conflict.type)}
          </DialogTitle>
          <DialogDescription>
            {conflict.message}
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-auto space-y-4">
          {/* Conflict Info */}
          <div className="flex items-center gap-2">
            <Badge className={getSeverityColor(conflict.severity)}>
              {conflict.severity} severity
            </Badge>
            {conflict.localVersion !== undefined && conflict.remoteVersion !== undefined && (
              <>
                <Badge variant="outline">
                  Your version: {conflict.localVersion}
                </Badge>
                <Badge variant="outline">
                  Current version: {conflict.remoteVersion}
                </Badge>
              </>
            )}
          </div>
          
          {/* Comparison Tabs */}
          {comparison && !loadingComparison && (
            <Tabs defaultValue="diff" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="diff">Changes</TabsTrigger>
                <TabsTrigger value="stats">Statistics</TabsTrigger>
              </TabsList>
              
              <TabsContent value="diff" className="mt-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Version Differences</CardTitle>
                    <CardDescription className="text-xs">
                      Comparing your changes with the current version
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="h-[200px] w-full border rounded p-2 bg-muted/20">
                      {comparison.diff && comparison.diff.length > 0 ? (
                        <div className="space-y-1 text-xs font-mono">
                          {comparison.diff.slice(0, 50).map((line: any, idx: number) => (
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
                          {comparison.diff.length > 50 && (
                            <div className="text-center text-muted-foreground py-2">
                              ... and {comparison.diff.length - 50} more lines
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center text-muted-foreground py-4">
                          No differences found
                        </div>
                      )}
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>
              
              <TabsContent value="stats" className="mt-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-green-600">
                          +{comparison.stats?.additions || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Additions</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-red-600">
                          -{comparison.stats?.deletions || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Deletions</div>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-yellow-600">
                          ~{comparison.stats?.changes || 0}
                        </div>
                        <div className="text-xs text-muted-foreground">Changes</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
          
          {loadingComparison && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          
          {/* Resolution Options */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Choose Resolution</CardTitle>
              <CardDescription>
                Select how to resolve this conflict
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup 
                value={selectedResolution} 
                onValueChange={(value: any) => setSelectedResolution(value)}
              >
                <div className="space-y-3">
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="local" id="local" />
                    <div className="flex-1">
                      <Label htmlFor="local" className="flex items-center gap-2 cursor-pointer">
                        <FileText className="w-4 h-4" />
                        Keep Your Version
                        {conflict.suggestion === 'use_local' && (
                          <Badge variant="outline" className="text-xs">
                            Recommended
                          </Badge>
                        )}
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Use your local changes and overwrite the server version
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="remote" id="remote" />
                    <div className="flex-1">
                      <Label htmlFor="remote" className="flex items-center gap-2 cursor-pointer">
                        <FileText className="w-4 h-4" />
                        Use Server Version
                        {conflict.suggestion === 'use_remote' && (
                          <Badge variant="outline" className="text-xs">
                            Recommended
                          </Badge>
                        )}
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Discard your changes and use the current server version
                      </p>
                    </div>
                  </div>
                  
                  {conflict.canAutoResolve && (
                    <div className="flex items-start space-x-3">
                      <RadioGroupItem value="merge" id="merge" />
                      <div className="flex-1">
                        <Label htmlFor="merge" className="flex items-center gap-2 cursor-pointer">
                          <GitBranch className="w-4 h-4" />
                          Merge Both Versions
                          {conflict.suggestion === 'merge' && (
                            <Badge variant="outline" className="text-xs">
                              Recommended
                            </Badge>
                          )}
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Attempt to automatically combine both versions
                        </p>
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-start space-x-3">
                    <RadioGroupItem value="force" id="force" />
                    <div className="flex-1">
                      <Label htmlFor="force" className="flex items-center gap-2 cursor-pointer">
                        <AlertTriangle className="w-4 h-4" />
                        Force Save
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Override all checks and force save your version (use with caution)
                      </p>
                    </div>
                  </div>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>
          
          {/* Warning for force save */}
          {selectedResolution === 'force' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Force saving will overwrite the server version without any checks. 
                This may result in loss of other users' changes.
              </AlertDescription>
            </Alert>
          )}
        </div>
        
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isResolving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleResolve}
            disabled={isResolving}
          >
            {isResolving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Resolving...
              </>
            ) : (
              'Apply Resolution'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}