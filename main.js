const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');
const fs = require('fs')
const pty = require("node-pty");
const os = require("os");
const SHELL_PREFERENCE = {
  "win32": "cmd.exe", "linux": "bash", "darwin": "zsh"
}
const shell = SHELL_PREFERENCE[os.platform()] || "bash"
let mainWindow;

/*
Start Of Processes and Compilers Code
 */

const processMap = new Map()

const runFile = (compileResultfile, shellArray, id) => {
  const startTime = new Date()
  const ptyProcess = pty.spawn(compileResultfile, [], {
    name: "xterm-color",
    cols: 80,
    rows: 30,
    cwd: path.join(process.env.HOME, 'p2cp'),
    env: process.env
  });
  processMap.set("id", ptyProcess)
  ptyProcess.onData(data => {
    shellArray.push([data])
  });
  ptyProcess.onExit(data => {
    if (!terminalWin.isDestroyed()) {
      shellArray.push(["terminal.incomingData", "\r\n"])
      shellArray.push(["terminal.incomingData",
        `[Peer2CP: Exited with code ${data.exitCode}]\r\n`])
      shellArray.push(
          ["terminal.incomingData", `[Peer2CP: Signal ${data.signal}]\r\n`])
      shellArray.push(["terminal.incomingData",
        `[Peer2CP: Finished Running in ${((new Date()) - startTime)
        / 1000}s]\r\n`])
    }
  })
  ipcMain.on(`terminal.keystroke.${id}`, (event, key) => {
    shellArray.push(["terminal.incomingData", "\r\n"])
    ptyProcess.write(key);
  });
  ipcMain.on(`kill.${id}`, () => {
    ptyProcess.kill()
  })
}

const compileHandler = (event, code) => {
  const p2cpdir = path.join(process.env.HOME, 'p2cp')
  const codefile = path.join(p2cpdir, 'code.cpp')
  const compileResultfile = path.join(p2cpdir, 'code')
  if (!fs.existsSync(p2cpdir)) {
    fs.mkdir(p2cpdir, (err) => {
      if (err) {
        console.log(err)
      }
    });
  }
  fs.writeFile(codefile, code, err => {
    if (err) {
      console.log(err)
    }
  })
  const sendBack = (message, isReplace = false) => {
    mainWindow.webContents.send("send-message", source,
        JSON.stringify({
          type: isReplace ? "compile-result" : "replace-compile",
          message: message
        }))
  }
  sendBack("Compiling...\n", true)
  const compileProcess = pty.spawn("g++", [codefile, "-o", compileResultfile],
      {})
  compileProcess.onData(data => {
    sendBack(data)
  })
  compileProcess.onExit(data => {
    sendBack(`Exited with code ${data.exitCode}`)
    if (data.exitCode === 0) {
      const uuid = crypto.randomUUID()
      mainWindow.webContents.send("terminal.uuid", uuid)
      runFile(compileResultfile, uuid)
    }
  })
}

/*
End Of Compilers Code
 */

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800, height: 600, webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false,
    }
  })
  mainWindow.loadFile(path.join('renderer', 'index.html'))
}

let terminalWin;

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
  ipcMain.on('request-compile', compileHandler)

})

app.on('window-all-closed', () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})