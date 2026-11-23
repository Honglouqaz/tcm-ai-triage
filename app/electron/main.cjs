/* Electron 主进程：把 app/web 当成离线应用外壳打开，无网络、无 Node 暴露给页面 */
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: '四时辨证',
    backgroundColor: '#f7f3ea',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'web', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });
  win.loadFile(path.join(__dirname, '..', 'web', 'index.html'));
  // 外链走系统浏览器，不在应用内打开（避免变成一个浏览器）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url); }
  });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: '四时辨证', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
  { label: '视图', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
]));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
