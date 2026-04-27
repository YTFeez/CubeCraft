import * as THREE from 'three';

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  WOOD: 5,
  LEAVES: 6,
  PLANKS: 7,
  GLASS: 8,
  BEDROCK: 9,
  WATER: 10,
  SNOW: 11,
  ICE: 12,
  CACTUS: 13,
  LAVA: 14,
  OBSIDIAN: 15,
  WATER_FLOW: 16,
  LAVA_FLOW: 17,
};

const TILE = 16;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 5;

// Tile index in the atlas (col + row * ATLAS_COLS). 4x5 grid:
//  0 grass_top    1 grass_side  2 dirt        3 stone
//  4 sand         5 wood_top    6 wood_side   7 leaves
//  8 planks       9 glass      10 bedrock    11 water
// 12 snow        13 ice        14 cactus     15 lava
// 16 obsidian
const FACE_TILES = {
  [BLOCK.GRASS]:    { top: 0,  bottom: 2,  side: 1  },
  [BLOCK.DIRT]:     { top: 2,  bottom: 2,  side: 2  },
  [BLOCK.STONE]:    { top: 3,  bottom: 3,  side: 3  },
  [BLOCK.SAND]:     { top: 4,  bottom: 4,  side: 4  },
  [BLOCK.WOOD]:     { top: 5,  bottom: 5,  side: 6  },
  [BLOCK.LEAVES]:   { top: 7,  bottom: 7,  side: 7  },
  [BLOCK.PLANKS]:   { top: 8,  bottom: 8,  side: 8  },
  [BLOCK.GLASS]:    { top: 9,  bottom: 9,  side: 9  },
  [BLOCK.BEDROCK]:  { top: 10, bottom: 10, side: 10 },
  [BLOCK.WATER]:    { top: 11, bottom: 11, side: 11 },
  [BLOCK.SNOW]:     { top: 12, bottom: 2,  side: 12 },
  [BLOCK.ICE]:      { top: 13, bottom: 13, side: 13 },
  [BLOCK.CACTUS]:   { top: 14, bottom: 14, side: 14 },
  [BLOCK.LAVA]:     { top: 15, bottom: 15, side: 15 },
  [BLOCK.OBSIDIAN]: { top: 16, bottom: 16, side: 16 },
  // Flowing fluids share the source's tiles — they look identical, the
  // distinction is only used by gameplay (you can't break/replace sources).
  [BLOCK.WATER_FLOW]: { top: 11, bottom: 11, side: 11 },
  [BLOCK.LAVA_FLOW]:  { top: 15, bottom: 15, side: 15 },
};

export const BLOCK_INFO = {
  [BLOCK.GRASS]:   { name: 'Herbe',    solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.DIRT]:    { name: 'Terre',    solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.STONE]:   { name: 'Pierre',   solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.SAND]:    { name: 'Sable',    solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.WOOD]:    { name: 'Bois',     solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.LEAVES]:  { name: 'Feuilles', solid: true, transparent: true,  fluid: false, emissive: 0 },
  [BLOCK.PLANKS]:  { name: 'Planches', solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.GLASS]:   { name: 'Verre',    solid: true, transparent: true,  fluid: false, emissive: 0 },
  [BLOCK.BEDROCK]: { name: 'Socle',    solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.WATER]:   { name: 'Eau',      solid: true, transparent: true,  fluid: true,  emissive: 0, source: true },
  [BLOCK.SNOW]:    { name: 'Neige',    solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.ICE]:     { name: 'Glace',    solid: true, transparent: true,  fluid: false, emissive: 0 },
  [BLOCK.CACTUS]:  { name: 'Cactus',   solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.LAVA]:    { name: 'Lave',     solid: true, transparent: true,  fluid: true,  emissive: 1, source: true },
  [BLOCK.OBSIDIAN]:{ name: 'Obsidienne',solid: true, transparent: false, fluid: false, emissive: 0 },
  [BLOCK.WATER_FLOW]:{ name: 'Eau coulante', solid: true, transparent: true, fluid: true, emissive: 0, source: false },
  [BLOCK.LAVA_FLOW]: { name: 'Lave coulante',solid: true, transparent: true, fluid: true, emissive: 0.7, source: false },
};

