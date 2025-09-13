'use client';

import { useState, useEffect } from 'react';

export default function TestPopupPage() {
  const [folders, setFolders] = useState<any[]>([]);

  useEffect(() => {
    // Fetch root folders
    fetch('/api/items?parentId=null')
      .then(res => res.json())
      .then(data => {
        if (data.items) {
          setFolders(data.items.filter((item: any) => item.type === 'folder'));
        }
      });
  }, []);

  const testHoverPopup = async (folder: any) => {
    console.log('Testing hover on folder:', folder);
    
    // Simulate what should happen when hovering
    const event = new MouseEvent('mouseenter', {
      clientX: 400,
      clientY: 300,
      bubbles: true
    });
    
    // Log to debug
    await fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'test-popup',
        action: 'hover_test',
        content_preview: `Testing hover on ${folder.name}`,
        metadata: { folderId: folder.id, folderName: folder.name }
      })
    });
    
    console.log('Hover test logged for:', folder.name);
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8">
      <h1 className="text-2xl font-bold mb-6">Popup Hover Test Page</h1>
      
      <div className="bg-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-4">Available Folders:</h2>
        
        {folders.length === 0 ? (
          <p className="text-gray-400">Loading folders...</p>
        ) : (
          <div className="space-y-2">
            {folders.map(folder => (
              <div
                key={folder.id}
                className="flex items-center justify-between p-3 bg-gray-700 rounded hover:bg-gray-600 cursor-pointer"
              >
                <span>{folder.name}</span>
                <button
                  onClick={() => testHoverPopup(folder)}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-sm"
                >
                  Test Hover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <div className="mt-8 bg-gray-800 rounded-lg p-4">
        <h2 className="text-lg font-semibold mb-2">Instructions:</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-300">
          <li>Click "Test Hover" to simulate hovering over a folder</li>
          <li>Check the browser console for debug output</li>
          <li>Check the /debug page to see logged events</li>
          <li>Navigate to the main app to test actual hover behavior</li>
        </ol>
      </div>
    </div>
  );
}