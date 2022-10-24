'use strict'

const {ipcRenderer} = require('electron');

const {
  receiveUpdates, sendableUpdates, collab, getSyncedVersion, getClientID
} = require("@codemirror/collab");
const WEBSOCKET_URL = "ws://ot-ws.hocky.id";
// const WEBSOCKET_URL = "ws://localhost:3000";
const WebSocket = require('rpc-websockets').Client
const {basicSetup} = require("codemirror");
const {ChangeSet, EditorState, Text} = require("@codemirror/state");
const {EditorView, ViewPlugin, keymap} = require("@codemirror/view");
const {cpp} = require("@codemirror/lang-cpp");
const {indentWithTab} = require("@codemirror/commands");
const termToHtml = require('term-to-html')
const {promise, string, time} = require("lib0");
const TIMEOUT_WSCONN = 1000;
const Mutex = require('async-mutex').Mutex;

const {
  performance
} = require('perf_hooks');
const {min} = require("lib0/math");

let connection;
let runShells;
let runnerShells;
let pendingShellUpdates;

/**
 * Connection is a class representing a connection to a server
 */
class Connection {
  constructor(userName, docName, color, colorLight) {
    this.userName = userName
    this.docName = docName
    this.color = color
    this.colorLight = colorLight
    /**
     * Ping function
     * @returns {Promise<Boolean>}  true if ping succeeded, false otherwise
     */
    this.ping = () => {
      try {
        return this.wsconn.call("ping")
      } catch (e) {
        console.error(e)
        return new Promise(resolve => {
          resolve(false)
        })
      }
    }

    /**
     * Pinger function, use to measure ping and supposed to be called for multiple
     */
    this.pinger = () => {
      const start = performance.now();
      this.ping().then(res => {
        const dur = performance.now() - start
        if (res) {
          pingStatus.innerHTML = dur.toFixed(2);
        } else {
          pingStatus.innerHTML = "-";
        }
      })
    }
    this.getWsConn()
  }

  /**
   * getWsConn regenerate ws connection and set interval pinger function
   */
  getWsConn() {
    this.wsconn = new WebSocket(`${WEBSOCKET_URL}/${this.docName}`, {
      autoconnect: true, max_reconnects: 0, headers: {
        username: this.userName, color: this.color, colorlight: this.colorLight
      }
    });
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
    }
    this.pingInterval = setInterval(this.pinger, 1000)
  }

  /**
   * Push update
   * @param version try to update text with this local current version
   * @param updates the unconfirmed update operation from the beginning till now
   * @returns {Promise<Boolean>} true if succeed
   */
  async pushUpdates(version, updates) {
    try {
      return this.wsconn.call("pushUpdates", {
        docName: currentState.roomName, version: version, updates: updates
      }, TIMEOUT_WSCONN)
    } catch (e) {
      console.error(e)
      return new Promise(resolve => {
        resolve(false)
      })
    }
  }

  /**
   * Push shell updates
   * @param shellVersion try to update shell with this local current version
   * @param shellUpdates the update that haven't been synced with the server only
   * @returns {Promise<Boolean>} true if succeed
   */
  async pushShellUpdates(shellVersion, shellUpdates) {
    try {
      return this.wsconn.call("pushShellUpdates", {
        docName: currentState.roomName,
        shellVersion: shellVersion,
        shellUpdates: shellUpdates
      }, TIMEOUT_WSCONN)
    } catch (e) {
      return new Promise(resolve => {
        resolve(false)
      })
    }
  }

  /**
   * Pull all updates, including shell and text
   * @param version version of text
   * @param shellVersion version of shell
   * @returns {Promise<{updates: [], shellUpdates: []}>} returns updates and
   * shellUpdates from the current version
   */
  async pullUpdates(version, shellVersion) {
    try {
      return this.wsconn.call("pullUpdates", {
        docName: currentState.roomName,
        version: version,
        shellVersion: shellVersion
      }, TIMEOUT_WSCONN).then((updates) => {
        return {
          updates: updates.updates.map(u => ({
            changes: ChangeSet.fromJSON(u.changes), clientID: u.clientID
          })), shellUpdates: updates.shellUpdates
        };
      }).catch(reason => {
        return false;
      });
    } catch (e) {
      console.error(e)
      return new Promise(resolve => {
        resolve(false)
      })
    }
  }

  /**
   * Get list of peers in the current network namespace
   * @returns {Promise<{selfid, ids:[]}>} promise return array of peers in this
   * namespace and its own id
   */
  async getPeers() {
    try {
      return this.wsconn.call("getPeers", null, TIMEOUT_WSCONN)
    } catch (e) {
      return new Promise(resolve => {
        resolve({selfid: "", ids: []})
      })
    }
  }

  /**
   * Send a message involving only two peers
   * @param to target id in the current namespace
   * @param channel receiving channel
   * @param message the message trying to be sent
   * @returns {Promise<Boolean>} true if succeed in sending
   */
  async sendToUser(to, channel, message) {
    try {
      return this.wsconn.call("sendToPrivate",
          {to: to, channel: channel, message: message}, TIMEOUT_WSCONN)
    } catch (e) {
      console.error(e)
      return new Promise(resolve => {
        resolve(false)
      })
    }
  }

  /**
   * Disconnect current connection, will clear ping interval as well
   */
  disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
    }
    this.wsconn.close()
  }

  /**
   * Reconnect to the current namespace, with the same plugin interface
   * will initilize new connection
   */
  reconnect() {
    this.getWsConn()
    this.plugin.goInit()
  }
}

