# Freeraria (test build)

A small 2D side-scrolling sandbox prototype: procedural terrain, mining and building,
pickaxe and sword swings, and 2-player online play through Photon Realtime.
Runs as a plain static site (GitHub Pages), no server of our own.

## Play
- **Solo Offline Test**: starts at once, no account needed.
- **Create Room**: host a world. Share the room name with a friend.
- **Join Room**: type the host's room name. The host sends the seed and every changed tile, so both players see the same world.

## Controls
| Key | Action |
| --- | --- |
| A / D (or arrows) | move |
| W / Space | jump (hold for higher) |
| 1–8 / mouse wheel | pick hotbar slot |
| Left click | swing pickaxe or sword, or place the selected block |
| Right click | place a block (uses the last block slot when holding a tool) |
| + / - | zoom |
| R | respawn at the start point |

Hotbar: 1 Wooden Pickaxe · 2 Pickaxe (faster) · 3 Wooden Sword · 4 Grass · 5 Dirt · 6 Stone · 7 Wood · 8 Door (1×2, needs ground under it).

## Files
- `index.html`: page, menu overlay, loads the Photon SDK from jsDelivr
- `config.js`: Photon `APP_ID`, `APP_VERSION`, `REGION`
- `assets.js`: texture loading with placeholders for missing files
- `worldGen.js`: seeded world generator (200×100 tiles)
- `network.js`: Photon rooms and events
- `game.js`: player, tools, swings, rendering, UI
- `assets/`: textures (filenames are case-sensitive on GitHub Pages)

## Adding a sword sprite
Drop `assets/wood sword.png` (or `assets/sword.png`), 16×16, with the handle bottom-left
and the tip top-right like the pickaxe sprites. Until then a drawn sword is used.

## Running locally
Browsers block some features on `file://`, so serve the folder:

```
python -m http.server 8000
```

then open http://localhost:8000.
