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
  // --- Survival: ores, items, tools (tile row 5+ in atlas) ---
  COAL_ORE: 18,
  IRON_ORE: 19,
  GOLD_ORE: 20,
  DIAMOND_ORE: 21,
  STICK: 22,
  COAL: 23,
  IRON_INGOT: 24,
  GOLD_INGOT: 25,
  DIAMOND: 26,
  WOODEN_PICKAXE: 27,
  STONE_PICKAXE: 28,
  IRON_PICKAXE: 29,
  DIAMOND_PICKAXE: 30,
  FLOWER_RED: 151,
  FLOWER_BLUE: 152,
  FLOWER_YELLOW: 153,
  WOOD_BIRCH: 154,
  WOOD_SPRUCE: 155,
  PLANKS_BIRCH: 156,
  PLANKS_SPRUCE: 157,
  ROCK_GRANITE: 158,
  ROCK_BASALT: 159,
  ROCK_MARBLE: 160,
  DECO_BRICKS: 161,
  DECO_TILES: 162,
  DECO_LAMP: 163,
  DECO_BOOKSHELF: 164,
  DYE_RED: 165,
  DYE_BLUE: 166,
  DYE_YELLOW: 167,
  SAND_RED: 168,
  SAND_BLUE: 169,
  SAND_GREEN: 170,
  SAND_PURPLE: 171,
};

const EXTRA_BLOCK_START = 31;
const EXTRA_BLOCK_COUNT = 120;
for (let i = 0; i < EXTRA_BLOCK_COUNT; i++) {
  BLOCK[`CUSTOM_${i + 1}`] = EXTRA_BLOCK_START + i;
}
export const EXTRA_BLOCK_IDS = Array.from({ length: EXTRA_BLOCK_COUNT }, (_, i) => EXTRA_BLOCK_START + i);

const TILE = 16;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 48;

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
  [BLOCK.COAL_ORE]:     { top: 20, bottom: 20, side: 20 },
  [BLOCK.IRON_ORE]:     { top: 21, bottom: 21, side: 21 },
  [BLOCK.GOLD_ORE]:     { top: 22, bottom: 22, side: 22 },
  [BLOCK.DIAMOND_ORE]:  { top: 23, bottom: 23, side: 23 },
  [BLOCK.STICK]:        { top: 24, bottom: 24, side: 24 },
  [BLOCK.COAL]:         { top: 25, bottom: 25, side: 25 },
  [BLOCK.IRON_INGOT]:   { top: 26, bottom: 26, side: 26 },
  [BLOCK.GOLD_INGOT]:   { top: 27, bottom: 27, side: 27 },
  [BLOCK.DIAMOND]:      { top: 28, bottom: 28, side: 28 },
  [BLOCK.WOODEN_PICKAXE]:  { top: 29, bottom: 29, side: 29 },
  [BLOCK.STONE_PICKAXE]:   { top: 30, bottom: 30, side: 30 },
  [BLOCK.IRON_PICKAXE]:    { top: 31, bottom: 31, side: 31 },
  [BLOCK.DIAMOND_PICKAXE]: { top: 32, bottom: 32, side: 32 },
  [BLOCK.FLOWER_RED]:      { top: 153, bottom: 153, side: 153 },
  [BLOCK.FLOWER_BLUE]:     { top: 154, bottom: 154, side: 154 },
  [BLOCK.FLOWER_YELLOW]:   { top: 155, bottom: 155, side: 155 },
  [BLOCK.WOOD_BIRCH]:      { top: 156, bottom: 156, side: 156 },
  [BLOCK.WOOD_SPRUCE]:     { top: 157, bottom: 157, side: 157 },
  [BLOCK.PLANKS_BIRCH]:    { top: 158, bottom: 158, side: 158 },
  [BLOCK.PLANKS_SPRUCE]:   { top: 159, bottom: 159, side: 159 },
  [BLOCK.ROCK_GRANITE]:    { top: 160, bottom: 160, side: 160 },
  [BLOCK.ROCK_BASALT]:     { top: 161, bottom: 161, side: 161 },
  [BLOCK.ROCK_MARBLE]:     { top: 162, bottom: 162, side: 162 },
  [BLOCK.DECO_BRICKS]:     { top: 163, bottom: 163, side: 163 },
  [BLOCK.DECO_TILES]:      { top: 164, bottom: 164, side: 164 },
  [BLOCK.DECO_LAMP]:       { top: 165, bottom: 165, side: 165 },
  [BLOCK.DECO_BOOKSHELF]:  { top: 166, bottom: 166, side: 166 },
  [BLOCK.DYE_RED]:         { top: 170, bottom: 170, side: 170 },
  [BLOCK.DYE_BLUE]:        { top: 171, bottom: 171, side: 171 },
  [BLOCK.DYE_YELLOW]:      { top: 172, bottom: 172, side: 172 },
  [BLOCK.SAND_RED]:        { top: 170, bottom: 170, side: 170 },
  [BLOCK.SAND_BLUE]:       { top: 171, bottom: 171, side: 171 },
  [BLOCK.SAND_GREEN]:      { top: 172, bottom: 172, side: 172 },
  [BLOCK.SAND_PURPLE]:     { top: 173, bottom: 173, side: 173 },
};