const updateShells = () => {
  shellsContainer.innerHTML = ""
  runShells.forEach((val, key) => {
    const ret = document.createElement("button")
    ret.classList = "btn btn-light"
    ret.textContent = `${key} running in ${runnerShells.get(key).spawner}`
    shellsContainer.appendChild(ret)
    ret.addEventListener('click', () => {
      ipcRenderer.send('terminal.window.add', key);
    })
  })
  if (subscribedTerminalId) {
    updateSubscribed()
  }
}

/**
 * Returns
 * @param startVersion the starting version, default to 0
 * @param connection socket connection to the server
 * @returns {({extension: Extension}|
 * readonly Extension[]|
 * ViewPlugin<{update(*): void}>)[]}
 */
function peerExtension(startVersion = 0, connection) {

  const plugin = ViewPlugin.fromClass(class {
    shellVersion = 0;
    pushMutex = new Mutex()
    pullMutex = new Mutex()

    constructor(view) {
      connection.plugin = this;
      this.view = view;
      this.goInit()
    }

    /**
     * this makes sure initialization is done within readiness of the socket
     */
    goInit() {
      this.initDone = false;
      connection.wsconn.on("newUpdates", () => {
        this.pull();
      })
      connection.wsconn.on("newPeers", () => {
        this.updatePeers()
      })
      connection.wsconn.on("custom.message", (message) => {
        messageHandler(message)
      })
      this.initializeDocs()
      connection.wsconn.once("open", () => {
        this.initializeDocs()
      })
      this.initializeDocs()
    }

    /**
     * Initialization of the docs
     */
    initializeDocs() {
      if (!connection.wsconn.ready) {
        return;
      }
      if (this.initDone) {
        return;
      }
      this.initDone = true;
      updateShells()
      this.pull()
      this.push()
      this.pushShell()
      this.updatePeers()
      currentID = connection.wsconn.id
    }

    /**
     * Will be called by CodemirrorView when doc has changed
     * @param update update event
     */
    update(update) {
      if (update.docChanged) {
        this.push()
      }
    }

    /**
     * Push shell
     */
    async pushShell() {
      if (!pendingShellUpdates.length) {
        return;
      }
      let spliceCount = 0;
      for (; spliceCount < pendingShellUpdates.length; spliceCount++) {
        const current = pendingShellUpdates[spliceCount];
        if (current.type === "info" && !runShells.get(
            current.uuid)[current.index].updated) {
          break;
        }
        if (current.type === "spawn" && !runnerShells.get(
            current.uuid).updated) {
          break;
        }
      }
      pendingShellUpdates.splice(0, spliceCount)
      const pushingCurrent = pendingShellUpdates.slice(0)
      await connection.pushShellUpdates(this.shellVersion, pushingCurrent);
      if (pendingShellUpdates.length) {
        this.pull().then(() => {
          if (connection.wsconn.ready) {
            setTimeout(() => {
              this.pushShell()
            }, 100)
          }
        })
      }
    }

    /**
     * Push text data
     * @returns {boolean} true if update succeeded
     */
    async push() {
      await this.pushMutex.runExclusive(async () => {
        let updates = sendableUpdates(this.view.state)
        if (!updates.length) {
          return false;
        }
        try {
          let version = getSyncedVersion(this.view.state)
          const res = await connection.pushUpdates(version, updates)
        } catch (e) {
          console.error(e)
        }
        // Regardless of whether the push failed or new updates came in
        // while it was running, try again if there's updates remaining
        if (sendableUpdates(this.view.state).length) {
          this.pull().then((e) => {
            if (e && connection.wsconn.ready) {
              setTimeout(() => {
                this.push()
              }, 100)
            }
          })
          return false;
        }
        return true;
      })
    }

    /**
     * Pull update function, uses semaphore to avoid race conditions
     */
    async pull() {
      const res = await this.pullMutex.runExclusive(async () => {
        try {
          // console.log("Pulling")
          let version = getSyncedVersion(this.view.state)
          let updates = await connection.pullUpdates(version, this.shellVersion)
          // console.log(version, updates)
          this.view.dispatch(receiveUpdates(this.view.state, updates.updates))
          // console.log("?")
          // console.log(`Updated to ${getSyncedVersion(this.view.state)}`)
          this.shellVersion += updates.shellUpdates.length
          for (const shellUpdate of updates.shellUpdates) {
            switch (shellUpdate.type) {
              case "spawn":
                runnerShells.set(shellUpdate.uuid, {
                  spawner: shellUpdate.spawner, updated: true
                })
                if (!runShells.has(shellUpdate.uuid)) {
                  runShells.set(shellUpdate.uuid, [])
                }
                break
              case "info":
                const currentShell = runShells.get(shellUpdate.uuid);
                while (shellUpdate.index >= currentShell.length) {
                  currentShell.push({
                    data: "", updated: false
                  })
                }
                currentShell[shellUpdate.index] = {
                  data: shellUpdate.data, updated: true
                }
                break
            }
          }
          if (updates.shellUpdates.length) {
            updateShells()
          }
          return true;
        } catch (e) {
          return false;
        }
      })
      return new Promise(resolve => {
        resolve(res)
      })

    }

    /**
     * Update peers
     */
    async updatePeers() {
      const ret = await connection.getPeers()
      currentID = ret.selfid
      peersStatus.innerHTML = (getPeersString(ret.ids)).innerHTML
      updatePeersButton(ret.ids)
    }
  })
  return [collab({startVersion}), plugin]
}

