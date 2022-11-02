'use strict'

const {ipcRenderer} = require('electron');
const yjs = require("yjs");
const {WebrtcProvider} = require("y-webrtc");
const {yCollab, yUndoManagerKeymap} = require('y-codemirror.next');

const {basicSetup, EditorView} = require("codemirror");
const {keymap, ViewPlugin} = require("@codemirror/view");
const {EditorState} = require("@codemirror/state");
const {cpp} = require("@codemirror/lang-cpp");
const {indentWithTab} = require("@codemirror/commands");
const termToHtml = require('term-to-html')
const random = require('lib0/random')

const SIGNALLING_SERVER_URL = 'ws://crdt-p2p.hocky.id';
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

const updateShells = ([e]) => {
  if (e.constructor.name === "YMapEvent") {
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
  } else if (currentTestScenario === 4) {
    const targetShellID = Array.from(e.currentTarget._map.keys())[0];
    for (const delta of e.delta) {
      if (delta.insert) {
        const timeInput = parseInt(delta.insert)
        const timeDiff = Date.now() - timeInput;
        log.info(`shellProcess,${targetShellID},${timeDiff}`)
      }
    }
  }
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
    extensions: testPlugins !== null ? [
      keymap.of([...yUndoManagerKeymap, indentWithTab]),
      basicSetup,
      cpp(),
      yCollab(ytext, provider.awareness),
      testPlugins()
    ] : [
      keymap.of([...yUndoManagerKeymap, indentWithTab]),
      basicSetup,
      cpp(),
      yCollab(ytext, provider.awareness)
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

/**
 * Tests Starts Here
 */


const randRange = (l, r) => {
  return randInt(r - l + 1) + l;
}

const log = require('electron-log');
const {rand, uuidv4} = require("lib0/random");

const randomCharacters = '\n\n\n\nABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}()+=*&^%-#/<>;"\'[]';
const randomLen = randomCharacters.length
const testButton = document.getElementById("test-button")
const randInt = (len) => {
  return Math.floor(Math.random() * len);
}

// Scenario One Functions
let lastUpdateTimestamp;

const scenarioOnePlugins = () => {
  return ViewPlugin.fromClass(class {
    constructor(view) {
    }

    update(update) {
      if (update.docChanged) {
        lastUpdateTimestamp = Date.now().toString()
      }
    }
  })
}

const insertRandom = (l, r) => {
  const documentLength = (codemirrorView.state.doc.length);
  const insertPosition = randInt(documentLength + 1)
  let insertAmount = randRange(l, r)
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

const replaceRandom = (l, r) => {

  const deleteAmount = randRange(l, r)
  const documentLength = (codemirrorView.state.doc.length);
  const deletePosition = randInt(documentLength + 1)

  let insertAmount = randRange(l, r)
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

const deleteRandom = (l, r) => {

  let deleteAmount = randRange(l, r)
  const documentLength = (codemirrorView.state.doc.length);
  const deletePosition = randInt(documentLength + 1)

  codemirrorView.dispatch({
    changes: {
      from: deletePosition,
      to: min(deletePosition + deleteAmount, documentLength)
    },
  })
}

// Scenario Three Functions

const scenarioThreePlugins = () => {
  return ViewPlugin.fromClass(class {
    constructor(view) {
    }

    update(update) {
      if (update.docChanged) {
        lastUpdateTimestamp = Date.now().toString()
        for (const inserted of update.changes.inserted) {
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
              log.info(duration, splitted[1])
            }
          } catch {
          }
        }
      }
    }
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

const insertTimestampWithDeleteRandom = (l, r) => {
  const insertText = Date.now().toString() + ',' + currentID + '\n'

  let deleteAmount = randRange(l, r)
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

const stableStringify = require('fast-stable-stringify');
const {min} = require("lib0/math");
const {stringify} = require("lib0/json");

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

const SECOND = 1000
const MINUTE = 60 * SECOND

const goDisconnect = (startDisconnectTime, disconnectDuration) => {
  setTimeout(() => {
    connectionButton.click()
    log.info(`Disconnecting: ${Date.now().toString()}`)
    setTimeout(() => {
      connectionButton.click()
      log.info(`Connecting: ${Date.now().toString()}`)
    }, disconnectDuration)
  }, startDisconnectTime)

}

const scenarioOne = () => {
  goDisconnect(randRange(MINUTE, (MINUTE / 2) * 3), 30 * SECOND)
  log.info("Scenario One - Test Start")
  const testDuration = 3 * MINUTE; // 3 minutes
  const insertEvery = SECOND / 10;
  const intervalInsert = setInterval(() => {
    const op = randInt(3)
    if (op === 0) {
      insertRandom(2, 5)
    } else if (op === 1) {
      deleteRandom(1, 3)
    } else {
      replaceRandom(2, 5)
    }
  }, insertEvery);
  setTimeout(() => {
    log.info(`End Test: ${Date.now().toString()}`)
    clearInterval(intervalInsert)
    // A minute timeout to check resolving
    setTimeout(() => {
      log.info(`Last Update: ${lastUpdateTimestamp}`)
      log.info(`Exit Test: ${Date.now().toString()}`)
      log.info(simpleHash(codemirrorView.state.doc.toString()))
    }, MINUTE)
  }, testDuration)
}

const scenarioTwoCode = `#include <unistd.h>
#include <iostream>
#include <cstdlib>
using namespace std;
#include <random>
#include <chrono>
mt19937_64 rng(chrono::steady_clock::now().time_since_epoch().count()); //For LL
int main(){
  const int OneSecond = 1e6;
  const int HalfSecond = OneSecond>>1;
  for(int i = 1;i <= 100;i++){
    double sleepDuration = (rng()%OneSecond) + HalfSecond;
    usleep(sleepDuration);
    cout << rng() << flush << endl;
  }
  return 0;
}
`;

const scenarioTwo = () => {
  spawnButton.click()
  goDisconnect(randRange(10 * SECOND, 40 * SECOND), 20 * SECOND)
  log.info("Scenario Two - Test Start")
  const testDuration = 150 * SECOND
  setTimeout(() => {
    log.info(`End Test: ${Date.now().toString()}`)
    // A minute timeout to check resolving
    setTimeout(() => {
      log.info(`Last Update: ${lastUpdateTimestamp}`)
      log.info(`Exit Test: ${Date.now().toString()}`)
      log.info(simpleHash(stableStringify(Object.fromEntries(runShells))))
    }, MINUTE)
  }, testDuration)
}

const scenarioThree = () => {
  log.info("Scenario Three - Test Start")
  const testDuration = MINUTE; // 3 minutes
  const intervalInsert = setInterval(() => {
    const op = randInt(2)
    if (op === 0) {
      insertTimestamp()
    } else {
      insertTimestampWithDeleteRandom(10, 15)
    }
  }, SECOND);
  setTimeout(() => {
    log.info(`End Test: ${Date.now().toString()}`)
    clearInterval(intervalInsert)
    // A minute timeout to check resolving
    setTimeout(() => {
      log.info(`Last Update: ${lastUpdateTimestamp}`)
      log.info(`Exit Test: ${Date.now().toString()}`)
      log.info(simpleHash(codemirrorView.state.doc.toString()))
    }, MINUTE)
  }, testDuration)
}

const scenarioFourCode = `#include <unistd.h>
#include <iostream>
#include <cstdlib>
#include <random>
#include <chrono>
using namespace std;
using namespace chrono;
mt19937_64 rng(chrono::steady_clock::now().time_since_epoch().count()); //For LL
int main(){
  const int OneSecond = 1e6;
  const int HalfSecond = OneSecond>>1;
  for(int i = 1;i <= 100;i++){
    double sleepDuration = (rng()%OneSecond) + HalfSecond;
    usleep(sleepDuration);
    milliseconds ms = duration_cast< milliseconds >(
        system_clock::now().time_since_epoch()
    );
    cout << ms.count() << endl;
  }
  return 0;
}
`;

const scenarioFour = () => {
  spawnButton.click()
  log.info("Scenario Four - Test Start")
  const testDuration = 15 * SECOND
  setTimeout(() => {
    log.info(`End Test: ${Date.now().toString()}`)
    // A minute timeout to check resolving
    setTimeout(() => {
      log.info(`Last Update: ${lastUpdateTimestamp}`)
      log.info(`Exit Test: ${Date.now().toString()}`)
      log.info(simpleHash(stableStringify(Object.fromEntries(runShells))))
    }, SECOND)
  }, testDuration)
}

const testPlugins = scenarioOnePlugins;
const currentTestScenario = 1;
const logID = uuidv4()

const checker = () => {
  if (codemirrorView && currentID) {
    log.transports.file.resolvePath = () => `out/${logID}.log`
    log.info("Inserting test for " + currentID)
    log.info("logID is " + logID)
    const msLeft = Date.parse("2022-11-02T23:57:00.000+07:00") - Date.now()
    setTimeout(scenarioOne, msLeft)
    // setTimeout(() => {
    //   codemirrorView.dispatch({
    //     changes: {
    //       from: 0,
    //       to: codemirrorView.state.doc.length,
    //       insert: scenarioTwoCode
    //     },
    //   })
    // }, msLeft - 10 * SECOND)
    // setTimeout(scenarioTwo, msLeft)
    // setTimeout(scenarioThree, msLeft)
    // setTimeout(() => {
    //   codemirrorView.dispatch({
    //     changes: {
    //       from: 0,
    //       to: codemirrorView.state.doc.length,
    //       insert: scenarioFourCode
    //     },
    //   })
    // }, msLeft - 10 * SECOND)
    // setTimeout(scenarioFour, msLeft)
  } else {
    setTimeout(checker, SECOND)
  }
}

checker()

window.addEventListener('load', () => {
  enterRoom(getEnterState())
})
