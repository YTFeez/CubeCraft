import { BLOCK } from './blocks.js';

// =============================================================================
// BIOMES
// =============================================================================
// Each biome describes how a single column should look (surface block, fluid,
// height noise, trees). Multi-biome worlds compose them via a low-frequency
// noise over (x, z).
export const BIOMES = {
  forest: {
    id: 'forest',
    seaLevel: 24,
    heightAmp: [8, 4, 9.6],
    heightFreq: [0.015, 0.05, 0.005],
    heightOffset: 0,
    surface: { top: BLOCK.GRASS, beach: BLOCK.SAND, sub: BLOCK.DIRT, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: { id: BLOCK.WATER, level: 24 },
    trees: { density: 4, type: 'oak' },
  },
  desert: {
    id: 'desert',
    seaLevel: 24,
    heightAmp: [10, 4, 5],
    heightFreq: [0.012, 0.05, 0.004],
    heightOffset: 4, // dunes always above sea
    surface: { top: BLOCK.SAND, beach: BLOCK.SAND, sub: BLOCK.SAND, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: null,
    trees: { density: 3, type: 'cactus' },
  },
  tundra: {
    id: 'tundra',
    seaLevel: 24,
    heightAmp: [6, 3, 8],
    heightFreq: [0.015, 0.05, 0.005],
    heightOffset: 0,
    surface: { top: BLOCK.SNOW, beach: BLOCK.SNOW, sub: BLOCK.DIRT, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: { id: BLOCK.ICE, level: 24 },
    trees: { density: 2, type: 'spruce' },
  },
  volcanic: {
    id: 'volcanic',
    seaLevel: 24,
    heightAmp: [12, 6, 6],
    heightFreq: [0.018, 0.06, 0.006],
    heightOffset: -2, // pits and ridges
    surface: { top: BLOCK.STONE, beach: BLOCK.STONE, sub: BLOCK.STONE, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: { id: BLOCK.LAVA, level: 22 },
    trees: { density: 1, type: 'dead' },
  },
};

// =============================================================================
// THEMES (server-side rooms)
// =============================================================================
// Two flavours of multi-biome worlds (Faction and Minage) share the same biome
// composition but use different seeds, so the maps are different but both
// contain all 4 biomes. Event is a calm single-biome creative-friendly world.
// PvP is a flat arena.
export const THEMES = {
  faction: {
    id: 'faction',
    name: 'Faction',
    mode: 'survival',
    tagline: 'Conquêtes et bases · mode survie',
    color: '#c43a3a',
    accent: '#ffb86b',
    seed: 'faction-2026',
    multiBiome: true,
    biomeFreq: 0.004, // very low frequency = wide biome regions
    sky: { rayleigh: 1.9, mieG: 0.83, turbidity: 9 },
    fog: { day: 0xb8d0e8, warm: 0xff9c6e, night: 0x070b1a },
    light: { hemiTop: 0xcfdcf0, hemiBottom: 0x6a4a2a, ambient: 0x2a2a30, sunHueShift: 0 },
    hotbar: [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.WOOD, BLOCK.PLANKS, BLOCK.GLASS, BLOCK.SAND, BLOCK.LEAVES, BLOCK.SNOW],
  },
  minage: {
    id: 'minage',
    name: 'Minage',
    mode: 'survival',
    tagline: 'Survie minière · creuse pour vivre',
    color: '#7a6648',
    accent: '#bfa980',
    seed: 'minage-2026',
    multiBiome: true,
    biomeFreq: 0.005,
    sky: { rayleigh: 1.8, mieG: 0.8, turbidity: 8 },
    fog: { day: 0xc8d6e6, warm: 0xff9c6e, night: 0x080a14 },
    light: { hemiTop: 0xd8e2f0, hemiBottom: 0x4a3a2a, ambient: 0x252530, sunHueShift: 0 },
    hotbar: [BLOCK.STONE, BLOCK.DIRT, BLOCK.GRASS, BLOCK.WOOD, BLOCK.PLANKS, BLOCK.SAND, BLOCK.SNOW, BLOCK.GLASS, BLOCK.BEDROCK],
  },
  event: {
    id: 'event',
    name: 'Événement',
    mode: 'creative',
    tagline: 'Créatif · construis sans limite',
    color: '#a04abf',
    accent: '#f37cd2',
    seed: 'event-2026',
    seaLevel: 24,
    heightAmp: [4, 2, 6],
    heightFreq: [0.012, 0.04, 0.004],
    heightOffset: 0,
    surface: { top: BLOCK.GRASS, beach: BLOCK.SAND, sub: BLOCK.DIRT, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: { id: BLOCK.WATER, level: 24 },
    trees: { density: 6, type: 'oak' },
    sky: { rayleigh: 2.4, mieG: 0.86, turbidity: 7 },
    fog: { day: 0xe0c8ff, warm: 0xff9bd4, night: 0x100620 },
    light: { hemiTop: 0xeed4ff, hemiBottom: 0x6a4a8a, ambient: 0x301a40, sunHueShift: 0.02 },
    hotbar: [BLOCK.GRASS, BLOCK.PLANKS, BLOCK.GLASS, BLOCK.LEAVES, BLOCK.WOOD, BLOCK.STONE, BLOCK.WATER, BLOCK.SAND, BLOCK.LAVA],
  },
  pvp: {
    id: 'pvp',
    name: 'Mini-jeux & PvP',
    mode: 'creative',
    tagline: 'Arène plate · duels et parkour',
    color: '#1f2933',
    accent: '#ff5c5c',
    seed: 'pvp-2026',
    flat: true,
    flatHeight: 24, // top of grass
    surface: { top: BLOCK.GRASS, beach: BLOCK.SAND, sub: BLOCK.DIRT, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: null,
    trees: { density: 0, type: 'none' },
    sky: { rayleigh: 1.4, mieG: 0.78, turbidity: 5 },
    fog: { day: 0xa8b8c8, warm: 0xff7060, night: 0x0a0a14 },
    light: { hemiTop: 0xc0c8d4, hemiBottom: 0x404a55, ambient: 0x202830, sunHueShift: 0 },
    hotbar: [BLOCK.STONE, BLOCK.PLANKS, BLOCK.WOOD, BLOCK.GLASS, BLOCK.LEAVES, BLOCK.GRASS, BLOCK.SAND, BLOCK.DIRT, BLOCK.BEDROCK],
  },
};

export function themeById(id) {
  return THEMES[id] || THEMES.faction;
}