const DEFAULT_ROOM = 'welcome-room'
const DEFAULT_USERNAME = 'Anonymous ' + Math.floor(Math.random() * 100)
const roomStatus = document.getElementById("room-status")
const connectionStatus = document.getElementById("connection-status")
const pingStatus = document.getElementById("ping-status")
const peersStatus = document.getElementById("peers-status")
const connectionButton = document.getElementById("connect-button")
const roomNameInput = document.getElementById("room-name-input")
const usernameInput = document.getElementById("username-input")
const spawnButton = document.getElementById("spawn-button")
const compileFlagInput = document.getElementById("compile-flag")
const compileResult = document.getElementById("compile-result")
const shellsContainer = document.getElementById("shells-container")

// jQuery.event.special.touchstart = {
//   setup: function (_, ns, handle) {
//     if (ns.includes("noPreventDefault")) {
//       this.addEventListener("touchstart", handle, {passive: false});
//     } else {
//       this.addEventListener("touchstart", handle, {passive: true});
//     }
//   }
// };
// jQuery.event.special.touchmove = {
//   setup: function (_, ns, handle) {
//     if (ns.includes("noPreventDefault")) {
//       this.addEventListener("touchmove", handle, {passive: false});
//     } else {
//       this.addEventListener("touchmove", handle, {passive: true});
//     }
//   }
// };
// jQuery.event.special.wheel = {
//   setup: function (_, ns, handle) {
//     this.addEventListener("wheel", handle, {passive: true});
//   }
// };
// jQuery.event.special.mousewheel = {
//   setup: function (_, ns, handle) {
//     this.addEventListener("mousewheel", handle, {passive: true});
//   }
// };

