# PeerToCP

Electron Project for WebRTC Based Code Editor, Compiler, and C++ runner.
There will be 4 versions of this app:

- Peer-to-Peer 
  - [modified y-webrtc  ](https://github.com/hockyy/y-webrtc)✅
  - CRDT y-text for code editor ✅
  - CRDT y-map for shell sharing ✅
- Client-Server 
  - [Own Websocket Server](https://github.com/hockyy/peertocp-server) ✅
  - [@codemirror/collab OT](https://github.com/codemirror/collab), based on [Codemirror Collab Website Example](https://github.com/codemirror/website/tree/master/site/examples/collab) for code editor ✅
  - centralized array for shell sharing
- Client-Server
  - modified y-websocket
  - CRDT y-text for code editor ✅
  - CRDT y-map for shell sharing ✅
- Client-Server will be modified from [Codeshare by zerosnake0](https://github.com/zerosnake0/codeshare)
  - Own Websocket Server
  - shareDB OT ot-text-unicode
  - shareDB OT json-1

All of them should be done by September 30th
