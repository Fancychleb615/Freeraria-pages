// Deterministic world generation: same seed => same world on every machine.
// Uses only integer hashing (Math.imul) so results never differ between browsers.
(function () {
  const W = 200, H = 100;

  const T = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, WOOD: 4, LEAVES: 5, DOOR_BOTTOM: 6, DOOR_TOP: 7
  };

  // ---- PRNG + noise -------------------------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Integer hash -> [0,1)
  function hash2(x, y, seed) {
    let h = seed | 0;
    h = Math.imul(h ^ Math.imul(x | 0, 0x27d4eb2d), 0x165667b1);
    h = Math.imul(h ^ Math.imul(y | 0, 0x85ebca6b), 0xc2b2ae35);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12; h = Math.imul(h, 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  const smooth = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;

  function noise1(x, seed) {
    const i = Math.floor(x), f = x - i;
    return lerp(hash2(i, 0, seed), hash2(i + 1, 0, seed), smooth(f));
  }

  function noise2(x, y, seed) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  }

  function fbm1(x, seed, oct) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += noise1(x * freq, seed + o * 1013) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  function fbm2(x, y, seed, oct) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += noise2(x * freq, y * freq, seed + o * 7919) * amp;
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  }

  // ---- Generation ----------------------------------------------------------
  function generate(seed) {
    seed = seed | 0;
    const tiles = new Uint8Array(W * H);
    const surface = new Int16Array(W);
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const idx = (x, y) => y * W + x;

    // 1) Rolling surface height
    for (let x = 0; x < W; x++) {
      const n = fbm1(x * 0.035, seed, 4);
      surface[x] = Math.round(30 + n * 18); // roughly rows 30..48
    }

    // 2) Fill grass / dirt (6-12 deep) / stone
    for (let x = 0; x < W; x++) {
      const s = surface[x];
      const dirtDepth = 6 + Math.floor(noise1(x * 0.11, seed + 555) * 7); // 6..12
      for (let y = s; y < H; y++) {
        let t;
        if (y === s) t = T.GRASS;
        else if (y <= s + dirtDepth) t = T.DIRT;
        else t = T.STONE;
        tiles[idx(x, y)] = t;
      }
    }

    // 3) Caves: carve pockets out of the stone layer
    for (let x = 0; x < W; x++) {
      for (let y = surface[x] + 10; y < H - 2; y++) {
        if (tiles[idx(x, y)] !== T.STONE) continue;
        const n = fbm2(x * 0.075, y * 0.11, seed + 4242, 3);
        const depth = (y - surface[x]) / 40;          // caves get a bit bigger with depth
        if (n > 0.69 - Math.min(depth, 1) * 0.05) tiles[idx(x, y)] = T.AIR;
      }
    }

    // 4) Trees on flat grass
    let lastTree = -10;
    for (let x = 3; x < W - 3; x++) {
      const s = surface[x];
      const flat = surface[x - 1] === s && surface[x + 1] === s;
      if (!flat || x - lastTree < 5) continue;
      if (Math.abs(x - W / 2) < 3) continue; // keep the spawn point clear
      if (rng() < 0.28) {
        const height = 4 + Math.floor(rng() * 4); // 4..7 tiles of trunk
        for (let i = 1; i < height; i++) tiles[idx(x, s - i)] = T.WOOD;
        tiles[idx(x, s - height)] = T.LEAVES; // trunk top with canopy
        lastTree = x;
      }
    }

    return { W, H, seed, tiles, surface };
  }

  window.WorldGen = { W, H, T, generate, mulberry32 };
})();