// hardness = secondes de base (main ou bon outil bas) · harvestLevel 0 = main OK,
// 1 = pioche bois+, 2 = pierre+, 3 = fer+, 4 = diamant+ (pour obsidienne / minerai diamant)
export const BLOCK_INFO = {
  [BLOCK.GRASS]:   { name: 'Herbe',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.1,  harvestLevel: 0, harvestTool: null },
  [BLOCK.DIRT]:    { name: 'Terre',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.12, harvestLevel: 0, harvestTool: null },
  [BLOCK.STONE]:   { name: 'Pierre',   solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.38, harvestLevel: 1, harvestTool: 'pickaxe' },
  [BLOCK.SAND]:    { name: 'Sable',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.12, harvestLevel: 0, harvestTool: null },
  [BLOCK.WOOD]:    { name: 'Bois',     solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.32, harvestLevel: 0, harvestTool: null },
  [BLOCK.LEAVES]:  { name: 'Feuilles', solid: true, transparent: true,  fluid: false, emissive: 0, placeable: true,  hardness: 0.08, harvestLevel: 0, harvestTool: null },
  [BLOCK.PLANKS]:  { name: 'Planches', solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.2,  harvestLevel: 0, harvestTool: null },
  [BLOCK.GLASS]:   { name: 'Verre',    solid: true, transparent: true,  fluid: false, emissive: 0, placeable: true,  hardness: 0.15, harvestLevel: 0, harvestTool: null },
  [BLOCK.BEDROCK]: { name: 'Socle',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 999, harvestLevel: 99, harvestTool: 'pickaxe', unbreakable: true },
  [BLOCK.WATER]:   { name: 'Eau',      solid: true, transparent: true,  fluid: true,  emissive: 0, source: true },
  [BLOCK.SNOW]:    { name: 'Neige',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.1,  harvestLevel: 0, harvestTool: null },
  [BLOCK.ICE]:     { name: 'Glace',    solid: true, transparent: true,  fluid: false, emissive: 0, placeable: true,  hardness: 0.35, harvestLevel: 0, harvestTool: null },
  [BLOCK.CACTUS]:  { name: 'Cactus',   solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 0.12, harvestLevel: 0, harvestTool: null },
  [BLOCK.LAVA]:    { name: 'Lave',     solid: true, transparent: true,  fluid: true,  emissive: 1, source: true },
  [BLOCK.OBSIDIAN]:{ name: 'Obsidienne',solid: true, transparent: false, fluid: false, emissive: 0, placeable: true,  hardness: 6.5, harvestLevel: 4, harvestTool: 'pickaxe' },
  [BLOCK.WATER_FLOW]:{ name: 'Eau coulante', solid: true, transparent: true, fluid: true, emissive: 0, source: false },
  [BLOCK.LAVA_FLOW]: { name: 'Lave coulante',solid: true, transparent: true, fluid: true, emissive: 0.7, source: false },
  [BLOCK.COAL_ORE]:    { name: 'Minerai de charbon', solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.42, harvestLevel: 1, harvestTool: 'pickaxe', dropId: BLOCK.COAL },
  [BLOCK.IRON_ORE]:    { name: 'Minerai de fer',     solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.55, harvestLevel: 2, harvestTool: 'pickaxe' },
  [BLOCK.GOLD_ORE]:    { name: 'Minerai d\'or',      solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.5,  harvestLevel: 2, harvestTool: 'pickaxe' },
  [BLOCK.DIAMOND_ORE]: { name: 'Minerai de diamant', solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.7,  harvestLevel: 3, harvestTool: 'pickaxe', dropId: BLOCK.DIAMOND },
  [BLOCK.STICK]:       { name: 'Bâton',            solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.COAL]:        { name: 'Charbon',          solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.IRON_INGOT]:  { name: 'Lingot de fer',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.GOLD_INGOT]:  { name: 'Lingot d\'or',     solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.DIAMOND]:     { name: 'Diamant',          solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.WOODEN_PICKAXE]:  { name: 'Pioche en bois',   solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, pickaxeTier: 1, hardness: 0 },
  [BLOCK.STONE_PICKAXE]:   { name: 'Pioche en pierre', solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, pickaxeTier: 2, hardness: 0 },
  [BLOCK.IRON_PICKAXE]:    { name: 'Pioche en fer',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, pickaxeTier: 3, hardness: 0 },
  [BLOCK.DIAMOND_PICKAXE]: { name: 'Pioche en diamant',solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, pickaxeTier: 4, hardness: 0 },
  [BLOCK.FLOWER_RED]:      { name: 'Fleur rouge',      solid: true, transparent: true,  fluid: false, emissive: 0, placeable: true, hardness: 0.02, harvestLevel: 0, harvestTool: null },
  [BLOCK.FLOWER_BLUE]:     { name: 'Fleur bleue',      solid: true, transparent: true,  fluid: false, emissive: 0, placeable: true, hardness: 0.02, harvestLevel: 0, harvestTool: null },
  [BLOCK.FLOWER_YELLOW]:   { name: 'Fleur jaune',      solid: true, transparent: true,  fluid: false, emissive: 0, placeable: true, hardness: 0.02, harvestLevel: 0, harvestTool: null },
  [BLOCK.WOOD_BIRCH]:      { name: 'Bûche de bouleau', solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.3, harvestLevel: 0, harvestTool: null },
  [BLOCK.WOOD_SPRUCE]:     { name: 'Bûche de sapin',   solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.3, harvestLevel: 0, harvestTool: null },
  [BLOCK.PLANKS_BIRCH]:    { name: 'Planches bouleau', solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.2, harvestLevel: 0, harvestTool: null },
  [BLOCK.PLANKS_SPRUCE]:   { name: 'Planches sapin',   solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.2, harvestLevel: 0, harvestTool: null },
  [BLOCK.ROCK_GRANITE]:    { name: 'Granite',          solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.45, harvestLevel: 1, harvestTool: 'pickaxe' },
  [BLOCK.ROCK_BASALT]:     { name: 'Basalte',          solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.5, harvestLevel: 1, harvestTool: 'pickaxe' },
  [BLOCK.ROCK_MARBLE]:     { name: 'Marbre',           solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.4, harvestLevel: 1, harvestTool: 'pickaxe' },
  [BLOCK.DECO_BRICKS]:     { name: 'Briques décoratives', solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.35, harvestLevel: 0, harvestTool: null },
  [BLOCK.DECO_TILES]:      { name: 'Dalles décoratives',  solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.35, harvestLevel: 0, harvestTool: null },
  [BLOCK.DECO_LAMP]:       { name: 'Lampe déco',       solid: true, transparent: false, fluid: false, emissive: 1, placeable: true, hardness: 0.2, harvestLevel: 0, harvestTool: null },
  [BLOCK.DECO_BOOKSHELF]:  { name: 'Bibliothèque',     solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.2, harvestLevel: 0, harvestTool: null },
  [BLOCK.DYE_RED]:         { name: 'Colorant rouge',   solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.DYE_BLUE]:        { name: 'Colorant bleu',    solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.DYE_YELLOW]:      { name: 'Colorant jaune',   solid: true, transparent: false, fluid: false, emissive: 0, placeable: false, hardness: 0 },
  [BLOCK.SAND_RED]:        { name: 'Sable rouge',      solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.12, harvestLevel: 0, harvestTool: null },
  [BLOCK.SAND_BLUE]:       { name: 'Sable bleu',       solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.12, harvestLevel: 0, harvestTool: null },
  [BLOCK.SAND_GREEN]:      { name: 'Sable vert',       solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.12, harvestLevel: 0, harvestTool: null },
  [BLOCK.SAND_PURPLE]:     { name: 'Sable violet',     solid: true, transparent: false, fluid: false, emissive: 0, placeable: true, hardness: 0.12, harvestLevel: 0, harvestTool: null },
};

