// Photon Realtime networking for 2 players.
// Event codes:
//   1 STATE      player position/velocity/facing/slot (15x per second)
//   2 TILES      batch of tile changes [[x, y, tileId], ...]
//   3 WORLD      seed + all modified tiles, sent by the Master Client to a new player
//   4 SWING      { k: "pickaxe" | "sword", a: aimAngle, f: facing, d: duration }
//   5 HIT        sword knockback on another player { t: targetActor, vx, vy }
//   6 REQ_WORLD  new player asks the Master Client for the world
(function () {
  const EV = { STATE: 1, TILES: 2, WORLD: 3, SWING: 4, HIT: 5, REQ_WORLD: 6 };

  function isConfigured() {
    const id = window.PHOTON_CONFIG && window.PHOTON_CONFIG.APP_ID;
    return !!id && id.indexOf("YOUR_PHOTON_APP_ID") === -1;
  }

  function available() {
    return !!(window.Photon && window.Photon.LoadBalancing);
  }

  // handlers: onStatus(text), onReady(info), onWorld(seed, mods), onTiles(list, actorNr),
  //           onState(actorNr, data), onSwing(actorNr, data), onHit(data),
  //           onPeerLeave(actorNr), onPeerJoin(actorNr), getWorldForSync() -> {seed, mods}
  function create(handlers) {
    const P = window.Photon;
    const LBC = P.LoadBalancing.LoadBalancingClient;
    const cfg = window.PHOTON_CONFIG;
    const lbc = new LBC(P.ConnectionProtocol.Wss, cfg.APP_ID, cfg.APP_VERSION);
    lbc.setLogLevel && lbc.setLogLevel(P.LogLevel ? P.LogLevel.WARN : 2);
    // Use the normal HTTPS port (443) instead of Photon's default 19093.
    // Many school/work/public networks block 19093; connecting to the
    // NameServer on 443 makes Photon hand out master/game servers on 443 too.
    lbc.setNameServerAddress("wss://ns.photonengine.io:443");

    let pending = null;        // { mode: "create" | "join", room }
    let worldReceived = false;
    let reqTimer = null;

    const net = {
      lbc,
      roomName: "",
      get actorNr() { return lbc.myActor() ? lbc.myActor().actorNr : 0; },
      isMaster() {
        return lbc.isJoinedToRoom() && lbc.myRoomMasterActorNr() === lbc.myActor().actorNr;
      },
      playerCount() { return lbc.isJoinedToRoom() ? lbc.myRoomActorCount() : 0; },
      connected() { return lbc.isJoinedToRoom(); },

      start(mode, room) {
        pending = { mode, room };
        net.roomName = room;
        handlers.onStatus("Connecting to Photon (" + cfg.REGION + ")...");
        lbc.connectToRegionMaster(cfg.REGION);
      },

      send(code, data, targetActor) {
        if (!lbc.isJoinedToRoom()) return;
        const opts = targetActor ? { targetActors: [targetActor] } : {};
        lbc.raiseEvent(code, data, opts);
      },
      sendState(s) { net.send(EV.STATE, s); },
      sendTiles(list) { if (list.length) net.send(EV.TILES, { c: list }); },
      sendSwing(s) { net.send(EV.SWING, s); },
      sendHit(h) { net.send(EV.HIT, h, h.t); },
      leave() { try { lbc.disconnect(); } catch (e) { /* ignore */ } }
    };

    lbc.onStateChange = function (state) {
      const name = LBC.StateToName(state);
      if (state === LBC.State.JoinedLobby && pending) {
        const p = pending;
        pending = null;
        if (p.mode === "create") {
          handlers.onStatus("Creating room \"" + p.room + "\"...");
          lbc.createRoom(p.room, { maxPlayers: 2 });
        } else {
          handlers.onStatus("Joining room \"" + p.room + "\"...");
          lbc.joinRoom(p.room);
        }
      } else if (state === LBC.State.Disconnected) {
        handlers.onStatus("Disconnected from Photon.");
        handlers.onDisconnect && handlers.onDisconnect();
      } else if (state !== LBC.State.Joined) {
        handlers.onStatus("Photon: " + name + "...");
      }
    };

    lbc.onError = function (code, msg) {
      console.warn("[Freeraria] Photon error", code, msg);
      let text = "Photon error " + code + ": " + msg;
      if (code >= 1001 && code <= 3005) {
        text += ". Your network, firewall, antivirus or a browser extension may be blocking the game. Try again, or try another network (e.g. phone hotspot).";
      }
      handlers.onStatus(text);
      handlers.onFail && handlers.onFail(text);
    };

    lbc.onOperationResponse = function (errorCode, errorMsg, code) {
      if (errorCode) {
        console.warn("[Freeraria] Photon operation failed", code, errorCode, errorMsg);
        let text = errorMsg || ("error " + errorCode);
        if (errorCode === 32758) text = "No room with that name. Check the spelling or create it.";
        if (errorCode === 32765) text = "That room is full (2 players max).";
        if (errorCode === 32766) text = "A room with that name already exists. Pick another name or join it.";
        handlers.onStatus(text);
        handlers.onFail && handlers.onFail(text);
      }
    };

    lbc.onJoinRoom = function (createdByMe) {
      net.roomName = lbc.myRoom().name;
      if (createdByMe) {
        handlers.onReady({ host: true, room: net.roomName });
      } else {
        handlers.onStatus("Joined. Downloading world from host...");
        const ask = () => {
          if (worldReceived || !lbc.isJoinedToRoom()) return;
          net.send(EV.REQ_WORLD, {}, lbc.myRoomMasterActorNr());
          reqTimer = setTimeout(ask, 2000); // retry until the host answers
        };
        ask();
      }
    };

    lbc.onActorJoin = function (actor) {
      if (actor.actorNr !== net.actorNr) handlers.onPeerJoin && handlers.onPeerJoin(actor.actorNr);
    };

    lbc.onActorLeave = function (actor) {
      handlers.onPeerLeave && handlers.onPeerLeave(actor.actorNr);
    };

    lbc.onEvent = function (code, content, actorNr) {
      switch (code) {
        case EV.STATE: handlers.onState(actorNr, content); break;
        case EV.TILES: handlers.onTiles(content.c || [], actorNr); break;
        case EV.SWING: handlers.onSwing(actorNr, content); break;
        case EV.HIT: handlers.onHit(content, actorNr); break;
        case EV.REQ_WORLD:
          if (net.isMaster()) {
            const w = handlers.getWorldForSync();
            net.send(EV.WORLD, { seed: w.seed, mods: w.mods }, actorNr);
          }
          break;
        case EV.WORLD:
          if (worldReceived) break;
          worldReceived = true;
          clearTimeout(reqTimer);
          handlers.onWorld(content.seed, content.mods || []);
          handlers.onReady({ host: false, room: net.roomName });
          break;
      }
    };

    return net;
  }

  window.Net = { EV, create, isConfigured, available };
})();
