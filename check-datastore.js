// Check dataStore content for branch panels
setTimeout(() => {
  if (window.canvasDataStore) {
    const ds = window.canvasDataStore;
    const branches = [];
    
    ds.forEach((value, key) => {
      if (key.startsWith('branch-')) {
        branches.push({
          id: key,
          hasContent: !!value.content,
          contentLength: typeof value.content === 'string' ? value.content.length : JSON.stringify(value.content || {}).length,
          hasPreview: !!value.preview,
          previewLength: value.preview ? value.preview.length : 0,
          hasHydratedContent: value.hasHydratedContent
        });
      }
    });
    
    console.table(branches);
  } else {
    console.log('DataStore not available');
  }
}, 100);
