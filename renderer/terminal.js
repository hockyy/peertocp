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
  background: "#FCFFF3",
  black: "#000000",
  blue: "#3465A4",
  brightBlack: "#555753",
  brightBlue: "#729FCF",
  brightCyan: "#34E2E2",
  brightGreen: "#78C42D",
  brightPurple: "#AD7FA8",
  brightRed: "#EF2929",
  brightWhite: "#D4D4D2",
  brightYellow: "#FCE94F",
  cursorColor: "#000000",
  cyan: "#06989A",
  foreground: "#555753",
  green: "#4E9A06",
  purple: "#75507B",
  red: "#CC0000",
  selectionBackground: "#CFCDBC",
  white: "#D3D7CF",
  yellow: "#C4A000"
}

const term = new Terminal({
  theme: DARK_MODE,
  rows: 30,
  cols: 80,
  cursorStyle: "bar",
});
w
term.open(document.getElementById('terminal'));

ipcRenderer.on("terminal.incomingData", (event, data) => {
  term.write(data);
});

term.onData(e => {
  ipcRenderer.send("terminal.keystroke", e);
});