$("#sidebar").mCustomScrollbar({
  theme: "dark", axis: "y", alwaysShowScrollbar: 2, scrollInertia: 200
});

let codemirrorView;
let currentState = {};
let subscribedTerminalId;
let subscribedSize;
let currentID;

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

const enterRoom = async ({roomName, username}) => {
  currentState = {roomName: roomName, username: username}
  connection = new Connection(username, roomName, userColor.color,
      userColor.light)

  if (runShells) {
    runShells.clear()
  }

  pendingShellUpdates = []
  runShells = new Map()
  runnerShells = new Map()

  const state = EditorState.create({
    doc: "",
    extensions: [keymap.of([indentWithTab]), basicSetup, cpp(),
      peerExtension(0, connection), testPlugins()]
  })

  codemirrorView = new EditorView({
    state,
    parent: /** @type {HTMLElement} */ (document.querySelector('#editor'))
  })

  currentState = {roomName: roomName, username: username}
  roomStatus.textContent = roomName
  if (subscribedTerminalId) {
    updateSubscribed()
  }
}

const getPeersString = (peers) => {
  const ret = document.createElement("ul")
  for (const [key, val] of Object.entries(peers)) {
    const cur = document.createElement("li");
    cur.innerHTML = (`${key} - ${val.name}\n`)
    cur.style.color = `${val.color}`
    if (key !== currentID) {
      const spawnOtherPeerButton = document.createElement("button")
      spawnOtherPeerButton.classList = "btn btn-warning btn-sm"
      spawnOtherPeerButton.id = `spawn-${key}`
      spawnOtherPeerButton.textContent = "Request Run"
      cur.append(spawnOtherPeerButton)
    }
    ret.appendChild(cur)
  }
  return ret;
}

const updatePeersButton = (peers) => {
  for (const [key, _] of Object.entries(peers)) {
    if (key === currentID) {
      continue;
    }
    const el = document.getElementById(`spawn-${key}`)
    el.addEventListener("click", () => {
      connection.sendToUser(key, "custom.message", JSON.stringify({
        type: "compile.request", source: currentID
      }))
    })
  }
}

window.addEventListener('load', () => {
  enterRoom(getEnterState())
})

connectionButton.addEventListener('click', () => {
  if (connection.wsconn.socket) {
    connection.disconnect()
    connectionButton.textContent = 'Connect'
    connectionButton.classList.replace("btn-danger", "btn-success")
    connectionStatus.textContent = "Offline"
    connectionStatus.classList.remove('online')
    connectionStatus.classList.add('offline')
    peersStatus.innerHTML = ""
  } else {
    const enterState = getEnterState()
    if (enterState.roomName !== currentState.roomName) {
      connection = null
      codemirrorView.destroy()
      enterRoom(enterState)
    } else {
      connection.reconnect()
    }
    connectionStatus.textContent = "Online"
    connectionStatus.classList.remove('offline')
    connectionStatus.classList.add('online')
    connectionButton.textContent = 'Disconnect'
    connectionButton.classList.replace("btn-success", "btn-danger")
  }
})