export const HOTBAR_BLOCKS = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND,
  BLOCK.WOOD, BLOCK.PLANKS, BLOCK.GLASS, BLOCK.OBSIDIAN,
];

export function isSolid(id) {
  return id !== BLOCK.AIR;
}
export function isOpaque(id) {
  if (id === BLOCK.AIR) return false;
  return !BLOCK_INFO[id].transparent;
}
export function isFluid(id) {
  return id !== BLOCK.AIR && BLOCK_INFO[id]?.fluid === true;
}
// Only "source" fluids are protected (cannot be broken / overwritten by a
// placement). Flowing fluids are replaceable so the player can interrupt them.
export function isFluidSource(id) {
  return id !== BLOCK.AIR && BLOCK_INFO[id]?.source === true;
}
// Returns 'water', 'lava' or null. Used by flow simulation and the lava+water
// → obsidian rule so source/flow variants are treated as the same liquid.
export function fluidGroup(id) {
  if (id === BLOCK.WATER || id === BLOCK.WATER_FLOW) return 'water';
  if (id === BLOCK.LAVA  || id === BLOCK.LAVA_FLOW)  return 'lava';
  return null;
}

// ---------- Procedural atlas ----------

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// IMPORTANT: getImageData/putImageData ignore the canvas transform, so we
// pass the absolute tile origin via ctx._tileX/_tileY (set by fillTile) and
// the helpers use it directly for pixel manipulation.
function fillTile(ctx, col, row, draw) {
  const x = col * TILE;
  const y = row * TILE;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, TILE, TILE);
  ctx.clip();
  ctx.translate(x, y);
  ctx._tileX = x;
  ctx._tileY = y;
  draw(ctx);
  ctx.restore();
}

function noisePaint(ctx, base, variance, seed) {
  const r = rng(seed);
  const tx = ctx._tileX || 0, ty = ctx._tileY || 0;
  const img = ctx.getImageData(tx, ty, TILE, TILE);
  for (let i = 0; i < TILE * TILE; i++) {
    const v = (r() - 0.5) * variance;
    img.data[i * 4 + 0] = clamp(base[0] + v);
    img.data[i * 4 + 1] = clamp(base[1] + v);
    img.data[i * 4 + 2] = clamp(base[2] + v);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, tx, ty);
}

function clamp(v) { return Math.max(0, Math.min(255, v | 0)); }

