import { BLOCK } from './blocks.js';

// Each theme is a fully self-contained recipe for procedurally generating a
// world AND its visual atmosphere. Both the server seed and these parameters
// must match across all clients so everyone sees the same terrain.

export const THEMES = {
  forest: {
    id: 'forest',
    name: 'Forêt',
    tagline: 'Collines verdoyantes et lacs paisibles',
    color: '#4caf50',
    accent: '#83d96a',
    seed: 'forest-2026',
    seaLevel: 24,
    heightAmp: [8, 4, 9.6],
    heightFreq: [0.015, 0.05, 0.005],
    surface: { top: BLOCK.GRASS, beach: BLOCK.SAND, sub: BLOCK.DIRT, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: { id: BLOCK.WATER, level: 24 },
    trees: { density: 4, type: 'oak' },
    sky: { rayleigh: 1.6, mieG: 0.85, turbidity: 8 },
    fog: { day: 0xa8d2ff, warm: 0xff9c6e, night: 0x070b1a },
    light: { hemiTop: 0xbfd8ff, hemiBottom: 0x4a3a2a, ambient: 0x222233, sunHueShift: 0 },
    hotbar: [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.SAND, BLOCK.WOOD, BLOCK.PLANKS, BLOCK.GLASS],
  },
  desert: {
    id: 'desert',
    name: 'Désert',
    tagline: 'Dunes infinies sous un soleil ocre',
    color: '#e0a850',
    accent: '#f3d27c',
    seed: 'desert-2026',
    seaLevel: 18, // mostly above terrain → no oceans
    heightAmp: [10, 4, 5],
    heightFreq: [0.012, 0.05, 0.004],
    heightOffset: 8, // push everything above sea level
    surface: { top: BLOCK.SAND, beach: BLOCK.SAND, sub: BLOCK.SAND, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: null,
    trees: { density: 3, type: 'cactus' },
    sky: { rayleigh: 2.6, mieG: 0.7, turbidity: 12 },
    fog: { day: 0xf3d8a8, warm: 0xff8b4d, night: 0x1a1226 },
    light: { hemiTop: 0xffe6b8, hemiBottom: 0x8a5a30, ambient: 0x382a18, sunHueShift: 0.02 },
    hotbar: [BLOCK.SAND, BLOCK.STONE, BLOCK.CACTUS, BLOCK.PLANKS, BLOCK.GLASS, BLOCK.WOOD, BLOCK.LEAVES],
  },
  tundra: {
    id: 'tundra',
    name: 'Toundra',
    tagline: 'Plaines gelées et lacs de glace',
    color: '#8ecae6',
    accent: '#dceffb',
    seed: 'tundra-2026',
    seaLevel: 24,
    heightAmp: [6, 3, 8],
    heightFreq: [0.015, 0.05, 0.005],
    surface: { top: BLOCK.SNOW, beach: BLOCK.SNOW, sub: BLOCK.DIRT, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: { id: BLOCK.ICE, level: 24 },
    trees: { density: 2, type: 'spruce' },
    sky: { rayleigh: 3.2, mieG: 0.78, turbidity: 6 },
    fog: { day: 0xd4e6f3, warm: 0xe2c4d2, night: 0x1a2030 },
    light: { hemiTop: 0xeaf4ff, hemiBottom: 0x9bb6c8, ambient: 0x2a3340, sunHueShift: -0.01 },
    hotbar: [BLOCK.SNOW, BLOCK.ICE, BLOCK.STONE, BLOCK.WOOD, BLOCK.PLANKS, BLOCK.LEAVES, BLOCK.GLASS],
  },
  volcanic: {
    id: 'volcanic',
    name: 'Volcanique',
    tagline: 'Pierre noire fissurée par la lave',
    color: '#c43a3a',
    accent: '#ff7a3a',
    seed: 'volcanic-2026',
    seaLevel: 22,
    heightAmp: [12, 6, 6],
    heightFreq: [0.018, 0.06, 0.006],
    surface: { top: BLOCK.STONE, beach: BLOCK.STONE, sub: BLOCK.STONE, deep: BLOCK.STONE, bedrock: BLOCK.BEDROCK },
    fluid: { id: BLOCK.LAVA, level: 22 },
    trees: { density: 1, type: 'dead' },
    sky: { rayleigh: 4.0, mieG: 0.9, turbidity: 18 },
    fog: { day: 0x6e3a30, warm: 0xff5a28, night: 0x100808 },
    light: { hemiTop: 0xff8a4a, hemiBottom: 0x301010, ambient: 0x401818, sunHueShift: 0.04 },
    hotbar: [BLOCK.STONE, BLOCK.BEDROCK, BLOCK.LAVA, BLOCK.WOOD, BLOCK.PLANKS, BLOCK.GLASS, BLOCK.SAND],
  },
};

export function themeById(id) {
  return THEMES[id] || THEMES.forest;
}
