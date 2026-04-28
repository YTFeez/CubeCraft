import * as THREE from 'three';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { BLOCK, isOpaque, isSolid, isFluid, isFluidSource, fluidGroup, BLOCK_INFO, tileUV, getFaceTile } from './blocks.js';
import { BIOMES } from './themes.js';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
export const SEA_LEVEL = 24;

// Hierarchical biome layout along the temperature axis.
// Order is COLD -> TEMPERATE -> HOT. Volcanic is NOT in this list; it is
// carved INSIDE desert by a separate noise gate (see _biomeAt).
const T_BANDS = [
  BIOMES.tundra, // T = -0.7
  BIOMES.forest, // T =  0.0  (plains, the dominant default)
  BIOMES.desert, // T = +0.7  (hot, contains volcanic patches)
];

const FACES = [
  // +X
  { dir: [1, 0, 0],  corners: [[1,0,0],[1,0,1],[1,1,0],[1,1,1]], uvOrder: 'side', normal: [1,0,0] },
  // -X
  { dir: [-1, 0, 0], corners: [[0,0,1],[0,0,0],[0,1,1],[0,1,0]], uvOrder: 'side', normal: [-1,0,0] },
  // +Y (top)
  { dir: [0, 1, 0],  corners: [[0,1,1],[1,1,1],[0,1,0],[1,1,0]], uvOrder: 'top', normal: [0,1,0] },
  // -Y (bottom)
  { dir: [0, -1, 0], corners: [[0,0,0],[1,0,0],[0,0,1],[1,0,1]], uvOrder: 'bottom', normal: [0,-1,0] },
  // +Z
  { dir: [0, 0, 1],  corners: [[1,0,1],[0,0,1],[1,1,1],[0,1,1]], uvOrder: 'side', normal: [0,0,1] },
  // -Z
  { dir: [0, 0, -1], corners: [[0,0,0],[1,0,0],[0,1,0],[1,1,0]], uvOrder: 'side', normal: [0,0,-1] },
];

