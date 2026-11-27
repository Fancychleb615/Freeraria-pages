// Texture loading with safe fallbacks.
// Every path is relative ("./assets/...") so it works on GitHub Pages.
// Filenames keep their exact spaces and capitals (Pages is case-sensitive).
(function () {
  const ASSET_LIST = {
    background: { path: "./assets/Background-plains.png", color: "#5a7ae8", label: "BG", w: 256, h: 256 },
    grass:      { path: "./assets/Grassblock.png",        color: "#4caf3c", label: "G" },
    dirt:       { path: "./assets/Dirtblock.png",         color: "#8a5a32", label: "D" },
    stone:      { path: "./assets/Stone.png",             color: "#7d7d86", label: "S" },
    wood:       { path: "./assets/Wood for tree.png",     color: "#9c6a3a", label: "W" },
    leaves:     { path: "./assets/Leaves.png",            color: "#2f8a2a", label: "L", w: 32, h: 32 },
    door:       { path: "./assets/Wood Door open.png",    color: "#a8743f", label: "Dr", w: 16, h: 32 },
    woodPick:   { path: "./assets/wood picaxe.png",       color: "#b07a44", label: "P1" },
    pick:       { path: "./assets/Picaxe.png",            color: "#c0c0d0", label: "P2" },
    // Optional sword sprite: the first file that exists wins, otherwise a drawn sword is used.
    sword:      { path: ["./assets/wood sword.png", "./assets/sword.png"], color: null, label: "Sw", optional: true }
  };

  // Plain colored square with a label, used when a texture is missing.
  function makeFallback(def) {
    const w = def.w || 16, h = def.h || 16;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = def.color || "#ff00ff";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(0,0,0,0.5)";
    g.strokeRect(0.5, 0.5, w - 1, h - 1);
    g.fillStyle = "#fff";
    g.font = "bold 7px monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(def.label, w / 2, h / 2);
    return c;
  }

  // 16x16 pixel sword, handle bottom-left, tip top-right (same pose as the pickaxe sprites).
  function makeSwordSprite() {
    const c = document.createElement("canvas");
    c.width = 16; c.height = 16;
    const g = c.getContext("2d");
    const px = (x, y, col) => { g.fillStyle = col; g.fillRect(x, y, 1, 1); };
    // blade: diagonal from (5,10) up to (14,1)
    for (let i = 0; i < 10; i++) {
      const x = 5 + i, y = 10 - i;
      px(x, y, "#d9b07a");        // wooden blade core
      px(x + 1, y, "#f0cf98");    // light edge
      px(x, y + 1, "#8f6235");    // dark edge
    }
    px(15, 0, "#f0cf98"); px(14, 0, "#f0cf98");
    // crossguard
    const guard = [[2, 9], [3, 10], [4, 11], [5, 12], [6, 13], [3, 9], [6, 12]];
    guard.forEach(([x, y]) => px(x, y, "#6b4423"));
    // grip + pommel
    px(3, 12, "#4a2e17"); px(2, 13, "#4a2e17"); px(1, 14, "#4a2e17");
    px(0, 15, "#e0c050"); px(1, 15, "#b89a30"); px(0, 14, "#b89a30");
    return c;
  }

  function loadOne(path) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = encodeURI(path); // spaces -> %20, works locally and on Pages
    });
  }

  async function loadAll() {
    const out = {};
    const missing = [];
    await Promise.all(Object.entries(ASSET_LIST).map(async ([key, def]) => {
      const paths = Array.isArray(def.path) ? def.path : [def.path];
      let img = null;
      for (const p of paths) {
        img = await loadOne(p);
        if (img) break;
      }
      if (img) {
        out[key] = img;
      } else if (key === "sword") {
        console.info("[Freeraria] No sword sprite in ./assets/ yet, using the drawn sword. Add './assets/wood sword.png' to replace it.");
        out[key] = makeSwordSprite();
      } else {
        console.warn("[Freeraria] Missing texture " + paths.join(" / ") + ", using a colored placeholder.");
        missing.push(key);
        out[key] = makeFallback(def);
      }
    }));
    return { images: out, missing };
  }

  window.Assets = { loadAll };
})();
