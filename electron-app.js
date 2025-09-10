const { app, BrowserWindow } = require('electron')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // Direct load without any fancy loading screen
  console.log('Loading http://localhost:3001...')
  mainWindow.loadURL('http://localhost:3001')
  
  // Open dev tools to see what's happening
  mainWindow.webContents.openDevTools()
  
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  
  // Log navigation events
  mainWindow.webContents.on('did-start-loading', () => {
    console.log('Started loading...')
  })
  
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Finished loading!')
  })
  
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Load failed:', errorCode, errorDescription)
  })
  
  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM is ready')
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