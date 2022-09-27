const {app, BrowserWindow, ipcMain} = require('electron');
const path = require('path');
const fs = require('fs')
const pty = require("node-pty");
const os = require("os");
const crypto = require('crypto');
const SHELL_PREFERENCE = {
  "win32": "cmd.exe", "linux": "bash", "darwin": "zsh"
}
const shell = SHELL_PREFERENCE[os.platform()] || "bash"
let mainWindow;

/*
Start Of Processes and Compilers Code
 */

const processMap = new Map()

const runFile = (compileResultfile, id) => {
  const startTime = new Date()
  const ptyProcess = pty.spawn(compileResultfile, [], {
    name: "xterm-color",
    cols: 80,
    rows: 30,
    cwd: path.join(process.env.HOME, 'p2cp'),
    env: process.env
  });
  processMap.set(id, ptyProcess)
  const updateTerminalData = (data) => {
    mainWindow.webContents.send("terminal.update", id, data);
  }
  ptyProcess.onData(data => {
    updateTerminalData([data])
  });
  ptyProcess.onExit(data => {
    updateTerminalData([``])
    updateTerminalData([`[Peer2CP: Exited with code ${data.exitCode}]\r\n`])
    updateTerminalData([`[Peer2CP: Signal ${data.signal}]\r\n`])
    updateTerminalData(
        [`[Peer2CP: Finished Running in ${((new Date()) - startTime)
        / 1000}s]\r\n`])
  })
  // ipcMain.on(`terminal.keystroke.${id}`, (event, key) => {
  //   ptyProcess.write(key);
  // });
  // ipcMain.on(`terminal.kill.${id}`, () => {
  //   ptyProcess.kill()
  // })
}

const compileHandler = (event, source, code) => {
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
    mainWindow.webContents.send("message.send", source, JSON.stringify({
      type: isReplace ? "compile.replace" : "compile.append", message: message
    }))
  }
  sendBack("Compiling...\n", true)
  const compileProcess = pty.spawn("g++", [codefile, "-o", compileResultfile],
      {})
  compileProcess.onData(data => {
    sendBack(data)
  })
  compileProcess.onExit(data => {
    // console.log("Exited")
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

let terminalWin;

const openTerminalHandler = (event, id) => {
  if (terminalWin && !terminalWin.isDestroyed()) {
    return;
  }
  terminalWin = new BrowserWindow({
    width: 800, height: 400, webPreferences: {
      nodeIntegration: true, contextIsolation: false,
    }
  })
  let loaded = false;
  terminalWin.loadFile(path.join('renderer', 'terminal.html'))
  terminalWin.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send("terminal.subscribe", id)
  })
  terminalWin.on('closed', () => {
    mainWindow.webContents.send("terminal.unsubscribe", id)
  })
}

const receiveSubscribedHandler = (event, accumulated, isFirstTime = false) => {
  if(!terminalWin || terminalWin.isDestroyed()) return;
  terminalWin.webContents.send("terminal.incomingData", accumulated)
}

const keystrokeHandler = (event, e) => {
  mainWindow.webContents.send(
      "message.send",
      "active-terminal",
      {
        type: "keystroke", keystroke: e
      }
  )
}

const receiveKeystrokeHandler = (event, terminalId, keystroke) => {
  const myProcess = processMap.get(terminalId)
  myProcess.write(keystroke);
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 800, height: 600, webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  })
  mainWindow.loadFile(path.join('renderer', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
  ipcMain.on('request-compile', compileHandler)
  ipcMain.on('terminal.add-window', openTerminalHandler)
  ipcMain.on('terminal.keystroke', keystrokeHandler)
  ipcMain.on('terminal.receive-keystroke', receiveKeystrokeHandler)
  ipcMain.on('terminal.send-subscribed', receiveSubscribedHandler)
})

app.on('window-all-closed', () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})