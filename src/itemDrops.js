import * as THREE from 'three';
import { blockIconDataURL } from './blocks.js';

// Item drops are small spinning cubes representing a single block. They obey
// gravity locally on the client (cheap, deterministic enough for a few of
// them at a time) and are spawned/despawned by the server so that everyone in
// the room sees the same drops.
//
// Lifecycle:
//   server "itemSpawn"  -> add(id, x, y, z, vx, vy, vz, blockId, ownerId)
//   local update()      -> integrates physics, lets the local player pick up
//                          when close enough (~1.4m). Pickup sends a "pickup"
//                          message; the server confirms with "itemDespawn".
//   server "itemDespawn"-> remove(id)
//
// The owner of a freshly-dropped item cannot pick it up for the first 0.6s,
// so dropping it doesn't immediately re-stuff the inventory.

const PICKUP_RANGE_SQ = 1.4 * 1.4;
const OWNER_GRACE_S = 0.6;
const ITEM_LIFETIME_S = 300; // 5 minutes; the server enforces too
const GRAVITY = 18;
const DRAG = 1.5;
const SPIN_RATE = 1.2;

const iconMaterialCache = new Map();

function getIconMaterial(blockId, atlasCanvas) {
  const cached = iconMaterialCache.get(blockId);
  if (cached) return cached;
  const url = blockIconDataURL(blockId, atlasCanvas);
  const img = new Image();
  img.src = url;
  const tex = new THREE.Texture(img);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  img.onload = () => { tex.needsUpdate = true; };
  const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true });
  iconMaterialCache.set(blockId, mat);
  return mat;
}

export class ItemDrops {
  constructor(scene, atlasCanvas) {
    this.scene = scene;
    this.atlasCanvas = atlasCanvas;
    this.drops = new Map(); // dropId -> { mesh, x,y,z, vx,vy,vz, blockId, ownerId, spawnedAt, alive }
    this._geom = new THREE.BoxGeometry(0.32, 0.32, 0.32);
  }

  add({ dropId, x, y, z, vx = 0, vy = 0, vz = 0, blockId, ownerId, t = 0 }) {
    if (this.drops.has(dropId)) return;
    const mat = getIconMaterial(blockId, this.atlasCanvas);
    const mesh = new THREE.Mesh(this._geom, mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.set(dropId, {
      dropId, mesh,
      x, y, z, vx, vy, vz,
      blockId, ownerId,
      age: t,
      alive: true,
    });
  }

  remove(dropId) {
    const d = this.drops.get(dropId);
    if (!d) return;
    this.scene.remove(d.mesh);
    this.drops.delete(dropId);
  }

  clear() {
    for (const d of this.drops.values()) this.scene.remove(d.mesh);
    this.drops.clear();
  }

  // Returns dropIds that the local player picked up this frame (as decided
  // optimistically by proximity). The caller is responsible for sending a
  // "pickup" message to the server so it can validate and broadcast despawn.
  update(dt, world, localPlayer, localPlayerId, onPickupRequest) {
    const picked = [];
    for (const d of this.drops.values()) {
      d.age += dt;

      // Physics: gravity, drag, simple ground-snap when a solid block sits
      // immediately below.
      d.vy -= GRAVITY * dt;
      const dragK = Math.exp(-DRAG * dt);
      d.vx *= dragK;
      d.vz *= dragK;

      let nx = d.x + d.vx * dt;
      let ny = d.y + d.vy * dt;
      let nz = d.z + d.vz * dt;

      // Ground collision (use voxel below).
      const groundId = world.getBlock(Math.floor(nx), Math.floor(ny - 0.16), Math.floor(nz));
      if (groundId !== 0 && d.vy < 0) {
        ny = Math.floor(ny - 0.16) + 1 + 0.16;
        d.vy = 0;
      }

      // Side collisions (super cheap: don't enter solid blocks).
      const sideX = world.getBlock(Math.floor(nx + Math.sign(d.vx) * 0.16), Math.floor(d.y), Math.floor(d.z));
      if (sideX !== 0) { nx = d.x; d.vx *= -0.3; }
      const sideZ = world.getBlock(Math.floor(d.x), Math.floor(d.y), Math.floor(nz + Math.sign(d.vz) * 0.16));
      if (sideZ !== 0) { nz = d.z; d.vz *= -0.3; }

      d.x = nx; d.y = ny; d.z = nz;
      d.mesh.position.set(d.x, d.y + 0.18 + Math.sin(d.age * 2) * 0.04, d.z);
      d.mesh.rotation.y += SPIN_RATE * dt;

      // Pickup: only the local player attempts; the server is authoritative.
      if (d.alive && onPickupRequest) {
        const dx = d.x - localPlayer.position.x;
        const dy = d.y - localPlayer.position.y;
        const dz = d.z - localPlayer.position.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        const ownerOk = d.ownerId !== localPlayerId || d.age >= OWNER_GRACE_S;
        if (ownerOk && distSq < PICKUP_RANGE_SQ) {
          d.alive = false; // optimistic: hide locally
          d.mesh.visible = false;
          picked.push({ dropId: d.dropId, blockId: d.blockId });
          onPickupRequest(d.dropId);
        }
      }

      // Local lifetime fade-out (server should match).
      if (d.age > ITEM_LIFETIME_S) this.remove(d.dropId);
    }
    return picked;
  }
}