// Deterministic PRNG from seed string.
function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export class World {
  constructor(theme, scene, material, transparentMaterial, waterMaterial) {
    this.theme = theme;
    this.seed = theme.seed;
    this.scene = scene;
    this.material = material;
    this.transparentMaterial = transparentMaterial;
    this.waterMaterial = waterMaterial;
    this.chunks = new Map(); // key "cx,cz" -> Chunk
    this.edits = new Map();  // key "cx,cz" -> Map<"lx,ly,lz", blockId> (persistent across unload)
    const rand = mulberry32(hashStr(this.seed));
    this.noise2D = createNoise2D(rand);
    this.noise2Db = createNoise2D(rand);
    this.noise3D = createNoise3D(rand);
    // Two extra noises dedicated to biome selection so the biome map is
    // fully decoupled from the height noise.
    this.biomeNoiseA = createNoise2D(rand);
    this.biomeNoiseB = createNoise2D(rand);
    this.rand = rand;
    this.dirty = new Set();
    this.fluidLevels = new Map(); // key "x,y,z" -> flow level
  }

  getChunkEdits(cx, cz, create = false) {
    const k = this.key(cx, cz);
    let m = this.edits.get(k);
    if (!m && create) {
      m = new Map();
      this.edits.set(k, m);
    }
    return m;
  }

  key(cx, cz) { return `${cx},${cz}`; }

  getChunk(cx, cz) {
    return this.chunks.get(this.key(cx, cz));
  }
  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let ch = this.chunks.get(k);
    if (!ch) {
      ch = new Chunk(cx, cz, this);
      this.chunks.set(k, ch);
      ch.generate();
    }
    return ch;
  }

  worldToChunk(x, z) {
    return [Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE)];
  }

  fluidKey(x, y, z) { return `${x},${y},${z}`; }
  setFluidLevel(x, y, z, level) { this.fluidLevels.set(this.fluidKey(x, y, z), level | 0); }
  clearFluidLevel(x, y, z) { this.fluidLevels.delete(this.fluidKey(x, y, z)); }
  getFluidLevel(x, y, z) { return this.fluidLevels.get(this.fluidKey(x, y, z)); }
  getFluidSurfaceHeight(x, y, z, id) {
    if (id === BLOCK.WATER || id === BLOCK.LAVA) return 1.0;
    const lvl = this.getFluidLevel(x, y, z);
    const clamped = lvl == null ? 5 : Math.max(0, Math.min(7, lvl | 0));
    return Math.max(0.32, 0.96 - clamped * 0.12);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_HEIGHT) return BLOCK.AIR;
    const [cx, cz] = this.worldToChunk(x, z);
    const ch = this.getChunk(cx, cz);
    if (!ch) return BLOCK.AIR;
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    return ch.get(lx, y, lz);
  }

  setBlock(x, y, z, id, { save = true } = {}) {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const [cx, cz] = this.worldToChunk(x, z);
    const ch = this.ensureChunk(cx, cz);
    const lx = x - cx * CHUNK_SIZE;
    const lz = z - cz * CHUNK_SIZE;
    if (ch.get(lx, y, lz) === id) return;
    if (!isFluid(id)) this.clearFluidLevel(x, y, z);
    ch.set(lx, y, lz, id);
    if (save) {
      const em = this.getChunkEdits(cx, cz, true);
      em.set(`${lx},${y},${lz}`, id);
    }
    this.dirty.add(ch);
    // Mark neighbor chunks if on border.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  markDirty(cx, cz) {
    const ch = this.getChunk(cx, cz);
    if (ch) this.dirty.add(ch);
  }

  // Called each frame to rebuild dirty chunk meshes (limited per frame).
  flushDirty(max = 4) {
    let n = 0;
    for (const ch of this.dirty) {
      ch.buildMesh();
      this.dirty.delete(ch);
      if (++n >= max) break;
    }
  }

  // Generate chunks around a center position within a view radius (in chunks).
  ensureAround(cx, cz, radius) {
    const created = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const k = this.key(cx + dx, cz + dz);
        if (!this.chunks.has(k)) {
          const ch = new Chunk(cx + dx, cz + dz, this);
          this.chunks.set(k, ch);
          ch.generate();
          created.push(ch);
        }
      }
    }
    for (const ch of created) {
      this.dirty.add(ch);
      // Neighbors may now have a fully-loaded border; rebuild them so faces are correct.
      this.markDirty(ch.cx - 1, ch.cz);
      this.markDirty(ch.cx + 1, ch.cz);
      this.markDirty(ch.cx, ch.cz - 1);
      this.markDirty(ch.cx, ch.cz + 1);
    }
  }

  // Unload chunks outside the view radius.
  unloadOutside(cx, cz, radius) {
    const keep = new Set();
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        keep.add(this.key(cx + dx, cz + dz));
      }
    }
    for (const [k, ch] of this.chunks) {
      if (!keep.has(k)) {
        ch.dispose();
        this.chunks.delete(k);
        this.dirty.delete(ch);
      }
    }
  }

  // Serialize user edits (so regen-on-load keeps modifications).
  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) {
      if (m.size > 0) out[k] = Array.from(m.entries());
    }
    return { seed: this.seed, edits: out };
  }

  applyEdits(data) {
    if (!data || !data.edits) return;
    for (const [k, arr] of Object.entries(data.edits)) {
      let m = this.edits.get(k);
      if (!m) { m = new Map(); this.edits.set(k, m); }
      for (const [pos, id] of arr) m.set(pos, id);
    }
  }

  // Replace local edits with the canonical state coming from the server.
  // editsObj shape: { "cx,cz": { "lx,ly,lz": blockId, ... }, ... }
  applyServerEdits(editsObj) {
    if (!editsObj) return;
    for (const [chunkKey, blocks] of Object.entries(editsObj)) {
      let m = this.edits.get(chunkKey);
      if (!m) { m = new Map(); this.edits.set(chunkKey, m); }
      for (const [pos, id] of Object.entries(blocks)) {
        m.set(pos, id | 0);
      }
    }
  }

  // ---------- Fluid simulation (cellular automaton, on demand) ----------
  // The flow simulation is event-driven: it runs whenever the local player
  // places or breaks a block (via Interaction). Around the change we:
  //   1. Snapshot a (2r+1)^3 box of blocks.
  //   2. Clear all flowing fluid blocks in the box (they will be re-derived).
  //   3. For every fluid SOURCE in the box, check the sealing rule:
  //      a source whose 6 neighbours are all solid non-fluids is "bouchée"
  //      and is removed.
  //   4. BFS from every remaining source, with `down = same level` and
  //      `side = level + 1`, placing flowing fluid up to FLUID_FLOW_RANGE
  //      in air cells; we never overwrite solids or other-group fluids.
  //   5. Diff against the snapshot and emit each change via `onChange` so the
  //      caller can persist / broadcast the resulting edits.
  //
  // Only the originating client runs this; remote players just receive the
  // resulting setBlock edits, so the simulation stays consistent without the
  // server having to know about fluids.
  recomputeFluidsAround(wx, wy, wz, { radius = 6, onChange = null } = {}) {
    // Box must be wide enough that any in-box source can reach (and be reached
    // from) the box centre without truncation. We pad the user-provided radius
    // by FLUID_FLOW_RANGE, and leave a generous vertical margin so falling
    // water has room to descend (gravity doesn't consume the level budget).
    const FLUID_FLOW_RANGE = 5;
    const rh = radius + FLUID_FLOW_RANGE;       // ~11
    const rv = Math.max(radius, 12) + FLUID_FLOW_RANGE; // ~17
    const minX = wx - rh, maxX = wx + rh;
    const minY = Math.max(0, wy - rv), maxY = Math.min(WORLD_HEIGHT - 1, wy + rv);
    const minZ = wz - rh, maxZ = wz + rh;

    const before = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          before.set(key(x, y, z), this.getBlock(x, y, z));
        }
      }
    }

    // Step 1: clear flowing fluid blocks (we rebuild them from sources).
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const id = this.getBlock(x, y, z);
          if (id === BLOCK.WATER_FLOW || id === BLOCK.LAVA_FLOW) {
            this.clearFluidLevel(x, y, z);
            this.setBlock(x, y, z, BLOCK.AIR);
          }
        }
      }
    }

    // Step 2: collect alive sources, dropping any that are fully sealed.
    const sources = [];
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const id = this.getBlock(x, y, z);
          if (!isFluidSource(id)) continue;
          // Sealing rule: every direct neighbour must be a SOLID non-fluid.
          // If any neighbour is air or any fluid, the source still has an
          // outflow and stays alive.
          const ns = [
            this.getBlock(x + 1, y, z),
            this.getBlock(x - 1, y, z),
            this.getBlock(x, y + 1, z),
            this.getBlock(x, y - 1, z),
            this.getBlock(x, y, z + 1),
            this.getBlock(x, y, z - 1),
          ];
          let sealed = true;
          for (const n of ns) {
            if (n === BLOCK.AIR) { sealed = false; break; }
            if (BLOCK_INFO[n]?.fluid) { sealed = false; break; }
          }
          if (sealed) {
            this.clearFluidLevel(x, y, z);
            this.setBlock(x, y, z, BLOCK.AIR);
          } else {
            this.setFluidLevel(x, y, z, 0);
            sources.push({ x, y, z, group: fluidGroup(id) });
          }
        }
      }
    }

    // Step 3: BFS flow placement. Down-step keeps the same level (gravity);
    // sideways steps add 1 until FLUID_FLOW_RANGE is reached.
    const visited = new Map(); // pos -> level
    const queue = [];
    for (const s of sources) {
      visited.set(key(s.x, s.y, s.z), 0);
      queue.push({ x: s.x, y: s.y, z: s.z, level: 0, group: s.group });
    }
    while (queue.length > 0) {
      const c = queue.shift();
      const dirs = [
        { dx: 0, dy: -1, dz: 0, levelInc: 0 }, // gravity
        { dx: 1,  dy: 0, dz: 0,  levelInc: 1 },
        { dx: -1, dy: 0, dz: 0,  levelInc: 1 },
        { dx: 0,  dy: 0, dz: 1,  levelInc: 1 },
        { dx: 0,  dy: 0, dz: -1, levelInc: 1 },
      ];
      for (const d of dirs) {
        const nx = c.x + d.dx, ny = c.y + d.dy, nz = c.z + d.dz;
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        if (nx < minX || nx > maxX || nz < minZ || nz > maxZ) continue;
        const nlevel = c.level + d.levelInc;
        if (nlevel > FLUID_FLOW_RANGE) continue;
        const k = key(nx, ny, nz);
        const prev = visited.get(k);
        if (prev != null && prev <= nlevel) continue;
        const id = this.getBlock(nx, ny, nz);
        // Only flow into air; sources, other-group fluids and solids stop us.
        if (id !== BLOCK.AIR) continue;
        const flowId = c.group === 'water' ? BLOCK.WATER_FLOW : BLOCK.LAVA_FLOW;
        this.setBlock(nx, ny, nz, flowId);
        this.setFluidLevel(nx, ny, nz, nlevel);
        visited.set(k, nlevel);
        queue.push({ x: nx, y: ny, z: nz, level: nlevel, group: c.group });
      }
    }

    // Step 4: emit edits for every cell that actually changed.
    if (onChange) {
      for (const [k, oldId] of before) {
        const [xs, ys, zs] = k.split(',').map(Number);
        const newId = this.getBlock(xs, ys, zs);
        if (newId !== oldId) onChange(xs, ys, zs, newId);
      }
    }
  }

  // Apply an edit pushed by the server (silently, without triggering callbacks
  // that would re-broadcast it). Marks chunks dirty so they re-mesh.
  applyRemoteEdit(cx, cz, lx, ly, lz, blockId) {
    const em = this.getChunkEdits(cx, cz, true);
    em.set(`${lx},${ly},${lz}`, blockId | 0);
    const ch = this.getChunk(cx, cz);
    if (ch) {
      const wx = cx * CHUNK_SIZE + lx;
      const wz = cz * CHUNK_SIZE + lz;
      if (!isFluid(blockId)) this.clearFluidLevel(wx, ly, wz);
      else if (blockId === BLOCK.WATER || blockId === BLOCK.LAVA) this.setFluidLevel(wx, ly, wz, 0);
      ch.set(lx, ly, lz, blockId | 0);
      this.dirty.add(ch);
      if (lx === 0) this.markDirty(cx - 1, cz);
      if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
      if (lz === 0) this.markDirty(cx, cz - 1);
      if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    }
  }
}