spawnButton.addEventListener("click", () => {
  const code = codemirrorView.state.doc.toString()
  ipcRenderer.send('compile.request', currentID, code)
})

const appendCompileHandler = (data) => {
  let tmpHtml = termToHtml.strings(data, termToHtml.themes.light.name)
  tmpHtml = /<pre[^>]*>((.|[\n\r])*)<\/pre>/im.exec(tmpHtml)[1];
  compileResult.innerHTML += tmpHtml
}

const replaceCompileHandler = (data) => {
  compileResult.innerHTML = data
}

const updateSubscribed = () => {
  const messages = runShells.get(subscribedTerminalId)
  let accumulated = ""
  for (let i = subscribedSize; i < messages.length; i++) {
    accumulated += messages[i].data
  }
  ipcRenderer.send('terminal.message.receive', accumulated,
      subscribedSize === 0)
  subscribedSize = messages.length
}

const messageHandler = (message) => {
  message = JSON.parse(message)
  switch (message.type) {
    case "compile.replace":
      replaceCompileHandler(message.message)
      break
    case "compile.append":
      appendCompileHandler(message.message)
      break
    case "compile.request":
      const code = (codemirrorView.state.doc.toString())
      ipcRenderer.send('compile.request', message.source, code)
      break
    case "shell.keystroke":
      ipcRenderer.send('terminal.keystroke.receive', message.terminalId,
          message.keystroke)
      break
  }
}

