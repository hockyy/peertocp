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

ipcRenderer.on("index.compileResult", (event, data) => {
  let tmpHtml = termToHtml.strings(data, termToHtml.themes.light.name)
  tmpHtml = /<pre[^>]*>((.|[\n\r])*)<\/pre>/im.exec(tmpHtml)[1];
  compileResult.innerHTML += tmpHtml
})

ipcRenderer.on("index.replaceCompileResult", (event, data) => {
  compileResult.innerHTML = data
})

let codeMirrorView;
let provider;
let ytext;
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
    const spawnOtherPeerButton = document.createElement("button")
    spawnOtherPeerButton.classList = "btn btn-warning btn-sm"
    spawnOtherPeerButton.id = `spawn-${key}`
    spawnOtherPeerButton.textContent = "Request Run"
    cur.append(spawnOtherPeerButton)
    ret.appendChild(cur)
  })
  return ret;
}

const updatePeersButton = (peers) => {
  peers.forEach((val, key) => {
    const el = document.getElementById(`spawn-${key}`)
    el.addEventListener("click", () => {
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
  provider.awareness.on("change", (status) => {
    let states = provider.awareness.getStates()
    peersStatus.innerHTML = (getPeersString(states)).innerHTML
    updatePeersButton(states)
    console.log(provider.room)
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