export class Chunk {
  constructor(cx, cz, world) {
    this.cx = cx;
    this.cz = cz;
    this.world = world;
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    this.mesh = null;
    this.meshTransparent = null;
    this.meshWater = null;
  }

  idx(x, y, z) { return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x; }

  get(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) {
      // Peek into neighbor chunk for proper face culling at borders.
      const wx = this.cx * CHUNK_SIZE + x;
      const wz = this.cz * CHUNK_SIZE + z;
      return this.world.getBlock(wx, y, wz);
    }
    return this.blocks[this.idx(x, y, z)];
  }
  set(x, y, z, id) {
    this.blocks[this.idx(x, y, z)] = id;
  }

  generate() {
    const theme = this.world.theme;
    if (theme.flat) this._generateFlat();
    else this._generateTerrain();
    this._applyEdits();
  }

  _applyEdits() {
    const edits = this.world.edits.get(this.world.key(this.cx, this.cz));
    if (!edits) return;
    for (const [pos, id] of edits) {
      const [lx, ly, lz] = pos.split(',').map(Number);
      this.set(lx, ly, lz, id);
    }
  }

  // Flat arena world: bedrock at y=0, stone, then a single grass cap.
  _generateFlat() {
    const theme = this.world.theme;
    const top = theme.flatHeight ?? 24;
    const surf = theme.surface;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          let block = BLOCK.AIR;
          if (y === 0) block = surf.bedrock;
          else if (y < top - 1) block = surf.deep;
          else if (y < top) block = surf.sub;
          else if (y === top) block = surf.top;
          this.set(lx, y, lz, block);
        }
      }
    }
  }

  // Compute the biome blend at (worldX, worldZ) using a hierarchical climate
  // model:
  //   1. T (temperature) is a low-freq noise + high-freq jitter; it selects
  //      between the three T-bands {tundra, forest/plains, desert} with a
  //      Gaussian weight, giving smooth gradient transitions.
  //   2. Inside hot zones (desert dominant), a separate V noise carves
  //      volcanic patches. The carving is gated by desert dominance so
  //      volcanic never appears next to plains or tundra directly.
  //
  // Returns blended params (seaLevel, heightAmp, heightFreq, heightOffset)
  // and a `dominant` biome object used for surface block, fluid and trees.
  _biomeAt(wx, wz, freq) {
    const w = this.world;
    // 1) Temperature: very low frequency = wide bands. A small higher-freq
    //    jitter feathers the borders so they don't look like clean noise
    //    iso-lines.
    const T0 = w.biomeNoiseA(wx * freq, wz * freq);
    const Tj = w.biomeNoiseA(wx * freq * 7 + 5000, wz * freq * 7 + 5000);
    const T = Math.max(-1, Math.min(1, T0 + Tj * 0.15));

    // 2) Volcanic gate: independent noise at a slightly higher freq so
    //    volcanic patches feel like islands inside the desert.
    const V0 = w.biomeNoiseB(wx * freq * 2.2 + 9999, wz * freq * 2.2 - 9999);
    const Vj = w.biomeNoiseB(wx * freq * 9 - 1234, wz * freq * 9 + 1234);
    const V = V0 + Vj * 0.10;

    // 3) Weights along T axis (Gaussian on |T - bandT|).
    const bands = T_BANDS;
    const ws = [0, 0, 0];
    let total = 0, bestIdx = 1, bestW = -Infinity;
    for (let i = 0; i < bands.length; i++) {
      const dT = T - bands[i].T;
      // k=10 keeps each biome dominant in its band but still leaves a wide
      // gradient in the boundary zone (about 0.15 in T).
      const wi = Math.exp(-dT * dT * 10);
      ws[i] = wi;
      total += wi;
      if (wi > bestW) { bestW = wi; bestIdx = i; }
    }
    if (total > 0) for (let i = 0; i < ws.length; i++) ws[i] /= total;

    // 4) Volcanic factor: only "fires" when desert dominance is strong AND V
    //    crosses a threshold. Smoothstep on V keeps patches bordered cleanly.
    const desertW = ws[2];
    let volcanicFactor = 0;
    if (desertW > 0.55 && V > 0.30) {
      const vt = Math.min(1, (V - 0.30) / 0.30);     // 0..1 over V in [0.30, 0.60]
      const dt = Math.min(1, (desertW - 0.55) / 0.25); // 0..1 over desertW in [0.55, 0.80]
      const sV = vt * vt * (3 - 2 * vt);             // smoothstep
      const sD = dt * dt * (3 - 2 * dt);
      volcanicFactor = sV * sD;
    }

    // 5) Blend numeric params from T-bands.
    let seaLevel = 0, heightOffset = 0;
    const heightAmp = [0, 0, 0];
    const heightFreq = [0, 0, 0];
    for (let i = 0; i < bands.length; i++) {
      const wi = ws[i];
      const b = bands[i];
      seaLevel     += wi * (b.seaLevel ?? SEA_LEVEL);
      heightOffset += wi * (b.heightOffset || 0);
      heightAmp[0] += wi * b.heightAmp[0];
      heightAmp[1] += wi * b.heightAmp[1];
      heightAmp[2] += wi * b.heightAmp[2];
      heightFreq[0]+= wi * b.heightFreq[0];
      heightFreq[1]+= wi * b.heightFreq[1];
      heightFreq[2]+= wi * b.heightFreq[2];
    }

    // 6) If volcanic is firing, lerp params toward volcanic for a hotter,
    //    pittier terrain inside the patch.
    if (volcanicFactor > 0) {
      const vb = BIOMES.volcanic;
      const f = volcanicFactor;
      seaLevel     = seaLevel + (vb.seaLevel - seaLevel) * f;
      heightOffset = heightOffset + (vb.heightOffset - heightOffset) * f;
      for (let k = 0; k < 3; k++) {
        heightAmp[k]  = heightAmp[k] + (vb.heightAmp[k]  - heightAmp[k])  * f;
        heightFreq[k] = heightFreq[k] + (vb.heightFreq[k] - heightFreq[k]) * f;
      }
    }

    // Pick dominant biome: volcanic only when its factor crosses 0.5 so
    // surface flips cleanly.
    const dominant = volcanicFactor >= 0.5 ? BIOMES.volcanic : bands[bestIdx];

    return {
      weights: ws,
      dominant,
      volcanicFactor,
      seaLevel,
      heightAmp,
      heightFreq,
      heightOffset,
      surface: dominant.surface,
      fluid: dominant.fluid,
      trees: dominant.trees,
    };
  }

  // Standard heightmap generation. Per-column climate-blended biome lookup
  // when the theme is multiBiome; otherwise uses a single biome straight from
  // the theme.
  _generateTerrain() {
    const { noise2D, noise2Db } = this.world;
    const theme = this.world.theme;
    const origin = [this.cx * CHUNK_SIZE, this.cz * CHUNK_SIZE];
    const heights = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomeAt = new Array(CHUNK_SIZE * CHUNK_SIZE);

    const multi = !!theme.multiBiome;
    const biomeFreq = theme.biomeFreq || 0.005;

    // Default (single-biome) params come straight from the theme.
    const defaultBiome = multi ? null : {
      seaLevel: theme.seaLevel ?? SEA_LEVEL,
      heightAmp: theme.heightAmp,
      heightFreq: theme.heightFreq,
      heightOffset: theme.heightOffset || 0,
      surface: theme.surface,
      fluid: theme.fluid,
      trees: theme.trees || { density: 0, type: 'none' },
      dominant: { id: 'theme' },
    };

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = origin[0] + lx;
        const wz = origin[1] + lz;
        const biome = multi ? this._biomeAt(wx, wz, biomeFreq) : defaultBiome;
        biomeAt[lz * CHUNK_SIZE + lx] = biome;

        const [a1, a2, a3] = biome.heightAmp;
        const [f1, f2, f3] = biome.heightFreq;
        const offset = biome.heightOffset || 0;
        const seaLevel = biome.seaLevel ?? SEA_LEVEL;
        const surf = biome.surface;
        const fluid = biome.fluid;

        const n1 = noise2D(wx * f1, wz * f1) * a1;
        const n2 = noise2D(wx * f2, wz * f2) * a2;
        const n3 = noise2Db(wx * f3, wz * f3) * a3;
        const h = Math.floor(seaLevel + offset + n1 + n2 + n3);
        const height = Math.max(4, Math.min(WORLD_HEIGHT - 4, h));
        heights[lz * CHUNK_SIZE + lx] = height;

        for (let y = 0; y < WORLD_HEIGHT; y++) {
          let block = BLOCK.AIR;
          if (y === 0) block = surf.bedrock;
          else if (y < height - 4) block = surf.deep;
          else if (y < height) block = surf.sub;
          else if (y === height) {
            block = (height <= seaLevel + 1) ? surf.beach : surf.top;
          } else if (fluid && y <= fluid.level) {
            block = fluid.id;
          }
          this.set(lx, y, lz, block);
        }
      }
    }

    // Trees: stable per-chunk RNG so results are deterministic across clients.
    const chRand = mulberry32(
      (hashStr(this.world.seed) ^ (this.cx * 73856093) ^ (this.cz * 19349663)) >>> 0
    );

    if (multi) {
      // Probabilistic per-attempt placement: each attempt rolls against the
      // local biome's tree density, so forests are dense and deserts/volcanic
      // are sparse without us having to pick a single density per chunk.
      const TREE_ATTEMPTS = 16;
      for (let i = 0; i < TREE_ATTEMPTS; i++) {
        const tx = Math.floor(chRand() * CHUNK_SIZE);
        const tz = Math.floor(chRand() * CHUNK_SIZE);
        const h = heights[tz * CHUNK_SIZE + tx];
        const biome = biomeAt[tz * CHUNK_SIZE + tx];
        const tcfg = biome.trees || { density: 0, type: 'none' };
        if (!tcfg.type || tcfg.type === 'none') continue;
        // Density 0..5 → probability 0..0.5
        const prob = Math.max(0, Math.min(1, (tcfg.density || 0) / 10));
        if (chRand() > prob) continue;
        if (!this._isTreeSiteOk(tx, h, tz, biome)) continue;
        this._growTree(tcfg.type, tx, h, tz, chRand);
      }
    } else {
      // Single-biome theme: classic per-chunk count.
      const treeCount = Math.floor(chRand() * (defaultBiome.trees.density + 1));
      for (let i = 0; i < treeCount; i++) {
        const tx = Math.floor(chRand() * CHUNK_SIZE);
        const tz = Math.floor(chRand() * CHUNK_SIZE);
        const h = heights[tz * CHUNK_SIZE + tx];
        if (!this._isTreeSiteOk(tx, h, tz, defaultBiome)) continue;
        const tcfg = defaultBiome.trees;
        if (!tcfg.type || tcfg.type === 'none') continue;
        this._growTree(tcfg.type, tx, h, tz, chRand);
      }
    }

    // Caves + ore veins (survival worlds only; deterministic from seed + chunk).
    if (theme.mode === 'survival' && !theme.flat) {
      this._carveCavesAndOres(heights, origin);
    }
  }

  /**
   * 3D worm noise carves air pockets; then sparse ores replace stone only.
   */
  _carveCavesAndOres(heights, origin) {
    const w = this.world;
    const nh = (wx, wy, wz) => w.noise3D(wx * 0.043, wy * 0.062, wz * 0.041);
    const nh2 = (wx, wy, wz) => w.noise3D(wx * 0.11 + 400, wy * 0.09 + 200, wz * 0.11 - 300);
    const nh3 = (wx, wy, wz) => w.noise3D(wx * 0.021, wy * 0.028, wz * 0.021);
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = origin[0] + lx;
        const wz = origin[1] + lz;
        const height = heights[lz * CHUNK_SIZE + lx];
        const maxY = Math.min(height + 14, WORLD_HEIGHT - 4);
        for (let y = 4; y < maxY; y++) {
          const id = this.get(lx, y, lz);
          if (id === BLOCK.BEDROCK || id === BLOCK.AIR) continue;
          if (id === BLOCK.WATER || id === BLOCK.LAVA || id === BLOCK.ICE) continue;
          const n1 = nh(wx, y, wz);
          const n2 = nh2(wx, y, wz);
          const worm = n1 > 0.38 && n2 < 0.56;
          const chamber = nh3(wx, y, wz) > 0.58;
          if ((worm || chamber) && (y < height - 2 || y < SEA_LEVEL - 3)) {
            this.set(lx, y, lz, BLOCK.AIR);
          }
        }
      }
    }

    const rOre = mulberry32(
      (hashStr(w.seed) ^ (this.cx * 9973) ^ (this.cz * 9109)) >>> 0
    );
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = origin[0] + lx;
        const wz = origin[1] + lz;
        for (let y = 3; y < WORLD_HEIGHT - 3; y++) {
          if (this.get(lx, y, lz) !== BLOCK.STONE) continue;
          const v = w.noise3D(wx * 0.09 + 777, y * 0.11, wz * 0.09 - 555);
          const v2 = w.noise3D(wx * 0.07 - 222, y * 0.08, wz * 0.07 + 888);
          if (y < 44 && y > 6 && v > 0.78 && rOre() < 0.11) this.set(lx, y, lz, BLOCK.COAL_ORE);
          else if (y < 36 && y > 8 && v2 > 0.81 && rOre() < 0.07) this.set(lx, y, lz, BLOCK.IRON_ORE);
          else if (y < 28 && y > 6 && v > 0.83 && v2 > 0.72 && rOre() < 0.045) this.set(lx, y, lz, BLOCK.GOLD_ORE);
          else if (y < 14 && y > 5 && v + v2 > 1.52 && rOre() < 0.035) this.set(lx, y, lz, BLOCK.DIAMOND_ORE);
        }
      }
    }
  }

  _isTreeSiteOk(tx, h, tz, biome) {
    const seaLevel = biome.seaLevel ?? SEA_LEVEL;
    if (h <= seaLevel + 1) return false;
    if (tx < 2 || tx > CHUNK_SIZE - 3 || tz < 2 || tz > CHUNK_SIZE - 3) return false;
    const top = this.get(tx, h, tz);
    if (top === BLOCK.LAVA || top === BLOCK.WATER || top === BLOCK.ICE) return false;
    // Don't grow cacti on grass or oaks on sand: enforce surface compatibility.
    const tcfg = biome.trees || {};
    if (tcfg.type === 'cactus' && top !== BLOCK.SAND) return false;
    if (tcfg.type === 'oak'    && top !== BLOCK.GRASS) return false;
    if (tcfg.type === 'spruce' && top !== BLOCK.SNOW && top !== BLOCK.GRASS) return false;
    if (tcfg.type === 'dead'   && top !== BLOCK.STONE) return false;
    return true;
  }

  _growTree(type, tx, h, tz, rand) {
    if (type === 'oak') {
      const trunkH = 4 + Math.floor(rand() * 2);
      for (let t = 1; t <= trunkH; t++) this.set(tx, h + t, tz, BLOCK.WOOD);
      this._canopy(tx, h + trunkH, tz, [2, 2, 1, 0], BLOCK.LEAVES);
    } else if (type === 'spruce') {
      const trunkH = 5 + Math.floor(rand() * 3);
      for (let t = 1; t <= trunkH; t++) this.set(tx, h + t, tz, BLOCK.WOOD);
      this._canopy(tx, h + trunkH, tz, [2, 1, 1, 0], BLOCK.LEAVES);
    } else if (type === 'cactus') {
      const stalkH = 2 + Math.floor(rand() * 3);
      for (let t = 1; t <= stalkH; t++) this.set(tx, h + t, tz, BLOCK.CACTUS);
    } else if (type === 'dead') {
      const trunkH = 3 + Math.floor(rand() * 2);
      for (let t = 1; t <= trunkH; t++) this.set(tx, h + t, tz, BLOCK.WOOD);
      // a couple of stubby branches, no leaves
      if (h + trunkH < WORLD_HEIGHT - 1) {
        this.set(Math.min(CHUNK_SIZE - 1, tx + 1), h + trunkH, tz, BLOCK.WOOD);
      }
    }
  }

  // Place leafy layers above (tx, top, tz) using `radii[k]` for layer y=top + (k - 1).
  _canopy(tx, top, tz, radii, leafBlock) {
    for (let k = 0; k < radii.length; k++) {
      const dy = k - 1; // layer y offset
      const r = radii[k];
      if (r === 0) {
        const ly = top + dy;
        if (this.get(tx, ly, tz) === BLOCK.AIR) this.set(tx, ly, tz, leafBlock);
        continue;
      }
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx === 0 && dz === 0 && dy < 1) continue; // keep trunk
          const lx = tx + dx, lz = tz + dz, ly = top + dy;
          if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) continue;
          if (this.get(lx, ly, lz) === BLOCK.AIR) this.set(lx, ly, lz, leafBlock);
        }
      }
    }
  }

  // Per-corner AO (0..3) for the face on block (bx,by,bz) with given normal.
  // corner: [cx,cy,cz] in {0,1}^3 (a vertex of the unit cube).
  _aoCorner(bx, by, bz, normal, corner) {
    // Air-side cell coordinates.
    const ax = bx + normal[0];
    const ay = by + normal[1];
    const az = bz + normal[2];
    // Tangent axis offsets are determined by corner sign on axes where normal == 0.
    const tx = normal[0] === 0 ? (corner[0] === 1 ? 1 : -1) : 0;
    const ty = normal[1] === 0 ? (corner[1] === 1 ? 1 : -1) : 0;
    const tz = normal[2] === 0 ? (corner[2] === 1 ? 1 : -1) : 0;
    // The two non-zero axes give the two side neighbors, both non-zero gives the diagonal corner.
    // Pick the two tangent axes (skip the one matching normal direction).
    let s1x = 0, s1y = 0, s1z = 0, s2x = 0, s2y = 0, s2z = 0;
    if (normal[0] !== 0) { s1x = 0; s1y = ty; s1z = 0; s2x = 0; s2y = 0; s2z = tz; }
    else if (normal[1] !== 0) { s1x = tx; s1y = 0; s1z = 0; s2x = 0; s2y = 0; s2z = tz; }
    else { s1x = tx; s1y = 0; s1z = 0; s2x = 0; s2y = ty; s2z = 0; }
    const side1 = isOpaque(this.get(ax + s1x, ay + s1y, az + s1z)) ? 1 : 0;
    const side2 = isOpaque(this.get(ax + s2x, ay + s2y, az + s2z)) ? 1 : 0;
    const cornr = isOpaque(this.get(ax + tx,  ay + ty,  az + tz )) ? 1 : 0;
    if (side1 && side2) return 0;
    return 3 - (side1 + side2 + cornr);
  }

  _fluidCornerHeight(wx, wy, wz, group, corner) {
    // If there is fluid above this block, top remains flat/full.
    if (fluidGroup(this.world.getBlock(wx, wy + 1, wz)) === group) return 1.0;
    const xSide = corner[0] === 1 ? 1 : -1;
    const zSide = corner[2] === 1 ? 1 : -1;
    const samples = [
      [wx, wy, wz],
      [wx + xSide, wy, wz],
      [wx, wy, wz + zSide],
      [wx + xSide, wy, wz + zSide],
    ];
    let sum = 0;
    let n = 0;
    for (const [sx, sy, sz] of samples) {
      const id = this.world.getBlock(sx, sy, sz);
      if (fluidGroup(id) !== group) continue;
      sum += this.world.getFluidSurfaceHeight(sx, sy, sz, id);
      n++;
    }
    return n > 0 ? (sum / n) : 1.0;
  }

  // Resolve water + lava contact: any lava cell (source or flowing) touching
  // water (source or flowing) on any of its 6 sides — possibly across chunk
  // borders — is converted to obsidian. Idempotent: safe to re-run on every
  // mesh rebuild.
  _resolveFluidContact() {
    for (let y = 1; y < WORLD_HEIGHT - 1; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const cur = this.blocks[this.idx(lx, y, lz)];
          if (fluidGroup(cur) !== 'lava') continue;
          if (
            fluidGroup(this.get(lx + 1, y, lz)) === 'water' ||
            fluidGroup(this.get(lx - 1, y, lz)) === 'water' ||
            fluidGroup(this.get(lx, y, lz + 1)) === 'water' ||
            fluidGroup(this.get(lx, y, lz - 1)) === 'water' ||
            fluidGroup(this.get(lx, y + 1, lz)) === 'water' ||
            fluidGroup(this.get(lx, y - 1, lz)) === 'water'
          ) {
            this.set(lx, y, lz, BLOCK.OBSIDIAN);
          }
        }
      }
    }
  }

  buildMesh() {
    // Resolve water/lava → obsidian contacts before meshing so the visible
    // tiles match the actual block data.
    this._resolveFluidContact();

    // Three buckets: opaque (with AO), transparent leaves/glass, water.
    const opaque = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    const trans  = { positions: [], normals: [], uvs: [], colors: [], indices: [] };
    const water  = { positions: [], normals: [], uvs: [], colors: [], indices: [] };

    const origin = [this.cx * CHUNK_SIZE, 0, this.cz * CHUNK_SIZE];

    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < CHUNK_SIZE; z++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const id = this.blocks[this.idx(x, y, z)];
          if (id === BLOCK.AIR) continue;
          const info = BLOCK_INFO[id];
          if (!info) continue;
          let bucket;
          if (info.fluid) bucket = water;
          else if (info.transparent) bucket = trans;
          else bucket = opaque;

          for (const face of FACES) {
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];
            const neighbor = this.get(nx, ny, nz);

            let showFace = false;
            if (neighbor === BLOCK.AIR) showFace = true;
            else if (!isOpaque(neighbor) && isOpaque(id)) showFace = true;
            else if (!isOpaque(id) && !isOpaque(neighbor) && neighbor !== id) {
              // Treat source + flowing of the same liquid as a single body so
              // the internal face between (water, water_flow) is hidden.
              const g = fluidGroup(id);
              if (!(g && g === fluidGroup(neighbor))) showFace = true;
            }
            if (!showFace) continue;

            const tileIndex = getFaceTile(id, face.uvOrder);
            const [u0, v0, u1, v1] = tileUV(tileIndex);

            // Compute AO per corner (only for opaque blocks; others get 1.0).
            const wx = origin[0] + x, wy = y, wz = origin[2] + z;
            const aos = bucket === opaque
              ? face.corners.map(c => this._aoCorner(wx, wy, wz, face.normal, c))
              : [3, 3, 3, 3];

            const baseIndex = bucket.positions.length / 3;
            const uvCorners = [ [u0, v0], [u1, v0], [u0, v1], [u1, v1] ];
            const fluidG = info.fluid ? fluidGroup(id) : null;
            for (let i = 0; i < 4; i++) {
              const c = face.corners[i];
              let yOff = c[1];
              if (fluidG && face.normal[1] === 1) {
                yOff = this._fluidCornerHeight(wx, wy, wz, fluidG, c);
              }
              bucket.positions.push(
                origin[0] + x + c[0],
                origin[1] + y + yOff,
                origin[2] + z + c[2]
              );
              bucket.normals.push(face.normal[0], face.normal[1], face.normal[2]);
              bucket.uvs.push(uvCorners[i][0], uvCorners[i][1]);
              const b = 0.45 + (aos[i] / 3) * 0.55; // 0.45 .. 1.0
              bucket.colors.push(b, b, b);
            }

            // AO-aware triangulation: flip diagonal so both triangles have the worst-AO
            // pair on the shared edge (avoids the "anisotropy" gradient artifact).
            const a00 = aos[0], a10 = aos[1], a01 = aos[2], a11 = aos[3];
            if (a00 + a11 > a10 + a01) {
              bucket.indices.push(
                baseIndex, baseIndex + 1, baseIndex + 2,
                baseIndex + 2, baseIndex + 1, baseIndex + 3
              );
            } else {
              bucket.indices.push(
                baseIndex, baseIndex + 1, baseIndex + 3,
                baseIndex, baseIndex + 3, baseIndex + 2
              );
            }
          }
        }
      }
    }

    this._replaceMesh(opaque, 'opaque');
    this._replaceMesh(trans,  'trans');
    this._replaceMesh(water,  'water');
  }

  _replaceMesh(data, kind) {
    const propMap = { opaque: 'mesh', trans: 'meshTransparent', water: 'meshWater' };
    const matMap  = {
      opaque: this.world.material,
      trans:  this.world.transparentMaterial,
      water:  this.world.waterMaterial,
    };
    const prop = propMap[kind];
    const mat = matMap[kind];

    if (this[prop]) {
      this.world.scene.remove(this[prop]);
      this[prop].geometry.dispose();
      this[prop] = null;
    }
    if (!mat || data.positions.length === 0) return;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geom.setAttribute('normal',   new THREE.Float32BufferAttribute(data.normals, 3));
    geom.setAttribute('uv',       new THREE.Float32BufferAttribute(data.uvs, 2));
    geom.setAttribute('color',    new THREE.Float32BufferAttribute(data.colors, 3));
    geom.setIndex(data.indices);
    geom.computeBoundingSphere();

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `chunk_${this.cx}_${this.cz}_${kind}`;
    mesh.userData.chunk = this;
    if (kind === 'water') mesh.renderOrder = 1; // render after opaque
    this.world.scene.add(mesh);
    this[prop] = mesh;
  }

  dispose() {
    for (const prop of ['mesh', 'meshTransparent', 'meshWater']) {
      if (this[prop]) {
        this.world.scene.remove(this[prop]);
        this[prop].geometry.dispose();
        this[prop] = null;
      }
    }
  }
}
