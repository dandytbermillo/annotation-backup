'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  CheckCircle, AlertCircle, FileText, Sparkles, FileCode, 
  Lock, RefreshCw, Save, AlertTriangle 
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const COMPANION_URL = process.env.NEXT_PUBLIC_COMPANION_URL || 'http://localhost:4000';

interface ReportCard {
  header_meta: {
    status: 'draft' | 'ready' | 'frozen';
    readiness_score: number;
    missing_fields: string[];
    confidence: number;
    last_validated_at: string;
  };
  suggestions: string[];
  prp_gate: {
    allowed: boolean;
    reason: string;
    next_best_action: string;
  };
  offline_mode?: boolean;
}

export default function ContextOSPageV2() {
  const searchParams = useSearchParams();
  const featureSlug = searchParams.get('feature') || 'new_feature';
  
  // State
  const [content, setContent] = useState('');
  const [etag, setEtag] = useState('');
  const [csrfToken, setCsrfToken] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [lockStatus, setLockStatus] = useState<any>(null);
  
  // Validation & verification
  const [validationResult, setValidationResult] = useState<any>(null);
  const [reportCard, setReportCard] = useState<ReportCard | null>(null);
  const [patches, setPatches] = useState<any[]>([]);
  
  // UI state
  const [activeTab, setActiveTab] = useState('editor');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [isCreatingPRP, setIsCreatingPRP] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Refs for debouncing
  const saveTimeout = useRef<NodeJS.Timeout>();
  const validateTimeout = useRef<NodeJS.Timeout>();
  
  // Initialize on mount
  useEffect(() => {
    initializeSession();
  }, [featureSlug]);
  
  // Auto-save with debouncing
  useEffect(() => {
    if (isDirty && content) {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => saveDraft(), 900);
    }
  }, [content, isDirty]);
  
  // Auto-validate after save
  useEffect(() => {
    if (content && !isDirty) {
      if (validateTimeout.current) clearTimeout(validateTimeout.current);
      validateTimeout.current = setTimeout(() => validateDraft(), 800);
    }
  }, [content, isDirty]);
  
  async function initializeSession() {
    try {
      // Get CSRF token first
      const tokenRes = await fetch(`${COMPANION_URL}/api/csrf`);
      const tokenData = await tokenRes.json();
      setCsrfToken(tokenData.token);
      
      // Then load draft
      await loadDraft();
    } catch (err) {
      setError('Failed to connect to companion service');
      console.error(err);
    }
  }
  
  async function loadDraft() {
    try {
      const res = await fetch(`${COMPANION_URL}/api/draft/${featureSlug}`, {
        headers: { 'Origin': 'http://localhost:3000' }
      });
      
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      
      const data = await res.json();
      setContent(data.content);
      setEtag(data.etag);
      setLockStatus(data.lockStatus);
      setIsDirty(false);
    } catch (err) {
      setError('Failed to load draft');
      console.error(err);
    }
  }
  
  async function saveDraft() {
    if (!isDirty || !csrfToken) return;
    
    setIsSaving(true);
    setError(null);
    
    try {
      const res = await fetch(`${COMPANION_URL}/api/draft/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ slug: featureSlug, content, etag })
      });
      
      if (res.status === 409) {
        // Stale ETag - reload and retry
        await loadDraft();
        return;
      }
      
      if (res.status === 423) {
        // Resource locked
        const data = await res.json();
        setLockStatus(data);
        setError(data.message);
        return;
      }
      
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      
      const data = await res.json();
      setEtag(data.etag);
      setIsDirty(false);
      setLastSaved(new Date());
    } catch (err) {
      setError('Failed to save');
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  }
  
  async function validateDraft() {
    if (!csrfToken || !etag) return;
    
    try {
      const res = await fetch(`${COMPANION_URL}/api/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ slug: featureSlug, etag })
      });
      
      if (!res.ok) return;
      
      const result = await res.json();
      setValidationResult(result);
    } catch (err) {
      console.error('Validation failed:', err);
    }
  }
  
  async function handleVerify() {
    setIsVerifying(true);
    setError(null);
    
    try {
      const res = await fetch(`${COMPANION_URL}/api/llm/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          slug: featureSlug,
          etag,
          validationResult
        })
      });
      
      if (!res.ok) throw new Error('Verification failed');
      
      const card = await res.json();
      setReportCard(card);
      setActiveTab('report');
    } catch (err) {
      setError('LLM verification failed - using local validation');
      console.error(err);
    } finally {
      setIsVerifying(false);
    }
  }
  
  async function handleFill() {
    if (!validationResult?.missing_fields?.length) {
      setError('No missing fields to fill');
      return;
    }
    
    setIsFilling(true);
    setError(null);
    
    try {
      // TODO: Implement LLM fill
      setPatches([
        {
          section: 'stakeholders',
          suggestion: '- Development Team\n- Product Team\n- QA Team',
          diff: '+ - Development Team\n+ - Product Team\n+ - QA Team'
        }
      ]);
      setActiveTab('suggestions');
    } catch (err) {
      setError('Fill suggestions failed');
      console.error(err);
    } finally {
      setIsFilling(false);
    }
  }
  
  async function handleCreatePRP() {
    const isReady = reportCard?.prp_gate?.allowed;
    
    if (!isReady) {
      const proceed = confirm(
        'INITIAL.md is not ready.\nMissing: ' + 
        (validationResult?.missing_fields?.join(', ') || 'unknown') + 
        '\n\nCreate draft PRP anyway?'
      );
      if (!proceed) return;
    }
    
    setIsCreatingPRP(true);
    setError(null);
    
    try {
      // Create PRP (draft or final)
      const prpRes = await fetch(`${COMPANION_URL}/api/prp/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost:3000',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          slug: featureSlug,
          mode: isReady ? 'strict' : 'draft',
          etag
        })
      });
      
      if (!prpRes.ok) throw new Error('PRP creation failed');
      
      const prpData = await prpRes.json();
      
      // Only promote if ready AND user approves
      if (isReady && confirm(`PRP created at: ${prpData.prp_artifact.path}\n\nPromote INITIAL.md to final?`)) {
        await fetch(`${COMPANION_URL}/api/draft/promote`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'http://localhost:3000',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify({
            slug: featureSlug,
            etag,
            approveHeader: true,
            approveContent: true
          })
        });
      }
      
      alert(`PRP ${isReady ? 'created' : 'draft created'} successfully!`);
      setActiveTab('prp');
    } catch (err) {
      setError('Failed to create PRP');
      console.error(err);
    } finally {
      setIsCreatingPRP(false);
    }
  }
  
  function applyPatch(patch: any) {
    // Simple append for now - should use section-scoped patching
    const newContent = content + '\n\n## ' + patch.section + '\n\n' + patch.suggestion;
    setContent(newContent);
    setIsDirty(true);
    setPatches(patches.filter(p => p.section !== patch.section));
  }
  
  // Status calculations
  const status = reportCard?.header_meta?.status || 'draft';
  const readinessScore = reportCard?.header_meta?.readiness_score || 0;
  const missingCount = validationResult?.missing_fields?.length || 0;
  
  const statusColor = 
    status === 'ready' ? 'bg-green-500' :
    status === 'frozen' ? 'bg-blue-500' : 'bg-yellow-500';
  
  const readinessColor = 
    readinessScore >= 7 ? 'text-green-500' :
    readinessScore >= 5 ? 'text-yellow-500' : 'text-red-500';
  
  return (
    <div className="container mx-auto p-4 max-w-7xl">
      {/* Header with Status Bar */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-3xl font-bold">Context-OS Editor V2</h1>
          <p className="text-muted-foreground">Feature: {featureSlug.replace(/_/g, ' ')}</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Badge className={statusColor}>{status.toUpperCase()}</Badge>
          
          {readinessScore > 0 && (
            <span className={`font-semibold ${readinessColor}`}>
              Readiness: {readinessScore}/10
            </span>
          )}
          
          {missingCount > 0 && (
            <Badge variant="destructive">
              {missingCount} missing
            </Badge>
          )}
          
          {validationResult?.tool_version && (
            <span className="text-xs text-muted-foreground">
              {validationResult.tool_version}
            </span>
          )}
          
          {isSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
          
          {lastSaved && !isSaving && (
            <span className="text-sm text-muted-foreground">
              <Save className="w-3 h-3 inline mr-1" />
              {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
      
      {/* Lock Banner */}
      {lockStatus && !lockStatus.acquired && (
        <Alert className="mb-4 border-yellow-500">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{lockStatus.message}</AlertDescription>
        </Alert>
      )}
      
      {/* Error Banner */}
      {error && (
        <Alert className="mb-4 border-red-500">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      {/* Frozen State Banner */}
      {status === 'frozen' && (
        <Alert className="mb-4 border-blue-500">
          <Lock className="h-4 w-4" />
          <AlertDescription>
            Document frozen - Implementation in progress. Semantic edits blocked.
            <Button size="sm" variant="outline" className="ml-4">
              Unfreeze
            </Button>
          </AlertDescription>
        </Alert>
      )}
      
      {/* Main Content Grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Editor Panel */}
        <div className="col-span-2">
          <Card className="h-[700px]">
            <CardHeader>
              <CardTitle>INITIAL.md Editor</CardTitle>
              <div className="flex gap-2 mt-4">
                {/* The Three Buttons */}
                <Button
                  onClick={handleVerify}
                  disabled={isVerifying || !csrfToken}
                  variant="outline"
                  className="gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  {isVerifying ? 'Verifying...' : 'LLM Verify'}
                </Button>
                
                <Button
                  onClick={handleFill}
                  disabled={isFilling || !missingCount}
                  variant="outline"
                  className="gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {isFilling ? 'Getting...' : `LLM Fill (${missingCount})`}
                </Button>
                
                <Button
                  onClick={handleCreatePRP}
                  disabled={isCreatingPRP || !csrfToken}
                  variant={reportCard?.prp_gate?.allowed ? "default" : "secondary"}
                  className="gap-2"
                >
                  <FileCode className="w-4 h-4" />
                  {isCreatingPRP ? 'Creating...' : 
                   reportCard?.prp_gate?.allowed ? 'Create PRP' : 'Create PRP (Draft)'}
                </Button>
              </div>
            </CardHeader>
            
            <CardContent className="h-[calc(100%-120px)]">
              <MonacoEditor
                value={content}
                onChange={(value) => {
                  setContent(value || '');
                  setIsDirty(true);
                }}
                language="markdown"
                theme="vs-light"
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  readOnly: status === 'frozen'
                }}
              />
            </CardContent>
          </Card>
        </div>
        
        {/* Side Panel */}
        <div className="col-span-1">
          <Card className="h-[700px]">
            <CardHeader>
              <CardTitle>LLM Assistant</CardTitle>
            </CardHeader>
            
            <CardContent className="h-[calc(100%-80px)] overflow-auto">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="report">Report</TabsTrigger>
                  <TabsTrigger value="suggestions">Fill</TabsTrigger>
                  <TabsTrigger value="prp">PRP</TabsTrigger>
                </TabsList>
                
                {/* Report Tab */}
                <TabsContent value="report" className="space-y-4">
                  {reportCard ? (
                    <>
                      <div className="space-y-2">
                        <h3 className="font-semibold">Quality Report</h3>
                        <div className="text-sm space-y-1">
                          <div className="flex justify-between">
                            <span>Status:</span>
                            <Badge>{reportCard.header_meta.status}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Readiness:</span>
                            <span className={readinessColor}>
                              {reportCard.header_meta.readiness_score}/10
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Confidence:</span>
                            <span>{(reportCard.header_meta.confidence * 100).toFixed(0)}%</span>
                          </div>
                          {reportCard.offline_mode && (
                            <Badge variant="outline">Offline Mode</Badge>
                          )}
                        </div>
                      </div>
                      
                      {reportCard.header_meta.missing_fields.length > 0 && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            <strong>Missing:</strong> {reportCard.header_meta.missing_fields.join(', ')}
                          </AlertDescription>
                        </Alert>
                      )}
                      
                      <div className="space-y-2">
                        <h3 className="font-semibold">Suggestions</h3>
                        <ul className="list-disc list-inside space-y-1">
                          {reportCard.suggestions.map((s, i) => (
                            <li key={i} className="text-sm">{s}</li>
                          ))}
                        </ul>
                      </div>
                      
                      <Alert variant={reportCard.prp_gate.allowed ? "default" : "destructive"}>
                        <AlertDescription>
                          <strong>PRP:</strong> {reportCard.prp_gate.reason}
                          <br />
                          <strong>Next:</strong> {reportCard.prp_gate.next_best_action}
                        </AlertDescription>
                      </Alert>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Click "LLM Verify" to get a quality report
                    </p>
                  )}
                </TabsContent>
                
                {/* Suggestions Tab */}
                <TabsContent value="suggestions" className="space-y-4">
                  {patches.length > 0 ? (
                    <div className="space-y-3">
                      {patches.map((patch, i) => (
                        <Card key={i}>
                          <CardHeader className="py-2">
                            <div className="flex justify-between items-center">
                              <span className="font-semibold text-sm">{patch.section}</span>
                              <Button
                                size="sm"
                                onClick={() => applyPatch(patch)}
                              >
                                Apply
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="py-2">
                            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                              {patch.diff}
                            </pre>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      Click "LLM Fill" for content suggestions
                    </p>
                  )}
                </TabsContent>
                
                {/* PRP Tab */}
                <TabsContent value="prp" className="space-y-4">
                  <p className="text-muted-foreground">
                    {reportCard?.prp_gate?.allowed ? 
                     'Ready to generate PRP' :
                     validationResult?.missing_fields?.length ?
                     `Complete missing sections: ${validationResult.missing_fields.join(', ')}` :
                     'Run verification first'}
                  </p>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}