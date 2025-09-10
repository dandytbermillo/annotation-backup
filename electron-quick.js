const { app, BrowserWindow } = require('electron')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    title: 'Annotation System'
  })

  // Load the Next.js dev server
  mainWindow.loadURL('http://localhost:3001')
  
  // Open DevTools for debugging
  mainWindow.webContents.openDevTools()
  
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

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

console.log('Starting Electron app...')
console.log('Loading from: http://localhost:3001')