# PeerToCP

Electron Project for WebRTC Based Code Editor, Compiler, and C++ runner.
There are 3 versions of this app:

- CRDT Peer-to-Peer 
  - [modified y-webrtc](https://github.com/hockyy/y-webrtc) for network provider
  - CRDT y-text for code editor
  - CRDT y-map for shell sharing

- CRDT Client-Server
  - [modified y-websocket](https://github.com/hockyy/y-websocket) for network provider
  - CRDT y-text for code editor
  - CRDT y-map for shell sharing

- Operational Transformation Client-Server 
  - Uses [own WebSocket server](https://github.com/hockyy/peertocp-server)
     - Utilizes [RPC-websockets](https://www.npmjs.com/package/rpc-websockets) for network provider
       - It creates an abstraction for RPC calling over a websocket connection
  - [@codemirror/collab OT](https://github.com/codemirror/collab), based on [Codemirror Collab Website Example](https://github.com/codemirror/website/tree/master/site/examples/collab) for code editor
  - Synchronized array for shell sharing

