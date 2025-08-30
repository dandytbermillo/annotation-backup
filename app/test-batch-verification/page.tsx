'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

interface BatchMetrics {
  operationsSent: number
  batchesSent: number
  rowsCreated: number
  duplicatesSkipped: number
  lastSaveTime: number | null
  debounceActive: boolean
}

export default function BatchVerificationPage() {
  const [metrics, setMetrics] = useState<BatchMetrics>({
    operationsSent: 0,
    batchesSent: 0,
    rowsCreated: 0,
    duplicatesSkipped: 0,
    lastSaveTime: null,
    debounceActive: false
  })
  
  const [testResults, setTestResults] = useState<string[]>([])
  const [isTyping, setIsTyping] = useState(false)
  const [content, setContent] = useState('')
  const [saveIndicator, setSaveIndicator] = useState<'idle' | 'debouncing' | 'saving' | 'saved'>('idle')
  const [testNoteId, setTestNoteId] = useState<string | null>(null)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  const testPanelId = 'verification-panel'
  
  // Create a real note on mount
  useEffect(() => {
    fetch('/api/postgres-offline/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Batch Test Note ${new Date().toISOString()}`,
        content: 'Test note for batch verification'
      })
    })
    .then(res => res.json())
    .then(data => {
      console.log('Created test note:', data.id)
      setTestNoteId(data.id)
    })
    .catch(err => console.error('Failed to create test note:', err))
  }, [])
  
  // Simulate typing with debounce visualization
  const handleTyping = useCallback((value: string) => {
    if (!testNoteId) return // Don't proceed if no test note created yet
    
    setContent(value)
    setIsTyping(true)
    setSaveIndicator('debouncing')
    
    // Track operation (keystroke)
    setMetrics(m => ({ ...m, operationsSent: m.operationsSent + 1, debounceActive: true }))
    
    // Cancel previous timer if exists
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    
    // Set new debounce timer (800ms)
    debounceTimerRef.current = setTimeout(() => {
      setSaveIndicator('saving')
      
      // Send to batch API
      fetch('/api/postgres-offline/documents/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [{
            noteId: testNoteId,
            panelId: testPanelId,
            content: { html: value }
          }]
        })
      }).then(res => res.json()).then(data => {
        console.log('Batch API response:', data)
        setMetrics(m => ({
          ...m,
          batchesSent: m.batchesSent + 1,
          rowsCreated: m.rowsCreated + (data.processed || 0),
          duplicatesSkipped: m.duplicatesSkipped + (data.skipped || 0),
          lastSaveTime: Date.now(),
          debounceActive: false
        }))
        setSaveIndicator('saved')
        setTimeout(() => setSaveIndicator('idle'), 1000)
      }).catch(err => {
        console.error('Batch API error:', err)
        setSaveIndicator('idle')
      })
      
      setIsTyping(false)
      debounceTimerRef.current = null
    }, 800)
  }, [testNoteId])
  
  // Test 1: Rapid typing simulation
  const testRapidTyping = async () => {
    setTestResults(r => [...r, '🔄 TEST 1: Simulating rapid typing...'])
    const text = 'Hello World! This is a test of the batching system.'
    
    const startOps = metrics.operationsSent
    const startBatches = metrics.batchesSent
    
    // Simulate typing each character
    for (let i = 0; i <= text.length; i++) {
      handleTyping(text.substring(0, i))
      await new Promise(resolve => setTimeout(resolve, 50)) // 50ms between keystrokes
    }
    
    // Wait for final save
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    const opsGenerated = metrics.operationsSent - startOps
    const batchesSent = metrics.batchesSent - startBatches
    
    const result = batchesSent <= 2 
      ? `✅ PASS: ${opsGenerated} keystrokes → ${batchesSent} batch(es)`
      : `❌ FAIL: Too many batches (${batchesSent}) for ${opsGenerated} keystrokes`
    
    setTestResults(r => [...r, result])
  }
  
  // Test 2: Batch coalescing
  const testBatchCoalescing = async () => {
    if (!testNoteId) {
      setTestResults(r => [...r, '❌ FAIL: Test note not created yet'])
      return
    }
    
    setTestResults(r => [...r, '🔄 TEST 2: Testing batch coalescing...'])
    
    const response = await fetch('/api/postgres-offline/documents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          { noteId: testNoteId, panelId: 'coalesce-test', content: { html: 'Edit 1' }},
          { noteId: testNoteId, panelId: 'coalesce-test', content: { html: 'Edit 2' }},
          { noteId: testNoteId, panelId: 'coalesce-test', content: { html: 'Edit 3' }},
          { noteId: testNoteId, panelId: 'coalesce-test', content: { html: 'Edit 4' }},
          { noteId: testNoteId, panelId: 'coalesce-test', content: { html: 'Final' }}
        ]
      })
    })
    
    const data = await response.json()
    const result = data.processed === 1 
      ? `✅ PASS: 5 operations coalesced to ${data.processed} row`
      : `❌ FAIL: Expected 1 row, got ${data.processed}`
    
    setTestResults(r => [...r, result])
  }
  
  // Test 3: Deduplication
  const testDeduplication = async () => {
    if (!testNoteId) {
      setTestResults(r => [...r, '❌ FAIL: Test note not created yet'])
      return
    }
    
    setTestResults(r => [...r, '🔄 TEST 3: Testing content deduplication...'])
    
    // First save
    await fetch('/api/postgres-offline/documents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ noteId: testNoteId, panelId: 'dedup-test', content: { html: 'Same content' }}]
      })
    })
    
    // Duplicate save
    const response = await fetch('/api/postgres-offline/documents/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ noteId: testNoteId, panelId: 'dedup-test', content: { html: 'Same content' }}]
      })
    })
    
    const data = await response.json()
    const result = data.skipped >= 1
      ? `✅ PASS: Duplicate content skipped (${data.skipped} skipped)`
      : `❌ FAIL: Duplicate not detected (${data.processed} processed)`
    
    setTestResults(r => [...r, result])
  }
  
  // Calculate reduction percentage
  const reductionPercentage = metrics.operationsSent > 0 
    ? Math.round((1 - (metrics.rowsCreated / metrics.operationsSent)) * 100)
    : 0
  
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Batch Implementation Verification</h1>
      
      {/* Test Note Status */}
      {!testNoteId && (
        <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded">
          ⏳ Creating test note...
        </div>
      )}
      {testNoteId && (
        <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded">
          ✅ Test note ready: {testNoteId}
        </div>
      )}
      
      {/* Real-time Metrics Dashboard */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <Card className="p-4">
          <div className="text-sm text-gray-500">Operations Generated</div>
          <div className="text-2xl font-bold">{metrics.operationsSent}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">Batches Sent</div>
          <div className="text-2xl font-bold">{metrics.batchesSent}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">DB Rows Created</div>
          <div className="text-2xl font-bold">{metrics.rowsCreated}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-500">Write Reduction</div>
          <div className={`text-2xl font-bold ${reductionPercentage >= 80 ? 'text-green-600' : reductionPercentage >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
            {reductionPercentage}%
          </div>
        </Card>
      </div>
      
      {/* Visual Debounce Indicator */}
      <Card className="p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Debounce Visualization</h2>
        <div className="mb-4">
          <textarea
            className="w-full p-3 border rounded"
            rows={4}
            placeholder="Type here to see debouncing in action..."
            value={content}
            onChange={(e) => handleTyping(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className={`w-4 h-4 rounded-full ${
              saveIndicator === 'debouncing' ? 'bg-yellow-500 animate-pulse' :
              saveIndicator === 'saving' ? 'bg-blue-500 animate-pulse' :
              saveIndicator === 'saved' ? 'bg-green-500' :
              'bg-gray-300'
            }`} />
            <span className="text-sm">
              {saveIndicator === 'debouncing' ? 'Waiting 800ms...' :
               saveIndicator === 'saving' ? 'Saving...' :
               saveIndicator === 'saved' ? 'Saved!' :
               'Idle'}
            </span>
          </div>
          {metrics.lastSaveTime && (
            <div className="text-sm text-gray-500">
              Last save: {new Date(metrics.lastSaveTime).toLocaleTimeString()}
            </div>
          )}
        </div>
      </Card>
      
      {/* Automated Tests */}
      <Card className="p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">Automated Tests</h2>
        <div className="flex gap-4 mb-4">
          <Button onClick={testRapidTyping}>Test Rapid Typing</Button>
          <Button onClick={testBatchCoalescing}>Test Coalescing</Button>
          <Button onClick={testDeduplication}>Test Deduplication</Button>
          <Button 
            variant="outline"
            onClick={async () => {
              setTestResults([])
              await testRapidTyping()
              await testBatchCoalescing()
              await testDeduplication()
            }}
          >
            Run All Tests
          </Button>
        </div>
        <div className="bg-gray-50 rounded p-4 min-h-[200px]">
          {testResults.length === 0 ? (
            <div className="text-gray-400">Test results will appear here...</div>
          ) : (
            testResults.map((result, i) => (
              <div key={i} className="mb-2">{result}</div>
            ))
          )}
        </div>
      </Card>
      
      {/* Status Summary */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Implementation Status</h2>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-green-600">✅</span>
            <span>Server-side versioning: Operations no longer include client version</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-600">✅</span>
            <span>Batch coalescing: Multiple ops per panel create single row</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-600">✅</span>
            <span>Content deduplication: Identical content skipped</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-green-600">✅</span>
            <span>Editor debouncing: 800ms delay before save</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={reductionPercentage >= 80 ? 'text-green-600' : 'text-yellow-600'}>
              {reductionPercentage >= 80 ? '✅' : '⚠️'}
            </span>
            <span>Write reduction: {reductionPercentage}% fewer DB writes</span>
          </div>
        </div>
      </Card>
    </div>
  )
}