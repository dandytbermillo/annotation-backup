'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CheckCircle, AlertCircle, FileText, Sparkles, FileCode } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamic import for the editor to avoid SSR issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const COMPANION_URL = process.env.NEXT_PUBLIC_COMPANION_URL || 'http://localhost:4000';

interface ValidationResult {
  valid: boolean;
  missingFields: string[];
  warnings: string[];
  log: string;
}

interface ReportCard {
  header_meta: {
    status: 'draft' | 'ready' | 'frozen';
    readiness_score: number;
    missing_fields: string[];
    confidence: number;
  };
  suggestions: string[];
  prp_gate: {
    allowed: boolean;
    reason: string;
    next_best_action: string;
  };
}

interface ContentPatch {
  section: string;
  suggestion: string;
  diff: string;
}

export default function ContextOSPage() {
  const searchParams = useSearchParams();
  const featureSlug = searchParams.get('feature') || 'new_feature';
  
  // State
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  // Validation state
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [reportCard, setReportCard] = useState<ReportCard | null>(null);
  const [contentPatches, setContentPatches] = useState<ContentPatch[]>([]);
  
  // UI state
  const [activeTab, setActiveTab] = useState('editor');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isFilling, setIsFilling] = useState(false);
  const [isCreatingPRP, setIsCreatingPRP] = useState(false);
  
  // Load draft on mount
  useEffect(() => {
    loadDraft();
  }, [featureSlug]);
  
  // Autosave
  useEffect(() => {
    if (isDirty) {
      const timer = setTimeout(() => {
        saveDraft();
      }, 1000); // Save after 1 second of no typing
      
      return () => clearTimeout(timer);
    }
  }, [content, isDirty]);
  
  // Auto-validate
  useEffect(() => {
    if (content) {
      const timer = setTimeout(() => {
        validateContent();
      }, 800); // Validate after 800ms of no typing
      
      return () => clearTimeout(timer);
    }
  }, [content]);
  
  async function loadDraft() {
    try {
      const res = await fetch(`${COMPANION_URL}/api/draft/${featureSlug}`);
      const data = await res.json();
      setContent(data.content);
      setOriginalContent(data.content);
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to load draft:', error);
    }
  }
  
  async function saveDraft() {
    if (!isDirty) return;
    
    setIsSaving(true);
    try {
      await fetch(`${COMPANION_URL}/api/draft/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: featureSlug, content })
      });
      
      setIsDirty(false);
      setLastSaved(new Date());
    } catch (error) {
      console.error('Failed to save draft:', error);
    } finally {
      setIsSaving(false);
    }
  }
  
  async function validateContent() {
    try {
      const res = await fetch(`${COMPANION_URL}/api/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: featureSlug, content })
      });
      
      const result = await res.json();
      setValidationResult(result);
    } catch (error) {
      console.error('Validation failed:', error);
    }
  }
  
  // LLM Verify - Non-invasive quality check
  async function handleVerify() {
    setIsVerifying(true);
    try {
      const res = await fetch(`${COMPANION_URL}/api/llm/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: featureSlug,
          content,
          validationResult
        })
      });
      
      const card = await res.json();
      setReportCard(card);
      setActiveTab('report');
    } catch (error) {
      console.error('LLM Verify failed:', error);
      alert('Failed to verify with LLM');
    } finally {
      setIsVerifying(false);
    }
  }
  
  // LLM Fill - Suggest missing sections
  async function handleFill() {
    if (!validationResult?.missingFields?.length) {
      alert('No missing fields to fill');
      return;
    }
    
    setIsFilling(true);
    try {
      const res = await fetch(`${COMPANION_URL}/api/llm/fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: featureSlug,
          content,
          missingFields: validationResult?.missingFields || []
        })
      });
      
      const result = await res.json();
      setContentPatches(result.content_patches);
      setActiveTab('suggestions');
    } catch (error) {
      console.error('LLM Fill failed:', error);
      alert('Failed to get suggestions from LLM');
    } finally {
      setIsFilling(false);
    }
  }
  
  // Create PRP - Generate implementation plan
  async function handleCreatePRP() {
    // Check gate
    if (!reportCard?.prp_gate?.allowed && !confirm('INITIAL.md is not ready. Create draft PRP anyway?')) {
      return;
    }
    
    setIsCreatingPRP(true);
    try {
      // First, promote draft to final
      await fetch(`${COMPANION_URL}/api/draft/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: featureSlug })
      });
      
      // Then create PRP
      const res = await fetch(`${COMPANION_URL}/api/prp/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: featureSlug,
          initialContent: content
        })
      });
      
      const result = await res.json();
      alert(`PRP created at: ${result.prp_artifact.path}`);
      setActiveTab('prp');
    } catch (error) {
      console.error('PRP creation failed:', error);
      alert('Failed to create PRP');
    } finally {
      setIsCreatingPRP(false);
    }
  }
  
  // Apply a content patch
  function applyPatch(patch: ContentPatch) {
    const newContent = content + '\n\n' + patch.suggestion;
    setContent(newContent);
    setIsDirty(true);
    
    // Remove applied patch
    setContentPatches(patches => patches.filter(p => p.section !== patch.section));
  }
  
  // Readiness indicator
  const readinessScore = reportCard?.header_meta?.readiness_score || 0;
  const readinessColor = readinessScore >= 8 ? 'text-green-500' : 
                         readinessScore >= 5 ? 'text-yellow-500' : 'text-red-500';
  
  return (
    <div className="container mx-auto p-4 max-w-7xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Context-OS Editor</h1>
          <p className="text-muted-foreground">Feature: {featureSlug.replace(/_/g, ' ')}</p>
        </div>
        
        {/* Status Bar */}
        <div className="flex items-center gap-4">
          {validationResult && (
            <Badge variant={validationResult.valid ? "default" : "destructive"}>
              {validationResult?.valid ? 'Valid' : `${validationResult?.missingFields?.length || 0} Missing`}
            </Badge>
          )}
          
          {reportCard && (
            <div className={`flex items-center gap-2 ${readinessColor}`}>
              <span className="font-semibold">Readiness: {readinessScore}/10</span>
            </div>
          )}
          
          {isSaving && <span className="text-sm text-muted-foreground">Saving...</span>}
          {lastSaved && !isSaving && (
            <span className="text-sm text-muted-foreground">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      <div className="grid grid-cols-3 gap-4">
        {/* Editor Panel (2 cols) */}
        <div className="col-span-2">
          <Card className="h-[700px]">
            <CardHeader>
              <CardTitle>INITIAL.md Editor</CardTitle>
              <div className="flex gap-2 mt-4">
                {/* The Three Buttons */}
                <Button
                  onClick={handleVerify}
                  disabled={isVerifying}
                  variant="outline"
                  className="gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  {isVerifying ? 'Verifying...' : 'LLM Verify'}
                </Button>
                
                <Button
                  onClick={handleFill}
                  disabled={isFilling || !validationResult?.missingFields?.length}
                  variant="outline"
                  className="gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  {isFilling ? 'Getting Suggestions...' : 'LLM Fill'}
                </Button>
                
                <Button
                  onClick={handleCreatePRP}
                  disabled={isCreatingPRP}
                  variant={reportCard?.prp_gate?.allowed ? "default" : "secondary"}
                  className="gap-2"
                >
                  <FileCode className="w-4 h-4" />
                  {isCreatingPRP ? 'Creating PRP...' : 
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
                  renderWhitespace: 'selection'
                }}
              />
            </CardContent>
          </Card>
        </div>
        
        {/* Side Panel (1 col) */}
        <div className="col-span-1">
          <Card className="h-[700px]">
            <CardHeader>
              <CardTitle>LLM Assistant</CardTitle>
            </CardHeader>
            
            <CardContent className="h-[calc(100%-80px)] overflow-auto">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="report">Report</TabsTrigger>
                  <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
                  <TabsTrigger value="prp">PRP</TabsTrigger>
                </TabsList>
                
                <TabsContent value="report" className="space-y-4">
                  {reportCard ? (
                    <>
                      {/* Report Card */}
                      <div className="space-y-2">
                        <h3 className="font-semibold">Quality Report</h3>
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span>Status:</span>
                            <Badge>{reportCard?.header_meta?.status || 'unknown'}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Readiness:</span>
                            <span className={readinessColor}>
                              {reportCard?.header_meta?.readiness_score || 0}/10
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Confidence:</span>
                            <span>{((reportCard?.header_meta?.confidence || 0) * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Missing Fields */}
                      {reportCard?.header_meta?.missing_fields?.length > 0 && (
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            <strong>Missing:</strong> {reportCard?.header_meta?.missing_fields?.join(', ') || ''}
                          </AlertDescription>
                        </Alert>
                      )}
                      
                      {/* Suggestions */}
                      <div className="space-y-2">
                        <h3 className="font-semibold">Suggestions</h3>
                        <ul className="list-disc list-inside space-y-1">
                          {(reportCard?.suggestions || []).map((suggestion, i) => (
                            <li key={i} className="text-sm">{suggestion}</li>
                          ))}
                        </ul>
                      </div>
                      
                      {/* PRP Gate */}
                      <Alert variant={reportCard?.prp_gate?.allowed ? "default" : "destructive"}>
                        <AlertDescription>
                          <strong>PRP Status:</strong> {reportCard?.prp_gate?.reason || 'Not evaluated'}
                          <br />
                          <strong>Next:</strong> {reportCard?.prp_gate?.next_best_action || 'Run verification'}
                        </AlertDescription>
                      </Alert>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      Click "LLM Verify" to get a quality report
                    </p>
                  )}
                </TabsContent>
                
                <TabsContent value="suggestions" className="space-y-4">
                  {contentPatches.length > 0 ? (
                    <div className="space-y-4">
                      <h3 className="font-semibold">Content Suggestions</h3>
                      {contentPatches.map((patch, i) => (
                        <Card key={i}>
                          <CardHeader className="py-2">
                            <div className="flex justify-between items-center">
                              <span className="font-semibold">{patch.section}</span>
                              <Button
                                size="sm"
                                onClick={() => applyPatch(patch)}
                              >
                                Apply
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="py-2">
                            <pre className="text-xs bg-muted p-2 rounded">
                              {patch.diff}
                            </pre>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">
                      Click "LLM Fill" to get content suggestions for missing sections
                    </p>
                  )}
                </TabsContent>
                
                <TabsContent value="prp" className="space-y-4">
                  <p className="text-muted-foreground">
                    {reportCard?.prp_gate?.allowed ? 
                     'Ready to generate PRP. Click "Create PRP" to proceed.' :
                     'Complete missing sections before generating PRP.'}
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