// Send a certain message to a target user-client-id
ipcRenderer.on("message.send", (event, target, message) => {
  if (target === "active-terminal") {
    target = runnerShells.get(subscribedTerminalId).spawner
    message.terminalId = subscribedTerminalId
    message = JSON.stringify(message)
  }
  if (target === currentID) {
    messageHandler(message)
  } else {
    connection.sendToUser(target, "custom.message", message)
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
ipcRenderer.on("terminal.uuid", (event, uuid, data) => {
  runnerShells.set(uuid, {
    spawner: currentID, updated: false
  })
  runShells.set(uuid, [])
  pendingShellUpdates.push({
    type: "spawn", spawner: currentID, uuid: uuid
  })
  updateShells()
  connection.plugin.pushShell()
})

// Updates terminal
ipcRenderer.on('terminal.update', (event, uuid, data) => {
  const history = runShells.get(uuid);
  for (const line of data) {
    history.push({
      data: line, updated: false
    })
    pendingShellUpdates.push({
      type: "info", data: line, index: history.length - 1, uuid: uuid
    })
  }
  updateShells()
  connection.plugin.pushShell()
})

/**
 * Tests Starts Here
 */


const log = require('electron-log');
const {doc} = require("lib0/dom");
const {timeout} = require("lib0/eventloop");
const {resolve} = require("lib0/promise");

function testPlugins() {
  return ViewPlugin.fromClass(class {
    constructor(view) {
    }

    update(update) {
      if (update.docChanged) {
        for (const inserted of update.changes.inserted) {
          // console.log(inserted)
          try {
            for (const timestamp of inserted.text) {
              if (timestamp === "") {
                continue;
              }
              const splitted = timestamp.split(",")
              if (splitted.length !== 2) {
                continue
              }
              const duration = Date.now() - parseInt(splitted[0]);
              // if (splitted[1] === currentID) {
              //   continue
              // }
              log.info(duration, splitted[1])
            }
          } catch {
          }
        }
      }
    }
  })
}

const randomCharacters = '\n\n\n\nABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}()+=*&^%-#/<>;"\'[]';
const randomLen = randomCharacters.length
const testButton = document.getElementById("test-button")
const randInt = (len) => {
  return Math.floor(Math.random() * (len));
}

const insertRandom = () => {
  const documentLength = (codemirrorView.state.doc.length);
  const insertPosition = randInt(documentLength + 1)
  let insertAmount = randInt(3) + 3
  // let insertAmount = 1;
  let insertText = "";
  while (insertAmount--) {
    const ranPos = randInt(randomLen);
    insertText += randomCharacters[ranPos]
  }
  codemirrorView.dispatch({
    changes: {
      from: insertPosition, insert: insertText
    },
  })
}

const replaceRandom = () => {

  let deleteAmount = randInt(3) + 3
  const documentLength = (codemirrorView.state.doc.length);
  const deletePosition = randInt(documentLength + 1)

  let insertAmount = randInt(3) + 3
  // let insertAmount = 1;
  let insertText = "";
  while (insertAmount--) {
    const ranPos = randInt(randomLen);
    insertText += randomCharacters[ranPos]
  }
  codemirrorView.dispatch({
    changes: {
      from: deletePosition,
      to: min(deletePosition + deleteAmount, documentLength),
      insert: insertText
    },
  })
}

const insertTimestamp = () => {
  const insertText = Date.now().toString() + ',' + currentID + '\n'
  codemirrorView.dispatch({
    changes: {
      from: 0, insert: insertText
    },
  })
}

const insertTimestampWithDeleteRandom = () => {
  const insertText = Date.now().toString() + ',' + currentID + '\n'

  let deleteAmount = randInt(3) + 10
  const documentLength = (codemirrorView.state.doc.length);
  const deletePosition = randInt(documentLength + 1)

  codemirrorView.dispatch({
    changes: {
      from: deletePosition,
      to: min(deletePosition + deleteAmount, documentLength),
      insert: insertText
    },
  })
}

const deleteRandom = () => {

  let deleteAmount = randInt(3) + 3
  const documentLength = (codemirrorView.state.doc.length);
  const deletePosition = randInt(documentLength + 1)

  codemirrorView.dispatch({
    changes: {
      from: deletePosition,
      to: min(deletePosition + deleteAmount, documentLength)
    },
  })
}

let activeInterval = null;
const insertTester = () => {
  activeInterval = setInterval(() => {
    insertTimestampWithDeleteRandom()
    // if (Math.random() > 0.3) {
    //   insertRandom()
    // } else {
    //   deleteRandom()
    // }
  }, 1000)
}

// This is a simple, *insecure* hash that's short, fast, and has no dependencies.
// For algorithmic use, where security isn't needed, it's way simpler than sha1 (and all its deps)
// or similar, and with a short, clean (base 36 alphanumeric) result.
// Loosely based on the Java version; see
// https://stackoverflow.com/questions/6122571/simple-non-secure-hash-function-for-javascript
const simpleHash = str => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash &= hash; // Convert to 32bit integer
  }
  return new Uint32Array([hash])[0].toString(36);
};

const scenarioOne = () => {
  const msLeft = Date.parse("2022-10-24T13:25:10.000+07:00") - Date.now()
  const msTestDuration = 10000; // 3 seconds
  setTimeout(() => {
    log.info("Test Start")
    const intervalInsert = setInterval(() => {
      const op = randInt(3)
      if (op === 0) {
        insertRandom()
      } else if (op === 1) {
        deleteRandom()
      } else {
        replaceRandom()
      }
    }, 100);
    setTimeout(() => {
      clearInterval(intervalInsert)
      log.info("Test Ends")
      // 3 seconds timeout to check resolving
      setTimeout(() => {
        log.info(simpleHash(codemirrorView.state.doc.toString()))
      }, 2000)
    }, msTestDuration)
  }, msLeft)

}

const checker = () => {
  if (codemirrorView && currentID) {
    log.transports.file.resolvePath = () => `out/${currentID}.log`
    log.info("Inserting test for " + currentID)
    // insertTester()
    scenarioOne()
  } else {
    setTimeout(checker, 1000)
  }
}

checker()

testButton.addEventListener("click", () => {
  if (activeInterval) {
    clearInterval(activeInterval)
    activeInterval = null;
  } else {
    insertTester()
  }

})