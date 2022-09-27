'use strict'

const {Terminal} = require("xterm");
const {ipcRenderer} = require("electron")
const DARK_MODE = {
  background: "#2e3436",
  black: "#2e3436",
  blue: "#3465a4",
  brightBlack: "#555753",
  brightBlue: "#729fcf",
  brightCyan: "#34e2e2",
  brightGreen: "#8ae234",
  brightPurple: "#ad7fa8",
  brightRed: "#ef2929",
  brightWhite: "#eeeeec",
  brightYellow: "#fce94f",
  cyan: "#06989a",
  foreground: "#d3d7cf",
  green: "#4e9a06",
  purple: "#75507b",
  red: "#cc0000",
  white: "#d3d7cf",
  yellow: "#c4a000"
}

const LIGHT_MODE = {
  "name": "Tango Light",
  "foreground": "#555753",
  "background": "#FFFFFF",
  "cursor": "#000000",
  "cursorAccent": "#000000",
  "black": "#000000",
  "red": "#CC0000",
  "green": "#4E9A06",
  "yellow": "#C4A000",
  "blue": "#3465A4",
  "purple": "#75507B",
  "cyan": "#06989A",
  "white": "#D3D7CF",
  "brightBlack": "#555753",
  "brightRed": "#EF2929",
  "brightGreen": "#8AE234",
  "brightYellow": "#FCE94F",
  "brightBlue": "#729FCF",
  "brightPurple": "#AD7FA8",
  "brightCyan": "#34E2E2",
  "brightWhite": "#EEEEEC"
}

const term = new Terminal({
  theme: LIGHT_MODE,
  rows: 30,
  cols: 80,
  cursorStyle: "bar",
});

term.open(document.getElementById('terminal'));

ipcRenderer.on("terminal.incomingData", (event, data) => {
  // console.log(data)
  term.write(data);
});

term.onData(e => {
  ipcRenderer.send("terminal.keystroke.send", e);
});