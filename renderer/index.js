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
const {WebsocketProvider} = require("y-websocket");

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

let codeMirrorView;
let provider;
let ytext;
let runShells;
let currentState = {};

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
    if (key !== provider.awareness.clientID) {
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
    if (key === provider.awareness.clientID) {
      return
    }
    const el = document.getElementById(`spawn-${key}`)
    el.addEventListener("click", () => {
      console.log("OK")
      const message = JSON.stringify({
        type: 'request',
        source: provider.awareness.clientID
      })
      provider.room.sendToUser(key, message)
    })
  })
}

const enterRoom = ({roomName, username}) => {
  currentState = {roomName: roomName, username: username}
  roomStatus.textContent = roomName
  console.log("Entering room " + roomName)
  const ydoc = new yjs.Doc()
  provider = new WebrtcProvider(roomName, ydoc, {
    // awareness: new Awareness(),
    signaling: [SIGNALLING_SERVER_URL],
    filterBcConns: false
  })
  provider.awareness.setLocalStateField('user', {
    name: username, color: userColor.color, colorLight: userColor.light
  })
  ytext = ydoc.getText('codemirror')
  runShells = ydoc.getMap('shells')
  provider.awareness.on("change", (status) => {
    let states = provider.awareness.getStates()
    peersStatus.innerHTML = (getPeersString(states)).innerHTML
    updatePeersButton(states)
  })

  // Send a certain message to a target user-client-id
  ipcRenderer.on("send-message", (event, target, message) => {
    provider.room.sendToUser(target, message)
  })

  // Set Up UUID after compile, meaning a shell is ready to be used
  ipcRenderer.on("terminal.uuid", (event, uuid) => {
    runShells.set(uuid, new yjs.Array())
  })

  provider.on("custom-message", (message) => {
    message = JSON.parse(message)
    if (message.type === "request") {
      let code = ytext.toString()
      ipcRenderer.send(
          'request-compile',
          message.source,
          code)
    } else if (message.type === "compile-result") {
      compileResultHandler("", message.message)
    } else if (message.type === "replace-compile") {
      replaceCompileHandler("", message.message)
    }
    // runShells.push([`oke-${provider.awareness.clientID}-${key}`])
    console.log("Received Message")
    console.log(message)
  })
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
  codeMirrorView = new EditorView({
    state,
    parent: /** @type {HTMLElement} */ (document.querySelector('#editor'))
  })
  runShells.observe(event => {
    shellsContainer.innerHTML = ""
    for (const runShell of runShells) {
      const ret = document.createElement("button")
      ret.classList = "btn btn-light"
      ret.textContent = runShell
      shellsContainer.appendChild(ret)
      ret.addEventListener('click', () => {
        console.log(`ok-${runShell}`)
      })
    }
    console.log(event)
    console.log(runShells.toArray())
  })
}

connectionButton.addEventListener('click', () => {
  if (provider.shouldConnect) {
    provider.disconnect()
    // provider.destroy()
    connectionButton.textContent = 'Connect'
    connectionButton.classList.replace("btn-danger", "btn-success")
    connectionStatus.textContent = "Offline"
    connectionStatus.classList.remove('online')
    connectionStatus.classList.add('offline')
    peersStatus.innerHTML = ""
  } else {
    const enterState = getEnterState()
    if (enterState !== currentState) {
      provider.destroy()
      codeMirrorView.destroy()
      enterRoom(enterState)
    } else {
      provider.connect()
    }
    connectionStatus.textContent = "Online"
    connectionStatus.classList.remove('offline')
    connectionStatus.classList.add('online')
    connectionButton.textContent = 'Disconnect'
    connectionButton.classList.replace("btn-success", "btn-danger")
  }
})

spawnButton.addEventListener("click", () => {
  let dataToSend = ytext.toString()
  ipcRenderer.send('add-terminal-window', dataToSend)
})

const compileResultHandler = (event, data) => {
  let tmpHtml = termToHtml.strings(data, termToHtml.themes.light.name)
  tmpHtml = /<pre[^>]*>((.|[\n\r])*)<\/pre>/im.exec(tmpHtml)[1];
  compileResult.innerHTML += tmpHtml
}

const replaceCompileHandler = (event, data) => {
  compileResult.innerHTML = data
}