for (let i = 0; i < EXTRA_BLOCK_COUNT; i++) {
  const id = EXTRA_BLOCK_START + i;
  const tile = 33 + i;
  FACE_TILES[id] = { top: tile, bottom: tile, side: tile };
  BLOCK_INFO[id] = {
    name: `Bloc custom ${i + 1}`,
    solid: true,
    transparent: false,
    fluid: false,
    emissive: 0,
    placeable: true,
    hardness: 0.14 + (i % 5) * 0.03,
    harvestLevel: 0,
    harvestTool: null,
  };
}

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

/** Niveau de pioche en main (0 = pas une pioche / main nue pour la vitesse). */
export function pickaxeTierInHand(handId) {
  const t = BLOCK_INFO[handId]?.pickaxeTier;
  return typeof t === 'number' && t > 0 ? t : 0;
}

/** Temps en secondes pour casser ce bloc avec l'objet en main. Infinity si impossible. */
export function breakTimeSeconds(blockId, handId) {
  const b = BLOCK_INFO[blockId];
  if (!b || b.unbreakable) return Infinity;
  const base = typeof b.hardness === 'number' ? b.hardness : 0.2;
  if (base >= 900) return Infinity;
  const need = b.harvestLevel ?? 0;
  const tool = b.harvestTool;
  const pickTier = pickaxeTierInHand(handId);
  if (tool === 'pickaxe' && need > 0 && pickTier < need) return Infinity;
  if (tool === 'pickaxe' && need > 0) {
    return Math.max(0.07, base / (0.48 + pickTier * 0.42));
  }
  return Math.max(0.05, base / (pickTier > 0 ? 1.12 : 1));
}

