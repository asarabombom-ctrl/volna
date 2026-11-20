const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const HOME = 'https://asarabombom-ctrl.github.io/volna/';
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) app.quit();
let win = null;

function create() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 380, minHeight: 600,
    backgroundColor: '#0b0812', title: 'Волна', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { backgroundThrottling: false, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  // Обычный Chrome-UA (без «Electron»), чтобы YouTube-плеер работал как в браузере
  const ua = win.webContents.getUserAgent().replace(/ Electron\/\S+/, '').replace(/ volna-desktop\/\S+/i, '');
  win.webContents.setUserAgent(ua + ' VolnaDesktop/' + app.getVersion());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(HOME)) { e.preventDefault(); shell.openExternal(url); } });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && (i.key === 'F5' || (i.control && i.key.toLowerCase() === 'r'))) { win.webContents.reload(); e.preventDefault(); }
    if (i.type === 'keyDown' && i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0b0812;color:#eee;font-family:sans-serif"><h2>Нет интернета</h2><p style="opacity:.7">Волне нужен интернет, чтобы искать и играть музыку.</p><button onclick="location.href='${HOME}'" style="padding:12px 28px;border:0;border-radius:999px;background:#b67cff;color:#fff;font-size:16px;cursor:pointer">Повторить</button></body>`));
  });
  win.loadURL(HOME);
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
