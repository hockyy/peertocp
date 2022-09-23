# PeerToCP

Electron Project for WebRTC Based Code Editor, Compiler, and C++ runner.
There will be 4 versions of this app:

- Peer-to-Peer 
  - [modified y-webrtc  ](https://github.com/hockyy/y-webrtc)✅
  - CRDT y-text for code editor ✅
  - CRDT y-map for shell sharing ✅
- Client-Server 
  - [Own Websocket Server](https://github.com/hockyy/peertocp-server) ✅
     - Memakai [RPC-websockets](https://www.npmjs.com/package/rpc-websockets)
     - Library untuk semacam JSON-rpc (mirip rest api/ google rpc yang ada async awaitnya), tapi koneksinya pakai websocket
  - [@codemirror/collab OT](https://github.com/codemirror/collab), based on [Codemirror Collab Website Example](https://github.com/codemirror/website/tree/master/site/examples/collab) for code editor ✅
  - synchronized array for shell sharing -> Challenges is on how to synchronize, tapi harus bikin cara biar
    - Tidak race condition (shell output ga ke add dua kali di server)
    - Tidak polling (Tidak polling terus terusan untuk mengecek update)
- Client-Server
  - modified y-websocket
  - CRDT y-text for code editor ✅
  - CRDT y-map for shell sharing ✅
- Client-Server will be modified from [Codeshare by zerosnake0](https://github.com/zerosnake0/codeshare)
  - Own Websocket Server
  - shareDB OT [ot-text-unicode](https://github.com/ottypes/text-unicode)
  - shareDB OT [json-1](https://github.com/ottypes/json1)

All of them should be done by September 30th