/** Si la casse donne un drop (bon niveau d'outil pour les minerais). */
export function canHarvestBlock(blockId, handId) {
  return breakTimeSeconds(blockId, handId) !== Infinity;
}

export function dropIdForBlock(blockId) {
  const d = BLOCK_INFO[blockId]?.dropId;
  return typeof d === 'number' ? d : blockId;
}

export function isPlaceable(id) {
  if (!id || id === BLOCK.AIR) return false;
  const p = BLOCK_INFO[id]?.placeable;
  return p !== false;
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

/** Textures Minecraft vanilla (resource pack) servies depuis `/texture-pack/`. */
const RESOURCE_PACK_TEXTURES = '/texture-pack/assets/minecraft/textures/';

/** @param {string} url */
function loadPackImage(url) {
  return new Promise((resolve) => {
    const im = new Image();
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const timer = setTimeout(() => finish(null), 3000);
    im.decoding = 'async';
    im.onload = () => { clearTimeout(timer); finish(im); };
    im.onerror = () => { clearTimeout(timer); finish(null); };
    try { im.src = url; } catch { clearTimeout(timer); finish(null); }
  });
}

/** Première tranche 16×16 (eau / lave animées en bande verticale). */
function blitPackOntoTile(ctx, col, row, img, rel = '') {
  if (!img || !img.naturalWidth) return;
  const dx = col * TILE;
  const dy = row * TILE;
  const sw = Math.min(TILE, img.naturalWidth);
  const sh = Math.min(TILE, img.naturalHeight);
  // Important: clear the tile first so transparent item pixels don't blend
  // with procedural fallback pixels underneath.
  ctx.clearRect(dx, dy, TILE, TILE);
  ctx.drawImage(img, 0, 0, sw, sh, dx, dy, TILE, TILE);
  // Beaucoup de packs modernes stockent l'eau/lave en textures quasi
  // grayscale (la vraie coloration est faite par le moteur Minecraft via tint).
  // Ici, on applique une teinte locale pour retrouver un rendu cohérent.
  if (rel === 'block/grass_block_top.png') {
    tintTile(ctx, col, row, 0.72, 1.32, 0.72);
  } else if (rel === 'block/oak_leaves.png') {
    tintTile(ctx, col, row, 0.72, 1.26, 0.72);
  } else if (rel === 'block/water_still.png') {
    tintTile(ctx, col, row, 0.48, 0.82, 1.55);
  } else if (rel === 'block/lava_still.png') {
    tintTile(ctx, col, row, 1.45, 0.9, 0.42);
  }
}

function tintTile(ctx, col, row, mr, mg, mb) {
  const tx = col * TILE;
  const ty = row * TILE;
  let img;
  try { img = ctx.getImageData(tx, ty, TILE, TILE); }
  catch { return; }
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3];
    if (a === 0) continue;
    img.data[i + 0] = clamp(img.data[i + 0] * mr);
    img.data[i + 1] = clamp(img.data[i + 1] * mg);
    img.data[i + 2] = clamp(img.data[i + 2] * mb);
  }
  try { ctx.putImageData(img, tx, ty); } catch {}
}

