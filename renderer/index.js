'use strict'

const {ipcRenderer} = require('electron');

const {
  receiveUpdates, sendableUpdates, collab, getSyncedVersion, getClientID
} = require("@codemirror/collab");
const WEBSOCKET_URL = "ws://localhost:4443";
const WebSocket = require('rpc-websockets').Client
const {basicSetup} = require("codemirror");
const {ChangeSet, EditorState, Text} = require("@codemirror/state");
const {EditorView, ViewPlugin, keymap} = require("@codemirror/view");
const {WebrtcProvider} = require("y-webrtc");
const {cpp} = require("@codemirror/lang-cpp");
const {indentWithTab} = require("@codemirror/commands");
const termToHtml = require('term-to-html')
const {func} = require("lib0");
const crypto = require('crypto');

let runShells;

class Connection {
  constructor() {
    this.wsconn = new WebSocket(WEBSOCKET_URL, {
      autoconnect: true, max_reconnects: 0,
    });
  }

  async pushUpdates(version, fullUpdates) {
    // console.log(version)
    try {
      if (!this.wsconn.socket || this.wsconn.socket.readyState !== 1) {
        return false;
      }
      let updates = fullUpdates.map(u => ({
        clientID: u.clientID, changes: u.changes.toJSON()
      }))
      return this.wsconn.call("pushUpdates", {
        docName: currentState.roomName, version: version, updates: fullUpdates
      })
    } catch (e) {
      // console.log("Push error", e)
      return false;
    }
  }

  async pushShellUpdates(shellVersion, shellUpdates) {
    try {
      if (!this.wsconn.socket || this.wsconn.socket.readyState !== 1) {
        return false;
      }
      return this.wsconn.call("pushUpdates", {
        docName: currentState.roomName,
        shellVersion: shellVersion,
        shellUpdates: shellUpdates
      })
    } catch (e) {
      // console.log("Push error", e)
      return false;
    }
  }

  async pullUpdates(version, shellVersion) {
    try {
      if (!this.wsconn.socket || this.wsconn.socket.readyState !== 1) {
        return [];
      }
      const res = this.wsconn.call("pullUpdates", {
        docName: currentState.roomName,
        version: version,
        shellVersion: shellVersion
      }).then((updates) => updates.map(u => ({
        changes: ChangeSet.fromJSON(u.changes), clientID: u.clientID
      })))
      return res;
    } catch (e) {
      // console.log("Pull error", e)
      return []
    }
  }
}

function peerExtension(startVersion, connection) {

  let plugin = ViewPlugin.fromClass(class {
    pushingShell = false;
    pushing = false;
    pulling = false;
    shellVersion = 0;
    pendingShellUpdates = [];

    constructor(view) {
      this.view = view;
      this.subscribed = false;
      this.clientID = getClientID(this.view.state)
      // console.log(connection)
      const subAndPut = () => {
        if (this.subscribed) {
          return;
        }
        if (!connection.wsconn.socket) {
          return;
        }
        if (connection.wsconn.socket.readyState !== 1) {
          return;
        }
        this.pull()
        this.subscribed = true;
        connection.wsconn.subscribe("newUpdates")
        connection.wsconn.on("newUpdates", () => {
          this.pull();
        })
      }
      subAndPut()
      connection.wsconn.once("open", subAndPut)
      subAndPut()
    }

    update(update) {
      if (update.docChanged) {
        this.push()
      }
    }

    async pushShell() {
      if (this.pushingShell) {
        return;
      }
      if (!this.pendingShellUpdates.length) {
        return;
      }
      this.pushingShell = true;
      const pushingCurrent = this.pendingShellUpdates.slice(0)
      let updated = false;
      try {
        updated = await connection.pushShellUpdates(this.shellVersion,
            pushingCurrent)
      } catch (e) {
        // console.log(e)
      }
      if (updated) {
        const updatedSize = pushingCurrent.length
        this.pendingShellUpdates.splice(0, updatedSize)
      }
      this.pushingShell = false;
      // Regardless of whether the push failed or new updates came in
      // while it was running, try again if there's updates remaining
      if (this.pendingShellUpdates.length) {
        this.pull().then(() => {
          this.pushShell()
        })
      }
    }

    async push() {
      if (this.pushing) {
        return;
      }
      let updates = sendableUpdates(this.view.state)
      if (!updates.length) {
        return;
      }
      this.pushing = true
      try {
        let version = getSyncedVersion(this.view.state)
        const updated = await connection.pushUpdates(version, updates)
      } catch (e) {
        // console.log(e)
      }
      this.pushing = false
      // Regardless of whether the push failed or new updates came in
      // while it was running, try again if there's updates remaining
      if (sendableUpdates(this.view.state).length) {
        this.pull().then(() => {
          this.push()
        })
      }
    }

    async pull() {
      if (this.pulling) {
        return;
      }
      this.pulling = true;
      try {
        let version = getSyncedVersion(this.view.state)
        let updates = await connection.pullUpdates(version, this.shellVersion)
        this.view.dispatch(receiveUpdates(this.view.state, updates.updates))
        this.shellVersion += updates.shellUpdates.length
        for (const shellUpdate of updates.shellUpdates) {
          switch (shellUpdate.type) {
            case "shell.spawn":
              runShells.set(shellUpdate.shellID, [])
              break
            case "shell.info":
              const currentShell = runShells.get(shellUpdate.shellID);
              currentShell.push(shellUpdate.message)
              break
            case "shell.compile":
              if (shellUpdate.toID === getClientID(this.view.state)) {
                if (shellUpdate.append) {
                  compileResultHandler(
                      shellUpdate.message)
                } else {
                  replaceCompileHandler(shellUpdate.message)
                }
              }
              break
            case "shell.keystroke":
              if (shellUpdate.toID === getClientID(this.view.state)) {
                ipcRenderer.send(
                    'terminal.receive-keystroke',
                    shellUpdate.terminalId,
                    shellUpdate.keystroke,
                )
              }
              break
            case "shell.request":
              if (shellUpdate.toID === getClientID(this.view.state)) {

                const currentCode = this.view.toString()
                console.log(currentCode)
                ipcRenderer.send(
                    'request-compile',
                    getClientID(this.view.state),
                    currentCode
                )
              }
              break
          }
        }
      } catch (e) {
        // console.log("error")
        // console.log(e)
      }
      this.pulling = false;
    }

    destroy() {
      connection.wsconn.unsubscribe("newUpdates")
    }
  })
  return [collab({startVersion}), plugin]
}

