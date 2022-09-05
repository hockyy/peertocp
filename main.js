const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');

const pty = require("node-pty-prebuilt-multiarch");
const os = require("os");
const shell = os.platform() === "win32" ? "powershell.exe" : "bash";

const createWindow = () => {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    }
  })
  window.loadFile(path.join('renderer', 'index.html'))
}

let ptyProcess;

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  ipcMain.on('add-terminal-window', () => {
    console.log('ok')
    const terminalWin = new BrowserWindow({
      width: 800,
      height: 400,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      }
    })
    terminalWin.loadFile(path.join('renderer', 'terminal.html'))
    ptyProcess = pty.spawn(shell, [], {
      name: "xterm-color",
      cols: 80,
      rows: 30,
      cwd: process.env.HOME,
      env: process.env
    });
    ptyProcess.onData(function (data) {
      terminalWin.webContents.send("terminal.incomingData", data);
      console.log("Data sent");
    });
    ipcMain.on("terminal.keystroke", (event, key) => {
      ptyProcess.write(key);
    });
  })

})

app.on('window-all-closed', () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})