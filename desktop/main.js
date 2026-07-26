// App bureau Clouduo: une fenêtre native sur l'app déployée.
// Même principe que l'APK (wrapper sur l'URL), donc une seule version à
// maintenir: un déploiement Vercel met à jour le bureau et le téléphone.
const { app, BrowserWindow, shell, Menu } = require('electron')
const path = require('node:path')

const APP_URL = process.env.CLOUDUO_URL || 'https://clouduo-puce.vercel.app'

// Une seule instance: un double-clic sur le raccourci réveille la fenêtre
// existante au lieu d'en ouvrir une deuxième.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#eef2ff',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      // On charge du contenu distant: pas de Node dans la page, isolation
      // active. Aucun preload, la page n'a aucun accès au système.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.loadURL(APP_URL)

  // Les liens externes partent dans le navigateur, pas dans une fenêtre
  // Electron sans barre d'adresse.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Garde-fou: la navigation reste sur le domaine de l'app.
  win.webContents.on('will-navigate', (e, url) => {
    if (new URL(url).origin !== new URL(APP_URL).origin) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  win.on('closed', () => {
    win = null
  })
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