/** Cases atlas (col,row) alignées sur `FACE_TILES` / tiles procéduraux. */
const RESOURCE_PACK_SLOTS = [
  { col: 0, row: 0, rel: 'block/grass_block_top.png' },
  { col: 1, row: 0, rel: 'block/grass_block_side.png' },
  { col: 2, row: 0, rel: 'block/dirt.png' },
  { col: 3, row: 0, rel: 'block/stone.png' },
  { col: 0, row: 1, rel: 'block/sand.png' },
  { col: 1, row: 1, rel: 'block/oak_log_top.png' },
  { col: 2, row: 1, rel: 'block/oak_log.png' },
  { col: 3, row: 1, rel: 'block/oak_leaves.png' },
  { col: 0, row: 2, rel: 'block/oak_planks.png' },
  { col: 1, row: 2, rel: 'block/glass.png' },
  { col: 2, row: 2, rel: 'block/bedrock.png' },
  { col: 3, row: 2, rel: 'block/water_still.png' },
  { col: 0, row: 3, rel: 'block/snow.png' },
  { col: 1, row: 3, rel: 'block/ice.png' },
  { col: 2, row: 3, rel: 'block/cactus_side.png' },
  { col: 3, row: 3, rel: 'block/lava_still.png' },
  { col: 0, row: 4, rel: 'block/obsidian.png' },
  { col: 0, row: 5, rel: 'block/coal_ore.png' },
  { col: 1, row: 5, rel: 'block/iron_ore.png' },
  { col: 2, row: 5, rel: 'block/gold_ore.png' },
  { col: 3, row: 5, rel: 'block/diamond_ore.png' },
  { col: 0, row: 6, rel: 'item/stick.png' },
  { col: 1, row: 6, rel: 'item/coal.png' },
  { col: 2, row: 6, rel: 'item/iron_ingot.png' },
  { col: 3, row: 6, rel: 'item/gold_ingot.png' },
  { col: 0, row: 7, rel: 'item/diamond.png' },
  { col: 1, row: 7, rel: 'item/wooden_pickaxe.png' },
  { col: 2, row: 7, rel: 'item/stone_pickaxe.png' },
  { col: 3, row: 7, rel: 'item/iron_pickaxe.png' },
  { col: 0, row: 8, rel: 'item/diamond_pickaxe.png' },
  { col: 1, row: 38, rel: 'block/poppy.png' },
  { col: 2, row: 38, rel: 'block/cornflower.png' },
  { col: 3, row: 38, rel: 'block/dandelion.png' },
  { col: 0, row: 39, rel: 'block/birch_log.png' },
  { col: 1, row: 39, rel: 'block/spruce_log.png' },
  { col: 2, row: 39, rel: 'block/birch_planks.png' },
  { col: 3, row: 39, rel: 'block/spruce_planks.png' },
  { col: 0, row: 40, rel: 'block/granite.png' },
  { col: 1, row: 40, rel: 'block/basalt.png' },
  { col: 2, row: 40, rel: 'block/calcite.png' },
  { col: 3, row: 40, rel: 'block/bricks.png' },
  { col: 0, row: 41, rel: 'block/polished_andesite.png' },
  { col: 1, row: 41, rel: 'block/shroomlight.png' },
  { col: 2, row: 41, rel: 'block/bookshelf.png' },
  { col: 3, row: 41, rel: 'item/red_dye.png' },
  { col: 0, row: 42, rel: 'item/blue_dye.png' },
  { col: 1, row: 42, rel: 'item/yellow_dye.png' },
  { col: 2, row: 42, rel: 'block/red_sand.png' },
  { col: 3, row: 42, rel: 'block/blue_concrete_powder.png' },
  { col: 0, row: 43, rel: 'block/green_concrete_powder.png' },
  { col: 1, row: 43, rel: 'block/purple_concrete_powder.png' },
];

