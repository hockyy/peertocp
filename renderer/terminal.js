'use strict'

const {Terminal} = require("xterm");
const {ipcRenderer} = require("electron")
const term = new Terminal();
term.open(document.getElementById('terminal'));

ipc.on("terminal.incomingData", (event, data) => {
    console.log("OK")
    term.write(data);
});

term.onData(e => {
    console.log("YESSs")
    ipcRenderer.send("terminal.keystroke", e);
});