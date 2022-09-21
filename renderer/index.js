'use strict'

const {ipcRenderer} = require('electron');

const {
  receiveUpdates, sendableUpdates, collab, getSyncedVersion
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

class Connection {
  constructor() {
    this.pulling = false;
    this.wsconn = new WebSocket(WEBSOCKET_URL, {
      autoconnect: true, max_reconnects: 0,
    });
  }

  async pushUpdates(version, fullUpdates) {
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
      console.log("Push error", e)
      return false;
    }

  }

  async pullUpdates(version) {
    try {
      if (!this.wsconn.socket || this.wsconn.socket.readyState !== 1
          || this.pulling) {
        return [];
      }
      this.pulling = true;
      const res = this.wsconn.call("pullUpdates",
          {docName: currentState.roomName, version: version}).then(
          (updates) => updates.map(u => ({
            changes: ChangeSet.fromJSON(u.changes), clientID: u.clientID
          })))
      this.pulling = false;
      return res;
    } catch (e) {
      console.log("Pull error", e)
      return []
    }
  }
}

function peerExtension(startVersion, connection) {

  let plugin = ViewPlugin.fromClass(class {
    pushing = false

    constructor(view) {
      this.view = view;
      this.subscribed = false;
      console.log(connection)
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

    async push() {
      let updates = sendableUpdates(this.view.state)
      if (this.pushing || !updates.length) {
        return
      }
      this.pushing = true
      let version = getSyncedVersion(this.view.state)
      await connection.pushUpdates(version, updates)
      this.pushing = false
      // Regardless of whether the push failed or new updates came in
      // while it was running, try again if there's updates remaining
      if (sendableUpdates(this.view.state).length) {
        // Updating again if not able to send updates
        setTimeout(() => this.push(), 100)
      }
    }

    async pull() {
      let version = getSyncedVersion(this.view.state)
      let updates = await connection.pullUpdates(version)
      this.view.dispatch(receiveUpdates(this.view.state, updates))
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
  enterRoom(getEnterState
  ())
})

const enterRoom = async ({roomName, username}) => {
  const connection = new Connection()
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