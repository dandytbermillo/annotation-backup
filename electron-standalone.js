const { app, BrowserWindow, Menu, dialog } = require('electron')
const path = require('path')

let mainWindow

function createWindow() {
  // Create the browser window with a nice size
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    icon: path.join(__dirname, 'public/icons/icon-512x512.png'),
    title: 'Annotation System - Standalone',
    titleBarStyle: 'default',
    backgroundColor: '#ffffff'
  })

  // Create application menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            mainWindow.webContents.executeJavaScript(`
              console.log('Creating new note...');
              // Trigger new note creation in the app
            `)
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Annotation System',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Annotation System',
              detail: 'A standalone desktop application for creating and managing annotations.\n\nFeatures:\n• Rich text editing with TipTap\n• Annotation management\n• PostgreSQL persistence\n• Offline support\n\nVersion: 1.0.0',
              buttons: ['OK']
            })
          }
        },
        { type: 'separator' },
        {
          label: 'View Logs',
          click: () => {
            mainWindow.webContents.openDevTools()
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  // Load the app - check if server is running
  const appUrl = 'http://localhost:3001'
  
  // Show loading message
  mainWindow.loadURL(`data:text/html,
    <!DOCTYPE html>
    <html>
      <head>
        <title>Loading...</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          .container {
            text-align: center;
          }
          h1 {
            font-size: 2em;
            margin-bottom: 0.5em;
          }
          .spinner {
            border: 3px solid rgba(255,255,255,0.3);
            border-top: 3px solid white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          .status {
            margin-top: 20px;
            font-size: 0.9em;
            opacity: 0.8;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Annotation System</h1>
          <div class="spinner"></div>
          <div class="status">Starting application...</div>
        </div>
      </body>
    </html>
  `)

  // Try to connect to the server
  setTimeout(() => {
    console.log(`Attempting to load: ${appUrl}`)
    mainWindow.loadURL(appUrl).catch(err => {
      console.error('Failed to load app:', err)
      dialog.showErrorBox('Connection Error', 
        'Could not connect to the application server.\n\n' +
        'Please make sure the server is running with:\n' +
        'npm run dev\n\n' +
        'Then restart this application.')
    })
  }, 2000)

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Handle navigation and external links
  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault()
    require('electron').shell.openExternal(url)
  })

  // Log when page loads successfully
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ Application loaded successfully')
  })

  // Handle load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription)
  })
}

// App event handlers
app.whenReady().then(() => {
  console.log('🚀 Electron app is ready')
  console.log('📍 Working directory:', __dirname)
  console.log('🌐 Loading from: http://localhost:3001')
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
})

// Handle certificate errors
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault()
  callback(true)
})

// Set app name
app.setName('Annotation System')

console.log('Starting Annotation System Standalone App...')