function speckle(ctx, color, count, seed, alpha = 1) {
  const r = rng(seed);
  ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
  for (let i = 0; i < count; i++) {
    ctx.fillRect((r() * TILE) | 0, (r() * TILE) | 0, 1, 1);
  }
}

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * ATLAS_COLS;
  canvas.height = TILE * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // grass top - rich green with subtle yellow tufts and clusters
  fillTile(ctx, 0, 0, c => {
    noisePaint(c, [88, 152, 60], 22, 1);
    // darker patches
    speckle(c, [56, 110, 40], 22, 2);
    // mid greens
    speckle(c, [120, 180, 80], 18, 3);
    // bright tufts
    speckle(c, [165, 210, 110], 8, 4);
    // tiny "flowers"
    const r = rng(99);
    for (let i = 0; i < 3; i++) {
      const x = (r() * TILE) | 0, y = (r() * TILE) | 0;
      c.fillStyle = ['#f3d96b', '#f0f5ff', '#e89c9c'][i % 3];
      c.fillRect(x, y, 1, 1);
    }
  });
  // grass side - dirt with grass overhang of varied height
  fillTile(ctx, 1, 0, c => {
    noisePaint(c, [134, 96, 58], 18, 5);
    speckle(c, [80, 50, 28], 18, 6);
    speckle(c, [180, 140, 90], 8, 7);
    // green strip with jagged bottom edge
    const r = rng(8);
    c.fillStyle = '#4a9b3a';
    c.fillRect(0, 0, TILE, 3);
    for (let x = 0; x < TILE; x++) {
      const h = 3 + Math.floor(r() * 3);
      c.fillRect(x, 0, 1, h);
    }
    // brighter highlights on green
    c.fillStyle = '#71c258';
    for (let x = 0; x < TILE; x += 2) c.fillRect(x, 0, 1, 1);
  });
  // dirt
  fillTile(ctx, 2, 0, c => {
    noisePaint(c, [128, 92, 56], 22, 9);
    speckle(c, [80, 50, 28], 28, 10);
    speckle(c, [180, 140, 90], 10, 11);
    speckle(c, [60, 35, 18], 12, 12);
  });
  // stone - cracked look
  fillTile(ctx, 3, 0, c => {
    noisePaint(c, [128, 128, 132], 22, 13);
    speckle(c, [80, 80, 82], 26, 14);
    speckle(c, [170, 170, 172], 12, 15);
    // a few cracks
    c.strokeStyle = 'rgba(70,70,72,0.6)';
    c.lineWidth = 1;
    const r = rng(16);
    for (let i = 0; i < 2; i++) {
      const x0 = (r() * TILE) | 0, y0 = (r() * TILE) | 0;
      const x1 = (r() * TILE) | 0, y1 = (r() * TILE) | 0;
      c.beginPath(); c.moveTo(x0 + 0.5, y0 + 0.5); c.lineTo(x1 + 0.5, y1 + 0.5); c.stroke();
    }
  });
  // sand - softer, warmer
  fillTile(ctx, 0, 1, c => {
    noisePaint(c, [228, 208, 152], 14, 17);
    speckle(c, [200, 178, 124], 22, 18);
    speckle(c, [240, 222, 170], 10, 19);
  });
  // wood top - concentric rings
  fillTile(ctx, 1, 1, c => {
    noisePaint(c, [155, 110, 60], 12, 20);
    c.strokeStyle = 'rgba(95, 64, 32, 0.85)';
    c.lineWidth = 1;
    for (let r = 2; r < 8; r += 2) {
      c.beginPath(); c.arc(TILE / 2, TILE / 2, r, 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = 'rgba(90,60,30,0.9)';
    c.fillRect(TILE / 2 - 1, TILE / 2 - 1, 2, 2);
  });
  // wood side - vertical bark grain
  fillTile(ctx, 2, 1, c => {
    noisePaint(c, [108, 78, 46], 12, 21);
    c.fillStyle = 'rgba(70,48,26,0.8)';
    for (let x = 0; x < TILE; x += 1) {
      if ((x % 3) === 0) c.fillRect(x, 0, 1, TILE);
    }
    c.fillStyle = 'rgba(150,110,68,0.7)';
    for (let x = 1; x < TILE; x += 4) c.fillRect(x, 0, 1, TILE);
    speckle(c, [70, 45, 25], 12, 22);
  });
  // leaves - deep green with alpha gaps for "see through"
  fillTile(ctx, 3, 1, c => {
    c.clearRect(0, 0, TILE, TILE);
    const img = c.getImageData(c._tileX, c._tileY, TILE, TILE);
    const r = rng(23);
    for (let i = 0; i < TILE * TILE; i++) {
      if (r() < 0.85) {
        const v = (r() - 0.5) * 32;
        img.data[i * 4 + 0] = clamp(50 + v);
        img.data[i * 4 + 1] = clamp(120 + v);
        img.data[i * 4 + 2] = clamp(45 + v);
        img.data[i * 4 + 3] = 255;
      } else {
        img.data[i * 4 + 3] = 0;
      }
    }
    c.putImageData(img, c._tileX, c._tileY);
    speckle(c, [20, 70, 20], 18, 24);
    speckle(c, [100, 170, 70], 14, 25);
  });
  // planks
  fillTile(ctx, 0, 2, c => {
    noisePaint(c, [170, 125, 70], 8, 26);
    c.strokeStyle = 'rgba(80,55,28,0.95)';
    c.lineWidth = 1;
    for (let y = 0; y < TILE; y += 4) {
      c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(TILE, y + 0.5); c.stroke();
    }
    // alternating plank seams
    for (let y = 0; y < TILE; y += 4) {
      const xOff = (y / 4) % 2 === 0 ? 4 : 0;
      c.beginPath(); c.moveTo(xOff + 0.5, y); c.lineTo(xOff + 0.5, y + 4); c.stroke();
      c.beginPath(); c.moveTo(xOff + 8 + 0.5, y); c.lineTo(xOff + 8 + 0.5, y + 4); c.stroke();
    }
  });
  // glass - mostly transparent, opaque border and highlight lines
  fillTile(ctx, 1, 2, c => {
    c.clearRect(0, 0, TILE, TILE);
    c.fillStyle = 'rgba(200,235,255,0.04)';
    c.fillRect(0, 0, TILE, TILE);
    c.strokeStyle = 'rgba(230,245,255,0.95)';
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, TILE - 1, TILE - 1);
    c.beginPath();
    c.moveTo(2, 3); c.lineTo(6, 3);
    c.moveTo(2, 3); c.lineTo(2, 7);
    c.stroke();
  });
  // bedrock - dark and chunky
  fillTile(ctx, 2, 2, c => {
    noisePaint(c, [55, 55, 58], 28, 27);
    speckle(c, [20, 20, 22], 50, 28);
    speckle(c, [110, 110, 112], 8, 29);
    c.strokeStyle = 'rgba(15,15,18,0.8)';
    c.lineWidth = 1;
    const r = rng(30);
    for (let i = 0; i < 4; i++) {
      const x0 = (r() * TILE) | 0, y0 = (r() * TILE) | 0;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x0 + (r() * 6 - 3 | 0), y0 + (r() * 6 - 3 | 0)); c.stroke();
    }
  });
  // water - translucent blue with ripple highlights
  fillTile(ctx, 3, 2, c => {
    c.clearRect(0, 0, TILE, TILE);
    const img = c.getImageData(c._tileX, c._tileY, TILE, TILE);
    const r = rng(31);
    for (let i = 0; i < TILE * TILE; i++) {
      const v = (r() - 0.5) * 12;
      img.data[i * 4 + 0] = clamp(35 + v);
      img.data[i * 4 + 1] = clamp(110 + v);
      img.data[i * 4 + 2] = clamp(190 + v);
      img.data[i * 4 + 3] = 200;
    }
    c.putImageData(img, c._tileX, c._tileY);
    c.strokeStyle = 'rgba(180,220,255,0.55)';
    c.lineWidth = 1;
    for (let y = 2; y < TILE; y += 5) {
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x < TILE; x += 2) {
        c.lineTo(x, y + (((x + y) % 4 === 0) ? -1 : 0));
      }
      c.stroke();
    }
  });

  // snow - bright white with subtle blue speckles and a soft sparkle
  fillTile(ctx, 0, 3, c => {
    noisePaint(c, [240, 245, 252], 10, 32);
    speckle(c, [220, 230, 245], 18, 33);
    speckle(c, [255, 255, 255], 12, 34);
    // tiny sparkles
    const r = rng(35);
    c.fillStyle = '#ffffff';
    for (let i = 0; i < 3; i++) c.fillRect((r() * TILE) | 0, (r() * TILE) | 0, 1, 1);
  });

  // ice - light blue, mostly translucent with crystalline highlights
  fillTile(ctx, 1, 3, c => {
    c.clearRect(0, 0, TILE, TILE);
    const img = c.getImageData(c._tileX, c._tileY, TILE, TILE);
    const r = rng(36);
    for (let i = 0; i < TILE * TILE; i++) {
      const v = (r() - 0.5) * 14;
      img.data[i * 4 + 0] = clamp(160 + v);
      img.data[i * 4 + 1] = clamp(210 + v);
      img.data[i * 4 + 2] = clamp(240 + v);
      img.data[i * 4 + 3] = 170;
    }
    c.putImageData(img, c._tileX, c._tileY);
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const x0 = (r() * TILE) | 0, y0 = (r() * TILE) | 0;
      const x1 = x0 + ((r() - 0.5) * 8) | 0;
      const y1 = y0 + ((r() - 0.5) * 8) | 0;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
  });

  // cactus - vivid green with vertical ridges and tiny spines
  fillTile(ctx, 2, 3, c => {
    noisePaint(c, [40, 130, 60], 14, 37);
    speckle(c, [25, 95, 40], 20, 38);
    // vertical ridges on edges
    c.fillStyle = 'rgba(20,80,30,0.85)';
    c.fillRect(0, 0, 2, TILE);
    c.fillRect(TILE - 2, 0, 2, TILE);
    // central darker stripe
    c.fillStyle = 'rgba(20,80,30,0.4)';
    c.fillRect(TILE / 2 - 1, 0, 2, TILE);
    // spines
    c.fillStyle = '#f0eea8';
    for (let y = 1; y < TILE; y += 4) {
      c.fillRect(0, y, 1, 1);
      c.fillRect(TILE - 1, y + 2, 1, 1);
    }
  });

  // obsidian - very dark, glassy black with deep purple highlights
  fillTile(ctx, 0, 4, c => {
    noisePaint(c, [22, 12, 30], 14, 60);
    speckle(c, [10, 5, 18], 30, 61);
    speckle(c, [60, 30, 90], 8, 62);
    // glassy reflections (a few angled lines)
    c.strokeStyle = 'rgba(140, 100, 200, 0.45)';
    c.lineWidth = 1;
    const r = rng(63);
    for (let i = 0; i < 3; i++) {
      const x0 = (r() * TILE) | 0, y0 = (r() * TILE) | 0;
      const x1 = x0 + ((r() - 0.5) * 8) | 0;
      const y1 = y0 + ((r() - 0.5) * 8) | 0;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    // tiny bright pinpoints
    c.fillStyle = 'rgba(170,130,230,0.9)';
    for (let i = 0; i < 2; i++) c.fillRect((r() * TILE) | 0, (r() * TILE) | 0, 1, 1);
  });

  // lava - bright orange with hot streaks (slight transparency to glow against fog)
  fillTile(ctx, 3, 3, c => {
    noisePaint(c, [220, 80, 28], 28, 39);
    speckle(c, [255, 180, 60], 20, 40);
    speckle(c, [120, 30, 8], 14, 41);
    // bright cracks
    c.strokeStyle = 'rgba(255,210,90,0.95)';
    c.lineWidth = 1;
    const r = rng(42);
    for (let i = 0; i < 3; i++) {
      c.beginPath();
      const x0 = (r() * TILE) | 0;
      c.moveTo(x0, 0);
      for (let y = 0; y < TILE; y += 2) {
        c.lineTo(x0 + ((r() - 0.5) * 4) | 0, y);
      }
      c.stroke();
    }
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return { canvas, texture };
}

// UV helpers: returns [u0, v0, u1, v1] for a given tile index.
export function tileUV(tileIndex) {
  const col = tileIndex % ATLAS_COLS;
  const row = Math.floor(tileIndex / ATLAS_COLS);
  const u0 = col / ATLAS_COLS;
  const v0 = 1 - (row + 1) / ATLAS_ROWS;
  const u1 = (col + 1) / ATLAS_COLS;
  const v1 = 1 - row / ATLAS_ROWS;
  return [u0, v0, u1, v1];
}

export function getFaceTile(blockId, face) {
  // face: 'top' | 'bottom' | 'side'
  const info = FACE_TILES[blockId];
  if (!info) return 0;
  return info[face];
}

// Extract a small canvas for a block icon (hotbar), drawing top face.
export function blockIconDataURL(blockId, atlasCanvas) {
  const info = FACE_TILES[blockId];
  if (!info) return '';
  const off = document.createElement('canvas');
  off.width = 36; off.height = 36;
  const c = off.getContext('2d');
  c.imageSmoothingEnabled = false;
  const tile = info.side;
  const col = tile % ATLAS_COLS;
  const row = Math.floor(tile / ATLAS_COLS);
  c.drawImage(atlasCanvas, col * TILE, row * TILE, TILE, TILE, 0, 0, 36, 36);
  // darken bottom half a bit for 3D feel
  const g = c.createLinearGradient(0, 0, 0, 36);
  g.addColorStop(0, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.25)');
  c.fillStyle = g;
  c.fillRect(0, 0, 36, 36);
  return off.toDataURL();
}