const DEFAULT_ROOM = 'welcome-room'
const DEFAULT_USERNAME = 'Anonymous ' + Math.floor(Math.random() * 100)
const roomStatus = document.getElementById("room-status")
const connectionStatus = document.getElementById("connection-status")
const peersStatus = document.getElementById("peers-status")
const connectionButton = document.getElementById("connect-button")
const roomNameInput = document.getElementById("room-name-input")
const usernameInput = document.getElementById("username-input")
const spawnButton = document.getElementById("spawn-button")
const compileFlagInput = document.getElementById("compile-flag")
const compileResult = document.getElementById("compile-result")
const shellsContainer = document.getElementById("shells-container")

$("#sidebar").mCustomScrollbar({
  theme: "dark", axis: "y", alwaysShowScrollbar: 2, scrollInertia: 200
});

let codeMirrorView;
let ytext;
let currentState = {};
let subscribedTerminalId;
let subscribedSize;

const randomColor = () => {
  const randomColor = Math.floor(Math.random() * 16777215).toString(16);
  const color = "#" + randomColor;
  const light = color + "33";
  return {color, light}
}

compileFlagInput.value = "--std=c++17"
const userColor = randomColor();

const getEnterState = () => {
  return {
    roomName: roomNameInput.value || DEFAULT_ROOM,
    username: usernameInput.value || DEFAULT_USERNAME,
  };
}

window
.addEventListener('load', () => {
  enterRoom(getEnterState())
})

const enterRoom = async ({roomName, username}) => {
  const connection = new Connection()
  if (runShells) {
    runShells.destroy()
  }
  runShells = new Map()
  const state = EditorState.create({
    doc: "",
    extensions: [keymap.of([indentWithTab]), basicSetup, cpp(),
      peerExtension(0, connection)]
  })

  codeMirrorView = new EditorView({
    state,
    parent: /** @type {HTMLElement} */ (document.querySelector('#editor'))
  })

  currentState = {roomName: roomName, username: username}
  roomStatus.textContent = roomName
  console.log("Entering room " + roomName)

  // console.log("OK")
  // console.log(subscribedTerminalId)
  if (subscribedTerminalId) {
    updateSubscribed()
  }
  // console.log(event)
  // console.log(transactions)
  // console.log(runShells.toJSON())
}

connectionButton.addEventListener('click', () => {
  const enterState = getEnterState()
  if (enterState !== currentState) {
    codeMirrorView.destroy()
    enterRoom(enterState)
  }
})

spawnButton.addEventListener("click", () => {

})

const compileResultHandler = (data) => {
  let tmpHtml = termToHtml.strings(data, termToHtml.themes.light.name)
  tmpHtml = /<pre[^>]*>((.|[\n\r])*)<\/pre>/im.exec(tmpHtml)[1];
  compileResult.innerHTML += tmpHtml
}

const replaceCompileHandler = (data) => {
  compileResult.innerHTML = data
}

const messageHandler = (message) => {
  message = JSON.parse(message)
  if (message.type === "request") {
    let code = ytext.toString()
    ipcRenderer.send('request-compile', message.source, code)
  } else if (message.type === "compile-result") {
    compileResultHandler(message.message)
  } else if (message.type === "replace-compile") {
    replaceCompileHandler(message.message)
  } else if (message.type === "keystroke") {
    ipcRenderer.send('terminal.receive-keystroke', message.terminalId,
        message.keystroke,)
  }
  // runShells.push([`oke-${provider.awareness.clientID}-${key}`])
  // console.log("Received Message")
  // console.log(message)
}

const updateSubscribed = () => {
  // console.log("updating")
  // console.log(subscribedTerminalId)
  // console.log(subscribedSize)
  let accumulated = ""
  for (let i = subscribedSize; i < messages.length; i++) {
    accumulated += messages[i]
  }
  ipcRenderer.send('terminal.send-subscribed', accumulated,
      subscribedSize === 0)
  subscribedSize = messages.length
}

// Send a certain message to a target user-client-id
ipcRenderer.on("send-message", (event, target, message) => {
  if (target === "active-terminal") {
    target = runnerShells.get(subscribedTerminalId)
    message.terminalId = subscribedTerminalId
    message = JSON.stringify(message)
  }
})

// Subscribe to here
ipcRenderer.on("terminal.subscribe", (event, id) => {
  // console.log("Subscribing")
  // console.log(id)
  subscribedTerminalId = id;
  subscribedSize = 0;
  updateSubscribed()
})
// Unsubscribe
ipcRenderer.on("terminal.unsubscribe", (event, id) => {
  subscribedTerminalId = "";
  subscribedSize = 0;
})

// Set Up UUID after compile, meaning a shell is ready to be used
ipcRenderer.on("terminal.uuid", (event, uuid) => {
})

// Updates terminal
ipcRenderer.on('terminal.update', (event, uuid, data) => {
})