async function applyResourcePackTiles(ctx) {
  await Promise.all(
    RESOURCE_PACK_SLOTS.map(async ({ col, row, rel }) => {
      try {
        const img = await loadPackImage(RESOURCE_PACK_TEXTURES + rel);
        if (img) {
          try { blitPackOntoTile(ctx, col, row, img, rel); } catch {}
        }
      } catch {}
    }),
  );
}

function paintProceduralAtlas(ctx) {
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

  // --- Row 5: ores (tiles 20–23) ---
  fillTile(ctx, 0, 5, c => {
    noisePaint(c, [70, 70, 75], 18, 201);
    speckle(c, [20, 20, 22], 40, 202);
    speckle(c, [30, 30, 35], 20, 203);
    speckle(c, [15, 15, 18], 25, 204);
  });
  fillTile(ctx, 1, 5, c => {
    noisePaint(c, [110, 88, 78], 16, 211);
    speckle(c, [160, 120, 100], 18, 212);
    speckle(c, [60, 45, 40], 22, 213);
  });
  fillTile(ctx, 2, 5, c => {
    noisePaint(c, [140, 120, 55], 18, 221);
    speckle(c, [200, 180, 80], 16, 222);
    speckle(c, [90, 75, 30], 20, 223);
  });
  fillTile(ctx, 3, 5, c => {
    noisePaint(c, [70, 120, 110], 14, 231);
    speckle(c, [180, 255, 250], 10, 232);
    speckle(c, [40, 90, 85], 18, 233);
  });
  // Row 6: stick, coal lump, iron ingot, gold ingot (24–27)
  fillTile(ctx, 0, 6, c => {
    noisePaint(c, [120, 85, 45], 10, 241);
    c.fillStyle = 'rgba(80,55,30,0.9)';
    c.fillRect(6, 2, 4, 12);
    c.fillRect(6, 12, 4, 2);
  });
  fillTile(ctx, 1, 6, c => {
    noisePaint(c, [35, 35, 38], 12, 251);
    speckle(c, [10, 10, 12], 30, 252);
  });
  fillTile(ctx, 2, 6, c => {
    noisePaint(c, [160, 150, 155], 10, 261);
    speckle(c, [200, 190, 195], 12, 262);
    speckle(c, [120, 110, 115], 14, 263);
  });
  fillTile(ctx, 3, 6, c => {
    noisePaint(c, [200, 175, 70], 12, 271);
    speckle(c, [255, 230, 120], 14, 272);
  });
  // Row 7: diamond, wood / stone / iron pick heads (28–31)
  fillTile(ctx, 0, 7, c => {
    noisePaint(c, [120, 220, 230], 12, 281);
    speckle(c, [200, 255, 255], 12, 282);
    speckle(c, [60, 140, 150], 10, 283);
  });
  fillTile(ctx, 1, 7, c => {
    noisePaint(c, [140, 100, 55], 8, 291);
    c.fillStyle = '#5a4030';
    c.fillRect(2, 4, 12, 3);
    c.fillRect(6, 7, 2, 8);
  });
  fillTile(ctx, 2, 7, c => {
    noisePaint(c, [115, 115, 120], 10, 301);
    c.fillStyle = '#4a4a50';
    c.fillRect(2, 4, 12, 3);
    c.fillRect(6, 7, 2, 8);
  });
  fillTile(ctx, 3, 7, c => {
    noisePaint(c, [150, 130, 125], 10, 311);
    c.fillStyle = '#8b6914';
    c.fillRect(2, 4, 12, 3);
    c.fillRect(6, 7, 2, 8);
  });
  // Row 8: diamond pick (tile 32)
  fillTile(ctx, 0, 8, c => {
    noisePaint(c, [40, 45, 55], 10, 321);
    c.fillStyle = '#2ee8d8';
    c.fillRect(2, 4, 12, 3);
    c.fillRect(6, 7, 2, 8);
    speckle(c, [200, 255, 250], 6, 322);
  });

  // Extra custom blocks (120): colorful procedural tiles for builders.
  for (let i = 0; i < EXTRA_BLOCK_COUNT; i++) {
    const tile = 33 + i;
    const col = tile % ATLAS_COLS;
    const row = Math.floor(tile / ATLAS_COLS);
    fillTile(ctx, col, row, c => {
      const hue = (i * 37) % 360;
      const sat = 55 + (i % 4) * 8;
      const light = 42 + (i % 5) * 6;
      const base = hslToRgb(hue, sat, light);
      noisePaint(c, base, 18, 1000 + i * 13);
      speckle(c, [255, 255, 255], 7 + (i % 4), 2000 + i * 17, 0.22);
      speckle(c, [0, 0, 0], 8 + (i % 5), 3000 + i * 19, 0.18);
    });
  }

  const specialTiles = [
    { tile: 153, color: [205, 58, 74] },
    { tile: 154, color: [76, 122, 210] },
    { tile: 155, color: [224, 194, 62] },
    { tile: 156, color: [206, 188, 150] },
    { tile: 157, color: [88, 63, 44] },
    { tile: 158, color: [216, 190, 142] },
    { tile: 159, color: [132, 101, 74] },
    { tile: 160, color: [153, 122, 112] },
    { tile: 161, color: [68, 68, 74] },
    { tile: 162, color: [220, 224, 228] },
    { tile: 163, color: [154, 58, 44] },
    { tile: 164, color: [123, 128, 138] },
    { tile: 165, color: [248, 186, 86] },
    { tile: 166, color: [122, 90, 63] },
    { tile: 167, color: [206, 64, 64] },
    { tile: 168, color: [68, 114, 208] },
    { tile: 169, color: [224, 194, 62] },
    { tile: 170, color: [198, 88, 62] },
    { tile: 171, color: [74, 132, 206] },
    { tile: 172, color: [86, 158, 96] },
    { tile: 173, color: [154, 96, 188] },
  ];
  for (const t of specialTiles) {
    const col = t.tile % ATLAS_COLS;
    const row = Math.floor(t.tile / ATLAS_COLS);
    fillTile(ctx, col, row, c => {
      noisePaint(c, t.color, 16, 5000 + t.tile * 11);
      speckle(c, [255, 255, 255], 6, 6000 + t.tile * 13, 0.2);
    });
  }
}

