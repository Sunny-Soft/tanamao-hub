import { app, BrowserWindow } from 'electron';
import { Tray, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import initIPCApi from './src/api/index.js'
import BackupService from './src/services/backup.service.js';
import UpdateService from './src/services/update.service.js';
import { initHubServer } from './src/api/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

//tray
let tray;
let hubServer;
let isQuitting = false;

function createTray(win) {
    tray = new Tray(path.join(__dirname, '../public/favicon.ico'));

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Abrir', type: 'normal', click: () => win.show() },
        {
            label: 'Encerrar', type: 'normal', click: () => {
                isQuitting = true;
                BackupService.stop();
                UpdateService.stop();
                if (hubServer) hubServer.close();
                app.quit();
            }
        },
    ]);
    tray.setToolTip('Tanamao Hub');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        win.show();
    });
}

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        icon: path.join(__dirname, '../public/favicon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
    });

    createTray(win);

    const indexPath = app.isPackaged
        ? path.join(app.getAppPath(), 'dist/tanamao-hub/browser/index.html')
        : path.join(__dirname, '../dist/tanamao-hub/browser/index.html');

    win.loadFile(indexPath);

    // win.loadURL('http://localhost:4201');

    win.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            win.hide();
        }
    });
}

app.whenReady().then(() => {
    initIPCApi();
    BackupService.start();
    UpdateService.start();
    hubServer = initHubServer();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
