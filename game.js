// Freeraria test build: game loop, player, tools, swings, rendering, UI.
(function () {
  "use strict";

  const TS = 16;                       // tile size in texture pixels
  const T = WorldGen.T;
  const REACH = 5.5;                   // tiles, from player center to tile center
  const SOLID = { [T.GRASS]: true, [T.DIRT]: true, [T.STONE]: true };
  const HARDNESS = { [T.GRASS]: 2, [T.DIRT]: 2, [T.STONE]: 4, [T.WOOD]: 3, [T.LEAVES]: 1, [T.DOOR_BOTTOM]: 2, [T.DOOR_TOP]: 2 };
  const TILE_COLOR = { [T.GRASS]: "#4caf3c", [T.DIRT]: "#8a5a32", [T.STONE]: "#7d7d86", [T.WOOD]: "#9c6a3a", [T.LEAVES]: "#2f8a2a", [T.DOOR_BOTTOM]: "#a8743f", [T.DOOR_TOP]: "#a8743f" };

  // Hotbar: slots 1-3 tools, 4-8 placeables.
  const ITEMS = [
    { name: "Wooden Pickaxe", kind: "pickaxe", icon: "woodPick", power: 1,   swing: 0.30 },
    { name: "Pickaxe",        kind: "pickaxe", icon: "pick",     power: 2.5, swing: 0.20 },
    { name: "Wooden Sword",   kind: "sword",   icon: "sword",                swing: 0.24 },
    { name: "Grass Block",    kind: "block",   icon: "grass",    tile: T.GRASS },
    { name: "Dirt Block",     kind: "block",   icon: "dirt",     tile: T.DIRT },
    { name: "Stone Block",    kind: "block",   icon: "stone",    tile: T.STONE },
    { name: "Wood",           kind: "block",   icon: "wood",     tile: T.WOOD },
    { name: "Wooden Door",    kind: "door",    icon: "door",     tile: T.DOOR_BOTTOM }
  ];
  const DROP_SLOT = { [T.GRASS]: 3, [T.DIRT]: 4, [T.STONE]: 5, [T.WOOD]: 6, [T.LEAVES]: 6, [T.DOOR_BOTTOM]: 7 };
  const START_COUNTS = [0, 0, 0, 20, 50, 50, 30, 5];

  const PLAYER_COLORS = ["#3b6fd1", "#d14b3b", "#d1a23b", "#8a3bd1"];

  // ---------------------------------------------------------------- state
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const ui = {
    overlay: document.getElementById("overlay"),
    status: document.getElementById("status"),
    name: document.getElementById("nameInput"),
    seed: document.getElementById("seedInput"),
    room: document.getElementById("roomInput"),
    create: document.getElementById("btnCreate"),
    join: document.getElementById("btnJoin"),
    solo: document.getElementById("btnSolo")
  };

  let images = null;
  let world = null;
  const mods = new Map();              // tile index -> tileId, every change since generation
  let net = null;
  let running = false;
  let zoom = 3;
  let cam = { x: 0, y: 0 };
  let counts = START_COUNTS.slice();
  let lastBlockSlot = 4;
  let placeCooldown = 0;
  let mining = { x: -1, y: -1, dmg: 0, t: 0 };
  let netTimer = 0;
  const remotes = new Map();
  const particles = [];
  const flashes = [];
  const toasts = [];
  let fps = 0, fpsAcc = 0, fpsFrames = 0;

  const keys = {};
  const mouse = { x: 0, y: 0, left: false, right: false };

  const player = {
    x: 0, y: 0, w: 12, h: 28, vx: 0, vy: 0, onGround: false,
    facing: 1, slot: 0, swing: null, name: "Player", color: PLAYER_COLORS[0],
    walk: 0, hurt: 0
  };

  // ---------------------------------------------------------------- helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const deg = (d) => d * Math.PI / 180;

  function toast(text) {
    toasts.push({ text, t: 4 });
    console.log("[Freeraria] " + text);
  }

  function getTile(x, y) {
    if (y < 0) return T.AIR;
    if (x < 0 || x >= world.W || y >= world.H) return T.STONE; // world edges act like walls
    return world.tiles[y * world.W + x];
  }

  function setTile(x, y, id) {
    if (x < 0 || x >= world.W || y < 0 || y >= world.H) return;
    const i = y * world.W + x;
    world.tiles[i] = id;
    mods.set(i, id);
  }

  function isSolid(x, y) { return !!SOLID[getTile(x, y)]; }

  function rectHitsSolid(x, y, w, h) {
    const x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 0.001) / TS);
    const y0 = Math.floor(y / TS), y1 = Math.floor((y + h - 0.001) / TS);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++)
        if (isSolid(tx, ty)) return true;
    return false;
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function shoulder(p) { return { x: p.x + p.w / 2, y: p.y + 11 }; }

  function mouseWorld() {
    return { x: mouse.x / zoom + cam.x, y: mouse.y / zoom + cam.y };
  }

  function inReach(tx, ty) {
    const cx = player.x + player.w / 2, cy = player.y + player.h / 2;
    const dx = (tx + 0.5) * TS - cx, dy = (ty + 0.5) * TS - cy;
    return Math.hypot(dx, dy) <= REACH * TS;
  }

  function seedFromText(text) {
    text = (text || "").trim();
    if (!text) return (Math.random() * 0x7fffffff) | 0;
    if (/^-?\d+$/.test(text)) return parseInt(text, 10) | 0;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h | 0;
  }

  // ---------------------------------------------------------------- world
  function buildWorld(seed, modList) {
    world = WorldGen.generate(seed);
    world.horizon = Math.round(world.surface.reduce((a, b) => a + b, 0) / world.W);
    mods.clear();
    (modList || []).forEach(([x, y, id]) => setTile(x, y, id));
  }

  function worldForSync() {
    const list = [];
    mods.forEach((id, i) => list.push([i % world.W, (i / world.W) | 0, id]));
    return { seed: world.seed, mods: list };
  }

  function spawnPlayer() {
    const tx = Math.floor(world.W / 2);
    let ty = 0;
    while (ty < world.H && !isSolid(tx, ty) && !isSolid(tx + 1, ty)) ty++;
    player.x = tx * TS + 2;
    player.y = ty * TS - player.h - 1;
    player.vx = player.vy = 0;
    cam.x = player.x - canvas.width / zoom / 2;
    cam.y = player.y - canvas.height / zoom / 2;
  }

  // Removes a tile plus anything that depends on it (door halves, tree above).
  // Returns the list of changes and gives the drops to the local player if `give`.
  function breakTile(x, y, give) {
    const changes = [];
    const remove = (tx, ty) => {
      const id = getTile(tx, ty);
      if (id === T.AIR) return;
      setTile(tx, ty, T.AIR);
      changes.push([tx, ty, T.AIR]);
      burst(tx, ty, TILE_COLOR[id], 6);
      if (give && DROP_SLOT[id] !== undefined) counts[DROP_SLOT[id]]++;
    };
    const fellAbove = (tx, ty) => {
      let yy = ty - 1;
      while (getTile(tx, yy) === T.WOOD || getTile(tx, yy) === T.LEAVES) { remove(tx, yy); yy--; }
    };

    const id = getTile(x, y);
    if (id === T.DOOR_BOTTOM) {
      remove(x, y);
      if (getTile(x, y - 1) === T.DOOR_TOP) { setTile(x, y - 1, T.AIR); changes.push([x, y - 1, T.AIR]); }
    } else if (id === T.DOOR_TOP) {
      setTile(x, y, T.AIR); changes.push([x, y, T.AIR]);
      if (getTile(x, y + 1) === T.DOOR_BOTTOM) remove(x, y + 1);
    } else {
      remove(x, y);
      if (id === T.WOOD || id === T.LEAVES) fellAbove(x, y);
    }
    // Things standing on the removed block fall with it
    const above = getTile(x, y - 1);
    if (SOLID[id] && (above === T.WOOD || above === T.LEAVES)) fellAbove(x, y);
    if (SOLID[id] && above === T.DOOR_BOTTOM) {
      remove(x, y - 1);
      if (getTile(x, y - 2) === T.DOOR_TOP) { setTile(x, y - 2, T.AIR); changes.push([x, y - 2, T.AIR]); }
    }
    return changes;
  }

  function tryPlace(slot, tx, ty) {
    const item = ITEMS[slot];
    if (!item || (item.kind !== "block" && item.kind !== "door")) return false;
    if (counts[slot] <= 0 || !inReach(tx, ty)) return false;
    if (tx < 0 || tx >= world.W || ty < 1 || ty >= world.H) return false;

    const occupied = (px, py, pw, ph) => {
      if (rectsOverlap(px, py, pw, ph, player.x, player.y, player.w, player.h)) return true;
      for (const r of remotes.values()) if (rectsOverlap(px, py, pw, ph, r.x, r.y, 12, 28)) return true;
      return false;
    };

    let changes;
    if (item.kind === "door") {
      if (getTile(tx, ty) !== T.AIR || getTile(tx, ty - 1) !== T.AIR || !isSolid(tx, ty + 1)) return false;
      setTile(tx, ty, T.DOOR_BOTTOM);
      setTile(tx, ty - 1, T.DOOR_TOP);
      changes = [[tx, ty, T.DOOR_BOTTOM], [tx, ty - 1, T.DOOR_TOP]];
    } else {
      if (getTile(tx, ty) !== T.AIR) return false;
      const touching = getTile(tx - 1, ty) || getTile(tx + 1, ty) || getTile(tx, ty - 1) || getTile(tx, ty + 1);
      if (!touching) return false;
      if (SOLID[item.tile] && occupied(tx * TS, ty * TS, TS, TS)) return false;
      setTile(tx, ty, item.tile);
      changes = [[tx, ty, item.tile]];
    }
    counts[slot]--;
    if (net) net.sendTiles(changes);
    return true;
  }

  // ---------------------------------------------------------------- effects
  function burst(tx, ty, color, n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: (tx + 0.2 + Math.random() * 0.6) * TS, y: (ty + 0.2 + Math.random() * 0.6) * TS,
        vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 140 - 20,
        life: 0.5 + Math.random() * 0.4, color: color || "#ccc"
      });
    }
  }

  // ---------------------------------------------------------------- swings
  // Angle (radians, screen space, y down) of the tool at progress p in [0,1].
  function swingAngle(sw, p) {
    if (sw.kind === "sword") {
      const e = 1 - Math.pow(1 - p, 4);               // fast, wide slash
      return sw.aim + sw.facing * deg(lerp(-120, 80, e));
    }
    const e = p < 0.25 ? -0.15 * Math.sin(p / 0.25 * Math.PI) : 1 - Math.pow(1 - (p - 0.25) / 0.75, 3);
    return sw.aim + sw.facing * deg(lerp(-105, 35, e)); // short wind-up, then snap down
  }

  function startSwing(item) {
    const s = shoulder(player);
    const m = mouseWorld();
    const aim = Math.atan2(m.y - s.y, m.x - s.x);
    player.facing = Math.cos(aim) >= 0 ? 1 : -1;
    player.swing = { kind: item.kind, aim, facing: player.facing, t: 0, dur: item.swing, hit: false, power: item.power || 0, icon: item.icon };
    if (net) net.sendSwing({ k: item.kind, i: item.icon, a: +aim.toFixed(3), f: player.facing, d: item.swing });
  }

  function swingImpact(sw) {
    if (sw.kind === "pickaxe") {
      const m = mouseWorld();
      const tx = Math.floor(m.x / TS), ty = Math.floor(m.y / TS);
      const id = getTile(tx, ty);
      if (id === T.AIR || !inReach(tx, ty) || tx < 0 || tx >= world.W || ty >= world.H) return;
      if (mining.x !== tx || mining.y !== ty) mining = { x: tx, y: ty, dmg: 0, t: 0 };
      mining.dmg += sw.power;
      mining.t = 0;
      flashes.push({ x: tx, y: ty, t: 0.12 });
      burst(tx, ty, TILE_COLOR[id], 2);
      if (mining.dmg >= (HARDNESS[id] || 2)) {
        const changes = breakTile(tx, ty, true);
        if (net) net.sendTiles(changes);
        mining = { x: -1, y: -1, dmg: 0, t: 0 };
      }
    } else if (sw.kind === "sword" && net) {
      const s = shoulder(player);
      for (const [actor, r] of remotes) {
        const dx = r.x + 6 - s.x, dy = r.y + 14 - s.y;
        if (Math.hypot(dx, dy) < 34 && dx * sw.facing > -6) {
          net.sendHit({ t: actor, vx: sw.facing * 260, vy: -220 });
          r.hurt = 0.25;
        }
      }
    }
  }

  // ---------------------------------------------------------------- physics
  function movePlayer(dt) {
    const left = keys.KeyA || keys.ArrowLeft, right = keys.KeyD || keys.ArrowRight;
    const jump = keys.KeyW || keys.ArrowUp || keys.Space;
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    const target = dir * 125;
    const accel = player.onGround ? 1300 : 750;
    if (dir !== 0) {
      player.vx += clamp(target - player.vx, -accel * dt, accel * dt);
      if (!player.swing) player.facing = dir;
    } else {
      const fr = player.onGround ? 1600 : 300;
      player.vx -= clamp(player.vx, -fr * dt, fr * dt);
    }
    if (jump && player.onGround) { player.vy = -370; player.onGround = false; }
    if (!jump && player.vy < -160) player.vy = -160; // short hop when the key is released
    player.vy = Math.min(player.vy + 1400 * dt, 700);

    // Horizontal: 1px steps, with automatic step-up onto 1-tile ledges
    let dx = player.vx * dt;
    while (Math.abs(dx) > 0) {
      const step = clamp(dx, -1, 1);
      if (!rectHitsSolid(player.x + step, player.y, player.w, player.h)) {
        player.x += step;
      } else if (player.onGround && !rectHitsSolid(player.x + step, player.y - TS, player.w, player.h)) {
        // find the smallest lift that clears the ledge
        let lift = 1;
        while (lift <= TS && rectHitsSolid(player.x + step, player.y - lift, player.w, player.h)) lift++;
        player.y -= lift;
        player.x += step;
      } else {
        player.vx = 0; break;
      }
      dx -= step;
    }

    // Vertical
    let dy = player.vy * dt;
    player.onGround = false;
    while (Math.abs(dy) > 0) {
      const step = clamp(dy, -1, 1);
      if (!rectHitsSolid(player.x, player.y + step, player.w, player.h)) {
        player.y += step;
      } else {
        if (step > 0) player.onGround = true;
        player.vy = 0; break;
      }
      dy -= step;
    }
    if (!player.onGround && player.vy >= 0 && rectHitsSolid(player.x, player.y + 1, player.w, player.h)) player.onGround = true;

    player.walk = player.onGround && Math.abs(player.vx) > 10 ? player.walk + dt * Math.abs(player.vx) / 12 : 0;
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    movePlayer(dt);

    const item = ITEMS[player.slot];

    // Swing timing
    if (player.swing) {
      const sw = player.swing;
      sw.t += dt;
      if (!sw.hit && sw.t / sw.dur >= 0.55) { sw.hit = true; swingImpact(sw); }
      if (sw.t >= sw.dur) player.swing = null;
    }

    // Holding left-click repeats swings / placement
    placeCooldown -= dt;
    const m = mouseWorld();
    const tx = Math.floor(m.x / TS), ty = Math.floor(m.y / TS);
    if (mouse.left) {
      if ((item.kind === "pickaxe" || item.kind === "sword") && !player.swing) startSwing(item);
      if ((item.kind === "block" || item.kind === "door") && placeCooldown <= 0) {
        if (tryPlace(player.slot, tx, ty)) placeCooldown = 0.15;
      }
    }
    if (mouse.right && placeCooldown <= 0) {
      const slot = (item.kind === "block" || item.kind === "door") ? player.slot : lastBlockSlot;
      if (tryPlace(slot, tx, ty)) placeCooldown = 0.15;
    }

    // Mining damage fades if you stop hitting
    mining.t += dt;
    if (mining.t > 2) mining = { x: -1, y: -1, dmg: 0, t: 0 };

    if (player.hurt > 0) player.hurt -= dt;

    // Remote players: smooth toward the latest known position
    for (const r of remotes.values()) {
      r.tx += r.vx * dt; r.ty += r.vy * dt * 0.5; // small extrapolation between packets
      const k = Math.min(1, dt * 14);
      r.x += (r.tx - r.x) * k;
      r.y += (r.ty - r.y) * k;
      r.walk = Math.abs(r.vx) > 10 ? r.walk + dt * Math.abs(r.vx) / 12 : 0;
      if (r.swing) { r.swing.t += dt; if (r.swing.t >= r.swing.dur) r.swing = null; }
      if (r.hurt > 0) r.hurt -= dt;
    }

    // Particles / flashes / toasts
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 600 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = flashes.length - 1; i >= 0; i--) { flashes[i].t -= dt; if (flashes[i].t <= 0) flashes.splice(i, 1); }
    for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].t -= dt; if (toasts[i].t <= 0) toasts.splice(i, 1); }

    // Network state (15 Hz)
    if (net && net.connected()) {
      netTimer -= dt;
      if (netTimer <= 0) {
        netTimer = 1 / 15;
        net.sendState({
          x: Math.round(player.x * 10) / 10, y: Math.round(player.y * 10) / 10,
          vx: Math.round(player.vx), vy: Math.round(player.vy),
          f: player.facing, s: player.slot, n: player.name
        });
      }
    }

    // Camera
    const vw = canvas.width / zoom, vh = canvas.height / zoom;
    const tcx = player.x + player.w / 2 - vw / 2, tcy = player.y + player.h / 2 - vh / 2;
    cam.x += (tcx - cam.x) * Math.min(1, dt * 10);
    cam.y += (tcy - cam.y) * Math.min(1, dt * 10);
    const maxX = world.W * TS - vw, maxY = world.H * TS - vh;
    cam.x = maxX < 0 ? maxX / 2 : clamp(cam.x, 0, maxX);
    cam.y = clamp(cam.y, -vh * 0.5, Math.max(maxY, 0));
  }

  // ---------------------------------------------------------------- render
  function drawBackground() {
    const bg = images.background;
    const scale = Math.max(1, Math.ceil(canvas.height / bg.height));
    const w = bg.width * scale, h = bg.height * scale;
    const off = -((cam.x * zoom * 0.2) % w + w) % w;
    // Keep the painted mountains near the terrain horizon, with half-speed vertical parallax.
    const horizon = (world.horizon + 2) * TS;
    const viewMid = cam.y + canvas.height / zoom / 2;
    const bottom = Math.round(canvas.height / 2 + (horizon - viewMid) * zoom * 0.5 + h * 0.08);
    ctx.fillStyle = "#1b1f4a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#2f9e3a";
    ctx.fillRect(0, bottom - 2, canvas.width, canvas.height);
    for (let x = off; x < canvas.width; x += w) ctx.drawImage(bg, Math.floor(x), bottom - h, w, h);
  }

  function drawPlayerBody(p, isLocal) {
    const sw = p.swing;
    let lunge = 0, armAngle = null, p01 = 0;
    if (sw) {
      p01 = Math.min(1, sw.t / sw.dur);
      armAngle = swingAngle(sw, p01);
      if (sw.kind === "sword") lunge = sw.facing * 2.5 * Math.sin(p01 * Math.PI);
    }
    const x = Math.round(p.x + lunge), y = Math.round(p.y);
    const f = sw ? sw.facing : p.facing;
    const legSwing = Math.round(Math.sin(p.walk) * 2);
    const hurt = p.hurt > 0;

    // legs
    ctx.fillStyle = hurt ? "#ff6060" : "#2d3550";
    ctx.fillRect(x + 2, y + 20, 3, 8 - Math.max(0, legSwing));
    ctx.fillRect(x + 7, y + 20, 3, 8 - Math.max(0, -legSwing));
    // shoes
    ctx.fillStyle = "#3a2414";
    ctx.fillRect(x + 2 + (f > 0 ? 0 : -1), y + 27 - Math.max(0, legSwing), 4, 1);
    ctx.fillRect(x + 7 + (f > 0 ? 0 : -1), y + 27 - Math.max(0, -legSwing), 4, 1);
    // shirt
    ctx.fillStyle = hurt ? "#ff8080" : p.color;
    ctx.fillRect(x + 2, y + 10, 8, 11);
    // head + hair + eye
    ctx.fillStyle = hurt ? "#ffb0a0" : "#f1c79b";
    ctx.fillRect(x + 2, y + 1, 8, 9);
    ctx.fillStyle = "#5a3a1e";
    ctx.fillRect(x + 1, y, 10, 3);
    ctx.fillRect(f > 0 ? x + 1 : x + 9, y + 2, 2, 4);
    ctx.fillStyle = "#1a1a2a";
    ctx.fillRect(f > 0 ? x + 7 : x + 4, y + 5, 1, 2);

    const sx = x + p.w / 2, sy = y + 11;
    if (sw) {
      const img = images[sw.icon] || images.woodPick;

      // sword trail: translucent arc from the start angle to now
      if (sw.kind === "sword") {
        const a0 = swingAngle(sw, 0), a1 = armAngle;
        ctx.save();
        ctx.globalAlpha = 0.28 * (1 - p01 * 0.6);
        ctx.fillStyle = "#f4f0d8";
        ctx.beginPath();
        ctx.arc(sx, sy, 24, a0, a1, sw.facing < 0);
        ctx.arc(sx, sy, 9, a1, a0, sw.facing > 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // tool sprite: handle at the hand, rotated to the swing angle
      ctx.save();
      ctx.translate(sx + Math.cos(armAngle) * 6, sy + Math.sin(armAngle) * 6);
      if (sw.facing > 0) {
        ctx.rotate(armAngle + Math.PI / 4);
      } else {
        ctx.scale(-1, 1);
        ctx.rotate(Math.PI - armAngle + Math.PI / 4);
      }
      ctx.drawImage(img, -3, -13, 16, 16);
      ctx.restore();

      // arm toward the tool
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(armAngle);
      ctx.fillStyle = "#f1c79b";
      ctx.fillRect(0, -1.5, 7, 3);
      ctx.restore();
    } else {
      ctx.fillStyle = "#f1c79b";
      ctx.fillRect(f > 0 ? x + 5 : x + 4, y + 12, 3, 7);
    }
  }

  function render() {
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground();

    const ox = Math.round(cam.x * zoom), oy = Math.round(cam.y * zoom);
    ctx.setTransform(zoom, 0, 0, zoom, -ox, -oy);

    const vx0 = Math.max(0, Math.floor(cam.x / TS) - 1), vy0 = Math.max(0, Math.floor(cam.y / TS) - 2);
    const vx1 = Math.min(world.W - 1, Math.ceil((cam.x + canvas.width / zoom) / TS) + 1);
    const vy1 = Math.min(world.H - 1, Math.ceil((cam.y + canvas.height / zoom) / TS) + 1);

    // underground back wall where the ground was dug out / caves
    ctx.fillStyle = "#241c17";
    for (let x = vx0; x <= vx1; x++) {
      const top = Math.max(vy0, world.surface[x] + 1);
      for (let y = top; y <= vy1; y++) if (getTile(x, y) === T.AIR || getTile(x, y) >= T.WOOD) ctx.fillRect(x * TS, y * TS, TS, TS);
    }

    // tiles
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const id = world.tiles[y * world.W + x];
        if (id === T.AIR || id === T.DOOR_TOP) continue;
        const px = x * TS, py = y * TS;
        switch (id) {
          case T.GRASS: ctx.drawImage(images.grass, px, py, TS, TS); break;
          case T.DIRT: ctx.drawImage(images.dirt, px, py, TS, TS); break;
          case T.STONE: ctx.drawImage(images.stone, px, py, TS, TS); break;
          case T.WOOD: case T.LEAVES: ctx.drawImage(images.wood, px, py, TS, TS); break;
          case T.DOOR_BOTTOM: ctx.drawImage(images.door, px, py - TS, TS, TS * 2); break;
        }
      }
    }

    // mining cracks
    if (mining.x >= 0) {
      const id = getTile(mining.x, mining.y);
      const r = clamp(mining.dmg / (HARDNESS[id] || 2), 0, 1);
      const px = mining.x * TS, py = mining.y * TS;
      ctx.fillStyle = "rgba(0,0,0," + (0.15 + r * 0.35) + ")";
      const n = Math.ceil(r * 4);
      const cracks = [[3, 3, 5, 1], [8, 4, 1, 6], [4, 10, 7, 1], [11, 9, 1, 4]];
      for (let i = 0; i < n; i++) { const c = cracks[i]; ctx.fillRect(px + c[0], py + c[1], c[2], c[3]); }
    }

    // canopies
    for (let y = vy0; y <= Math.min(world.H - 1, vy1 + 2); y++)
      for (let x = vx0; x <= vx1; x++)
        if (world.tiles[y * world.W + x] === T.LEAVES)
          ctx.drawImage(images.leaves, x * TS + 8 - 16, y * TS + 10 - 32, 32, 32);

    // players
    for (const r of remotes.values()) drawPlayerBody(r, false);
    drawPlayerBody(player, true);

    // particles
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 2, 2);
    }
    ctx.globalAlpha = 1;

    // hit flash
    for (const f of flashes) {
      ctx.fillStyle = "rgba(255,255,255," + (f.t / 0.12 * 0.65) + ")";
      ctx.fillRect(f.x * TS, f.y * TS, TS, TS);
    }

    // cursor cell
    const m = mouseWorld();
    const ctx_ = Math.floor(m.x / TS), cty = Math.floor(m.y / TS);
    const item = ITEMS[player.slot];
    const h = item.kind === "door" ? 2 : 1;
    ctx.lineWidth = 1 / zoom * 2;
    ctx.strokeStyle = inReach(ctx_, cty) ? "rgba(255,255,255,0.8)" : "rgba(255,80,80,0.6)";
    ctx.strokeRect(ctx_ * TS, (cty - h + 1) * TS, TS, TS * h);

    drawUI();
  }

  function drawIcon(img, x, y, size) {
    if (img.height > img.width) {
      const s = size / img.height;
      ctx.drawImage(img, x + (size - img.width * s) / 2, y, img.width * s, size);
    } else {
      ctx.drawImage(img, x, y, size, size);
    }
  }

  function drawUI() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.font = "bold 12px 'Courier New', monospace";
    ctx.textBaseline = "top";

    // names over remote players
    for (const r of remotes.values()) {
      const sx = (r.x + 6) * zoom - Math.round(cam.x * zoom), sy = r.y * zoom - Math.round(cam.y * zoom) - 16;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(r.name, sx + 1, sy + 1);
      ctx.fillStyle = "#fff";
      ctx.fillText(r.name, sx, sy);
    }

    // hotbar
    const slot = 44, pad = 4, x0 = 12, y0 = 24;
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.fillText(ITEMS[player.slot].name, x0, 6);
    for (let i = 0; i < ITEMS.length; i++) {
      const x = x0 + i * (slot + pad), y = y0;
      const sel = i === player.slot;
      ctx.fillStyle = sel ? "rgba(255,220,90,0.9)" : "rgba(40,50,90,0.85)";
      ctx.fillRect(x - 2, y - 2, slot + 4, slot + 4);
      ctx.fillStyle = sel ? "rgba(70,80,140,0.95)" : "rgba(60,72,128,0.85)";
      ctx.fillRect(x, y, slot, slot);
      drawIcon(images[ITEMS[i].icon], x + 6, y + 6, 32);
      ctx.fillStyle = "#e8ecff";
      ctx.fillText(String(i + 1), x + 3, y + 2);
      if (ITEMS[i].kind === "block" || ITEMS[i].kind === "door") {
        ctx.textAlign = "right";
        ctx.fillStyle = counts[i] > 0 ? "#fff" : "#ff7070";
        ctx.fillText(String(counts[i]), x + slot - 3, y + slot - 14);
        ctx.textAlign = "left";
      }
    }

    // status (top right)
    const lines = [];
    if (net && net.connected()) {
      lines.push("Room: " + net.roomName + (net.isMaster() ? " (host)" : ""));
      lines.push("Players: " + net.playerCount() + "/2");
    } else {
      lines.push(net ? "Offline (connection lost)" : "Solo offline test");
    }
    lines.push("Seed: " + world.seed);
    lines.push("X " + Math.floor((player.x + 6) / TS) + "  Y " + Math.floor((player.y + 28) / TS) + "   " + fps + " fps");
    ctx.textAlign = "right";
    lines.forEach((l, i) => {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(l, canvas.width - 11, 9 + i * 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(l, canvas.width - 12, 8 + i * 16);
    });

    // toasts
    ctx.textAlign = "center";
    toasts.forEach((t, i) => {
      ctx.globalAlpha = clamp(t.t, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const w = ctx.measureText(t.text).width + 16;
      ctx.fillRect(canvas.width / 2 - w / 2, 84 + i * 22, w, 20);
      ctx.fillStyle = "#ffe08a";
      ctx.fillText(t.text, canvas.width / 2, 88 + i * 22);
    });
    ctx.globalAlpha = 1;

    // controls
    ctx.textAlign = "left";
    ctx.font = "11px 'Courier New', monospace";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText("A/D move  W/Space jump  1-8/wheel select  LMB use  RMB place  +/- zoom  R respawn", 12, canvas.height - 18);
  }

  // ---------------------------------------------------------------- loop
  let lastTime = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
    lastTime = now;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    if (running) { update(dt); render(); }
    requestAnimationFrame(frame);
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.imageSmoothingEnabled = false;
  }

  function startGame() {
    ui.overlay.classList.add("hidden");
    counts = START_COUNTS.slice();
    player.slot = 0;
    spawnPlayer();
    running = true;
    canvas.focus();
  }

  // ---------------------------------------------------------------- network glue
  function remoteFor(actor) {
    let r = remotes.get(actor);
    if (!r) {
      r = { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0, w: 12, h: 28, facing: 1, slot: 0, name: "Player " + actor,
            color: PLAYER_COLORS[(actor - 1) % PLAYER_COLORS.length], swing: null, walk: 0, hurt: 0, fresh: true };
      remotes.set(actor, r);
    }
    return r;
  }

  function connect(mode) {
    const name = (ui.name.value || "").trim() || "Player";
    localStorage.setItem("freeraria-name", name);
    player.name = name;
    let room = (ui.room.value || "").trim();
    if (mode === "create" && !room) { room = "FR" + Math.floor(1000 + Math.random() * 9000); ui.room.value = room; }
    if (mode === "join" && !room) { setStatus("Type the room name you want to join."); return; }

    setButtons(false);
    const seed = seedFromText(ui.seed.value);
    if (net) net.leave();

    net = Net.create({
      onStatus: setStatus,
      onFail: () => { setButtons(true); },
      onReady: (info) => {
        player.color = PLAYER_COLORS[(net.actorNr - 1) % PLAYER_COLORS.length];
        if (info.host) buildWorld(seed, []);
        startGame();
        toast(info.host ? "Room \"" + info.room + "\" created. Share the name with player 2." : "Joined room \"" + info.room + "\"");
      },
      onWorld: (s, list) => buildWorld(s, list),
      getWorldForSync: worldForSync,
      onState: (actor, d) => {
        if (!running) return;
        const r = remoteFor(actor);
        r.tx = d.x; r.ty = d.y; r.vx = d.vx || 0; r.vy = d.vy || 0;
        r.facing = d.f || 1; r.slot = d.s || 0; if (d.n) r.name = String(d.n).slice(0, 14);
        if (r.fresh) { r.x = r.tx; r.y = r.ty; r.fresh = false; }
      },
      onTiles: (list) => {
        if (!world) return;
        for (const [x, y, id] of list) {
          const old = getTile(x, y);
          if (id === T.AIR && old !== T.AIR) burst(x, y, TILE_COLOR[old], 5);
          setTile(x, y, id);
        }
      },
      onSwing: (actor, d) => {
        const r = remoteFor(actor);
        r.facing = d.f;
        r.swing = { kind: d.k, aim: d.a, facing: d.f, t: 0, dur: d.d || 0.25, icon: images[d.i] ? d.i : (d.k === "sword" ? "sword" : "woodPick") };
      },
      onHit: (d) => {
        if (d.t !== net.actorNr) return;
        player.vx = d.vx; player.vy = d.vy; player.onGround = false; player.hurt = 0.3;
      },
      onPeerJoin: () => toast("A player is joining..."),
      onPeerLeave: (actor) => {
        const r = remotes.get(actor);
        toast((r ? r.name : "Player") + " left the room");
        remotes.delete(actor);
      },
      onDisconnect: () => {
        if (running) toast("Disconnected from Photon. You can keep playing offline.");
        else setButtons(true);
      }
    });
    net.start(mode, room);
  }

  function setStatus(t) { ui.status.textContent = t; }

  function setButtons(on) {
    const online = on && Net.available() && Net.isConfigured();
    ui.create.disabled = !online;
    ui.join.disabled = !online;
    ui.solo.disabled = !on;
  }

  // ---------------------------------------------------------------- input
  window.addEventListener("keydown", (e) => {
    if (!running) return;
    keys[e.code] = true;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 8) selectSlot(n - 1);
    if (e.key === "=" || e.key === "+") zoom = Math.min(6, zoom + 1);
    if (e.key === "-" || e.key === "_") zoom = Math.max(1, zoom - 1);
    if (e.code === "KeyR") spawnPlayer();
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; mouse.left = mouse.right = false; });

  function selectSlot(i) {
    player.slot = (i + ITEMS.length) % ITEMS.length;
    const k = ITEMS[player.slot].kind;
    if (k === "block" || k === "door") lastBlockSlot = player.slot;
  }

  canvas.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener("mousedown", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (e.button === 0) mouse.left = true;
    if (e.button === 2) mouse.right = true;
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (running) selectSlot(player.slot + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  ui.create.addEventListener("click", () => connect("create"));
  ui.join.addEventListener("click", () => connect("join"));
  ui.solo.addEventListener("click", () => {
    if (net) { net.leave(); net = null; }
    player.name = (ui.name.value || "").trim() || "Player";
    player.color = PLAYER_COLORS[0];
    buildWorld(seedFromText(ui.seed.value), []);
    startGame();
    toast("Solo offline test. Seed " + world.seed);
  });

  // ---------------------------------------------------------------- boot
  window.addEventListener("resize", resize);
  resize();
  ui.name.value = localStorage.getItem("freeraria-name") || "";
  setButtons(false);
  setStatus("Loading textures...");

  Assets.loadAll().then(({ images: imgs, missing }) => {
    images = imgs;
    setButtons(true);
    if (!Net.available()) setStatus("Photon SDK couldn't load (offline?). Solo Offline Test still works.");
    else if (!Net.isConfigured()) setStatus("Add your Photon App ID to config.js for online play. Solo works now.");
    else setStatus(missing.length ? "Missing textures: " + missing.join(", ") + " (placeholders used)" : "Ready.");
    requestAnimationFrame(frame);
  });

  // handy for testing in the console
  window.Freeraria = { get world() { return world; }, player, remotes, mods, cam, counts: () => counts, get zoom() { return zoom; }, get net() { return net; },
    step(frames) { for (let i = 0; i < (frames || 1); i++) update(1 / 60); render(); } };
})();
