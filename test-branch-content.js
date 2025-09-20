#!/usr/bin/env node

// Test script to verify branch content saving behavior

const noteId = 'c816bcc3-8a22-4f6e-8588-5cedeb746b93';
const branchPanelId = 'branch-dd9614ae-fe88-59bc-b44a-521300d7dee0';

async function checkDocumentSaves() {
  try {
    const response = await fetch(
      `http://localhost:3000/api/postgres-offline/documents/${noteId}/${branchPanelId}`
    );
    
    if (!response.ok) {
      console.log(`❌ Failed to fetch: ${response.status} ${response.statusText}`);
      const text = await response.text();
      console.log('Response:', text.substring(0, 200));
      return;
    }
    
    const data = await response.json();
    console.log('✅ Document found:');
    console.log('Version:', data.version);
    console.log('Content type:', typeof data.content);
    
    if (typeof data.content === 'string') {
      console.log('Content (string):', data.content.substring(0, 200));
    } else if (data.content) {
      console.log('Content (JSON):', JSON.stringify(data.content, null, 2).substring(0, 500));
      
      // Check if content is empty
      const isEmpty = !data.content.content || 
                     data.content.content.length === 0 ||
                     (data.content.content.length === 1 && 
                      data.content.content[0].type === 'paragraph' && 
                      !data.content.content[0].content);
      
      if (isEmpty) {
        console.log('⚠️  WARNING: Content is EMPTY!');
      } else {
        console.log('✅ Content has data');
      }
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

console.log('Checking document saves for branch panel...');
console.log('Note ID:', noteId);
console.log('Panel ID:', branchPanelId);
console.log('---');

checkDocumentSaves();