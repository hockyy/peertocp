'use strict'

const {ipcRenderer} = require('electron');
const yjs = require("yjs");
const {WebrtcProvider} = require("y-webrtc");
const {yCollab, yUndoManagerKeymap} = require('y-codemirror.next');

const {basicSetup, EditorView} = require("codemirror");
const {keymap} = require("@codemirror/view");
const {EditorState} = require("@codemirror/state");
const {cpp} = require("@codemirror/lang-cpp");
const {indentWithTab} = require("@codemirror/commands");
const termToHtml = require('term-to-html')
const random = require('lib0/random')

const SIGNALLING_SERVER_URL = 'ws://103.167.137.77:4444';
const WEBSOCKET_SERVER_URL = 'ws://103.167.137.77:4443';
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
  theme: "dark",
  axis: "y",
  alwaysShowScrollbar: 2,
  scrollInertia: 200
});

let codemirrorView;
let provider, oldprovider;
let ytext;
let runShells;
let currentID;
let runnerShells;
let currentState = {};
let subscribedTerminalId;
let subscribedSize;
let ydoc;

/**
 * Generate random color
 * @returns {{color: string, light: string}}
 */
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

window.addEventListener('load', () => {
  enterRoom(getEnterState())
})

const getPeersString = (peers) => {
  const ret = document.createElement("ul")
  peers.forEach((val, key) => {
    const cur = document.createElement("li");
    cur.innerHTML = (`${key} - ${val.user.name}\n`)
    cur.style.color = `${val.user.color}`
    if (key !== currentID) {
      const spawnOtherPeerButton = document.createElement("button")
      spawnOtherPeerButton.classList = "btn btn-warning btn-sm"
      spawnOtherPeerButton.id = `spawn-${key}`
      spawnOtherPeerButton.textContent = "Request Run"
      cur.append(spawnOtherPeerButton)
    }
    ret.appendChild(cur)
  })
  return ret;
}

const updatePeersButton = (peers) => {
  peers.forEach((val, key) => {
    if (key === currentID) {
      return
    }
    const el = document.getElementById(`spawn-${key}`)
    el.addEventListener("click", () => {
      const message = JSON.stringify({
        type: 'request',
        source: currentID
      })
      provider.room.sendToUser(key, message)
    })
  })
}

const updateShells = () => {
  shellsContainer.innerHTML = ""
  runShells.forEach((val, key) => {
    const ret = document.createElement("button")
    ret.classList = "btn btn-light"
    ret.textContent = `${key} running in ${runnerShells.get(key)}`
    shellsContainer.appendChild(ret)
    ret.addEventListener('click', () => {
      ipcRenderer.send('terminal.window.add', key);
    })
  })
  if (subscribedTerminalId) {
    updateSubscribed()
  }
}

const enterRoom = ({roomName, username}, newDoc = true) => {
  currentState = {roomName: roomName, username: username}
  roomStatus.textContent = roomName
  if (newDoc) {
    ydoc = new yjs.Doc()
  }
  provider = new WebrtcProvider(roomName, ydoc, {
    signaling: [SIGNALLING_SERVER_URL],
    filterBcConns: false
  })
  currentID = ydoc.clientID;
  provider.awareness.setLocalStateField('user', {
    name: username, color: userColor.color, colorLight: userColor.light
  })
  ytext = ydoc.getText('codemirror')
  runShells = ydoc.getMap('shells')
  runnerShells = ydoc.getMap('shellRunner')
  provider.awareness.on("change", (status) => {
    let states = provider.awareness.getStates()
    peersStatus.innerHTML = (getPeersString(states)).innerHTML
    updatePeersButton(states)
  })

  provider.on("custom-message", messageHandler)
  provider.on('set-peer-id', (peerId) => {
    provider.awareness.setLocalStateField('peerId', peerId)
  })
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [keymap.of([...yUndoManagerKeymap, indentWithTab]), basicSetup,
      cpp(), yCollab(ytext, provider.awareness)
      // oneDark
    ]
  })
  codemirrorView = new EditorView({
    state,
    parent: /** @type {HTMLElement} */ (document.querySelector('#editor'))
  })

  runShells.observeDeep(updateShells)
}

connectionButton.addEventListener('click', () => {
  if (provider) {
    provider.disconnect()
    provider.destroy()
    ydoc.clientID = random.uint32()
    currentID = ydoc.clientID
    oldprovider = provider
    provider = null
    connectionButton.textContent = 'Connect'
    connectionButton.classList.replace("btn-danger", "btn-success")
    connectionStatus.textContent = "Offline"
    connectionStatus.classList.remove('online')
    connectionStatus.classList.add('offline')
    peersStatus.innerHTML = ""
  } else {
    const enterState = getEnterState()
    codemirrorView.destroy()
    if (enterState.roomName !== currentState.roomName) {
      enterRoom(enterState)
    } else {
      enterRoom(enterState, false)
    }
    connectionStatus.textContent = "Online"
    connectionStatus.classList.remove('offline')
    connectionStatus.classList.add('online')
    connectionButton.textContent = 'Disconnect'
    connectionButton.classList.replace("btn-success", "btn-danger")
  }
})

spawnButton.addEventListener("click", () => {
  const code = ytext.toString()
  ipcRenderer.send(
      'compile.request',
      currentID,
      code,
      true
  )
})

const appendCompileHandler = (data) => {
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
    ipcRenderer.send(
        'compile.request',
        message.source,
        code)
  } else if (message.type === "compile.append") {
    appendCompileHandler(message.message)
  } else if (message.type === "compile.replace") {
    replaceCompileHandler(message.message)
  } else if (message.type === "shell.keystroke") {
    ipcRenderer.send(
        'terminal.keystroke.receive',
        message.terminalId,
        message.keystroke,
    )
  }
}

const updateSubscribed = () => {
  const messages = runShells.get(subscribedTerminalId).toArray()
  let accumulated = ""
  for (let i = subscribedSize; i < messages.length; i++) {
    accumulated += messages[i]
  }
  ipcRenderer.send(
      'terminal.message.receive',
      accumulated,
      subscribedSize === 0
  )
  subscribedSize = messages.length
}

// Send a certain message to a target user-client-id
ipcRenderer.on("message.send", (event, target, message) => {
  if (target === "active-terminal") {
    target = runnerShells.get(subscribedTerminalId)
    message.terminalId = subscribedTerminalId
    message = JSON.stringify(message)
  }
  if (target === currentID) {
    messageHandler(message)
  } else {
    provider.room.sendToUser(target, message)
  }
})

// Subscribe to here
ipcRenderer.on("terminal.subscribe", (event, id) => {
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
  runnerShells.set(uuid, currentID)
  runShells.set(uuid, new yjs.Array())
})

// Updates terminal
ipcRenderer.on('terminal.update', (event, uuid, data) => {
  const history = runShells.get(uuid);
  history.push(data)
})