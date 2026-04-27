import * as THREE from 'three';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { BLOCK, isOpaque, isSolid, isFluid, BLOCK_INFO, tileUV, getFaceTile } from './blocks.js';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
export const SEA_LEVEL = 24;

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
    this.rand = rand;
    this.dirty = new Set();
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

  // Apply an edit pushed by the server (silently, without triggering callbacks
  // that would re-broadcast it). Marks chunks dirty so they re-mesh.
  applyRemoteEdit(cx, cz, lx, ly, lz, blockId) {
    const em = this.getChunkEdits(cx, cz, true);
    em.set(`${lx},${ly},${lz}`, blockId | 0);
    const ch = this.getChunk(cx, cz);
    if (ch) {
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
    const { noise2D, noise2Db } = this.world;
    const theme = this.world.theme;
    const origin = [this.cx * CHUNK_SIZE, this.cz * CHUNK_SIZE];
    const heights = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);

    const seaLevel = theme.seaLevel ?? SEA_LEVEL;
    const [a1, a2, a3] = theme.heightAmp;
    const [f1, f2, f3] = theme.heightFreq;
    const offset = theme.heightOffset || 0;
    const surf = theme.surface;
    const fluid = theme.fluid;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = origin[0] + lx;
        const wz = origin[1] + lz;

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
    const tcfg = theme.trees || { density: 0, type: 'none' };
    const treeCount = Math.floor(chRand() * (tcfg.density + 1));
    for (let i = 0; i < treeCount; i++) {
      const tx = Math.floor(chRand() * CHUNK_SIZE);
      const tz = Math.floor(chRand() * CHUNK_SIZE);
      const h = heights[tz * CHUNK_SIZE + tx];
      if (h <= seaLevel + 1) continue;
      if (tx < 2 || tx > CHUNK_SIZE - 3 || tz < 2 || tz > CHUNK_SIZE - 3) continue;
      this._growTree(tcfg.type, tx, h, tz, chRand);
    }

    // Apply persistent user edits last (server-broadcast or local) so they
    // override generated terrain when chunks are re-meshed.
    const edits = this.world.edits.get(this.world.key(this.cx, this.cz));
    if (edits) {
      for (const [pos, id] of edits) {
        const [lx, ly, lz] = pos.split(',').map(Number);
        this.set(lx, ly, lz, id);
      }
    }
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

  buildMesh() {
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
            else if (!isOpaque(id) && !isOpaque(neighbor) && neighbor !== id) showFace = true;
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
            for (let i = 0; i < 4; i++) {
              const c = face.corners[i];
              bucket.positions.push(
                origin[0] + x + c[0],
                origin[1] + y + c[1],
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