function hslToRgb(h, s, l) {
  const H = ((h % 360) + 360) % 360 / 360;
  const S = Math.max(0, Math.min(1, s / 100));
  const L = Math.max(0, Math.min(1, l / 100));
  if (S === 0) {
    const v = Math.round(L * 255);
    return [v, v, v];
  }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  const f = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [Math.round(f(H + 1 / 3) * 255), Math.round(f(H) * 255), Math.round(f(H - 1 / 3) * 255)];
}

/**
 * Atlas 4×9 : d’abord procédural, puis recouvert par le pack dans `/texture-pack/` si présent.
 * @returns {Promise<{ canvas: HTMLCanvasElement, texture: THREE.CanvasTexture }>}
 */
export async function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * ATLAS_COLS;
  canvas.height = TILE * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  try { paintProceduralAtlas(ctx); } catch (e) { console.warn('paintProceduralAtlas failed', e); }
  try { await applyResourcePackTiles(ctx); } catch (e) { console.warn('applyResourcePackTiles failed', e); }

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
  // Garder les items/outils "bruts" (sans ombre) pour un rendu plus fidèle.
  const isItemLike = BLOCK_INFO[blockId]?.placeable === false;
  if (!isItemLike) {
    const g = c.createLinearGradient(0, 0, 0, 36);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    c.fillStyle = g;
    c.fillRect(0, 0, 36, 36);
  }
  return off.toDataURL();
}
