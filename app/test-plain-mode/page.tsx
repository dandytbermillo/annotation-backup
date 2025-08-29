'use client'

import { useState, useEffect } from 'react'
import { PlainModeProvider } from '@/app/providers/plain-mode-provider'

export default function TestPlainMode() {
  const [logs, setLogs] = useState<string[]>([])
  const [testNoteId] = useState('550e8400-e29b-41d4-a716-446655440000') // Fixed UUID for testing
  
  useEffect(() => {
    // Ensure we're in plain mode
    localStorage.setItem('collab-mode', 'plain')
    
    // Capture console logs
    const originalLog = console.log
    console.log = (...args) => {
      originalLog(...args)
      setLogs(prev => [...prev, args.join(' ')])
    }
    
    return () => {
      console.log = originalLog
    }
  }, [])
  
  const runTest = async () => {
    setLogs(['Starting test...'])
    
    // Test 1: Save a document
    try {
      const saveResponse = await fetch('/api/postgres-offline/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId: testNoteId,
          panelId: 'main',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Test content saved at ' + new Date().toLocaleTimeString()
                  }
                ]
              }
            ]
          },
          version: 1
        })
      })
      
      const saveResult = await saveResponse.json()
      setLogs(prev => [...prev, 'Save result: ' + JSON.stringify(saveResult)])
      
      // Test 2: Load the document
      const loadResponse = await fetch(`/api/postgres-offline/documents/${testNoteId}/main`)
      const loadResult = await loadResponse.json()
      setLogs(prev => [...prev, 'Load result: ' + JSON.stringify(loadResult, null, 2)])
      
    } catch (error) {
      setLogs(prev => [...prev, 'Error: ' + error])
    }
  }
  
  return (
    <PlainModeProvider>
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Plain Mode Test</h1>
        
        <div className="mb-4">
          <button
            onClick={runTest}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Run Test
          </button>
        </div>
        
        <div className="bg-gray-100 p-4 rounded">
          <h2 className="font-bold mb-2">Console Logs:</h2>
          <div className="font-mono text-xs whitespace-pre-wrap">
            {logs.map((log, i) => (
              <div key={i}>{log}</div>
            ))}
          </div>
        </div>
        
        <div className="mt-8">
          <h2 className="font-bold mb-2">Test Scenario:</h2>
          <ol className="list-decimal list-inside space-y-2">
            <li>Click "Run Test" to save and load a document</li>
            <li>Check the console logs to see what happens</li>
            <li>The test uses a fixed noteId and panelId='main'</li>
          </ol>
        </div>
      </div>
    </PlainModeProvider>
  )
}