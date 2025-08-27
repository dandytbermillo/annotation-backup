const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// This runs in Electron main process where we can use Node.js modules
let mainWindow
let postgresAdapter

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // In development, load from Next.js dev server
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000')
  } else {
    // In production, load the built app
    mainWindow.loadFile(path.join(__dirname, '../out/index.html'))
  }

  // Initialize PostgreSQL adapter in main process
  initializePostgresAdapter()
}

async function initializePostgresAdapter() {
  try {
    // Dynamic import to avoid loading in renderer
    const { ElectronPostgresAdapter } = await import('../lib/adapters/electron-postgres-adapter')
    const { registerPersistenceHandlers } = await import('./ipc/persistence-handlers')
    
    const config = {
      remote: {
        connectionString: process.env.DATABASE_URL_REMOTE || 
                        'postgres://postgres:postgres@localhost:5432/annotation_system'
      },
      local: {
        connectionString: process.env.DATABASE_URL_LOCAL || 
                        'postgres://postgres:postgres@localhost:5432/annotation_local'
      },
      timeout: parseInt(process.env.PG_CONN_TIMEOUT_MS || '2000', 10)
    }
    
    postgresAdapter = new ElectronPostgresAdapter(config)
    
    // Apply persistence mode
    const persistenceMode = process.env.PERSISTENCE_MODE || 'auto'
    if (persistenceMode === 'remote') {
      await postgresAdapter.forceMode('remote')
    } else if (persistenceMode === 'local') {
      await postgresAdapter.forceMode('local')
    }
    
    // Register IPC handlers
    registerPersistenceHandlers(postgresAdapter)
    
    console.log('PostgreSQL persistence initialized in Electron main process')
  } catch (error) {
    console.error('Failed to initialize PostgreSQL adapter:', error)
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (postgresAdapter) {
      postgresAdapter.close()
    }
    app.quit()
  }
})

module.exports = { app }