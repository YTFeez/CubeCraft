import * as THREE from 'three';
import { BLOCK, HOTBAR_BLOCKS, BLOCK_INFO, isSolid, isFluidSource, blockIconDataURL } from './blocks.js';

const REACH = 6;
const HOTBAR_SIZE = 9;
const STACK_MAX = 64;

// Blocks the player cannot pick up when broken (fluids included so we never
// stash a flowing-water block in the inventory).
const NO_DROP = new Set([
  BLOCK.BEDROCK, BLOCK.WATER, BLOCK.LAVA, BLOCK.WATER_FLOW, BLOCK.LAVA_FLOW,
]);

export class Interaction {
  constructor({ camera, world, player, scene, atlasCanvas, audio, onChange, onBreak, onEdit, onSlot, onInventoryChange, hotbar, initialSlot, mode, initialInventory }) {
    this.camera = camera;
    this.world = world;
    this.player = player;
    this.scene = scene;
    this.audio = audio;
    this.atlasCanvas = atlasCanvas;
    this.onChange = onChange;
    this.onBreak = onBreak;
    this.onEdit = onEdit;
    this.onSlot = onSlot;
    this.onInventoryChange = onInventoryChange;
    this.mode = mode === 'survival' ? 'survival' : 'creative';
    this._defaultHotbar = (hotbar && hotbar.length ? hotbar : HOTBAR_BLOCKS).slice(0, HOTBAR_SIZE);

    // Build slots: [{ id, count } | null]
    this.slots = this._buildInitialSlots(initialInventory);
    this.selectedIndex = Math.max(0, Math.min(HOTBAR_SIZE - 1, initialSlot | 0));

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = REACH;

    this._buildHotbarDOM();
    this._buildHighlight();

    window.addEventListener('wheel', e => this._onWheel(e), { passive: true });
    window.addEventListener('keydown', e => this._onKeyDown(e));
    window.addEventListener('mousedown', e => this._onMouseDown(e));
  }

  _buildInitialSlots(saved) {
    const slots = new Array(HOTBAR_SIZE).fill(null);
    if (this.mode === 'creative') {
      this._defaultHotbar.forEach((id, i) => {
        if (i < HOTBAR_SIZE) slots[i] = { id, count: Infinity };
      });
      return slots;
    }
    // Survival: restore from saved snapshot if available.
    if (Array.isArray(saved)) {
      for (let i = 0; i < HOTBAR_SIZE; i++) {
        const s = saved[i];
        if (s && typeof s.id === 'number' && s.id !== BLOCK.AIR && (s.count | 0) > 0) {
          slots[i] = { id: s.id, count: Math.min(STACK_MAX, s.count | 0) };
        }
      }
    }
    return slots;
  }

  exportInventory() {
    return this.slots.map(s => (s ? { id: s.id, count: isFinite(s.count) ? s.count : 0 } : null));
  }

  _buildHotbarDOM() {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = '';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === this.selectedIndex ? ' active' : '');
      slot.dataset.index = i;
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = (i + 1);
      const icon = document.createElement('div');
      icon.className = 'icon';
      const count = document.createElement('div');
      count.className = 'count';
      slot.appendChild(key);
      slot.appendChild(icon);
      slot.appendChild(count);
      slot.addEventListener('click', () => this.select(i));
      bar.appendChild(slot);
    }
    this._refreshHotbarDOM();
  }

  _refreshHotbarDOM() {
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((el, i) => {
      const data = this.slots[i];
      const icon = el.querySelector('.icon');
      const count = el.querySelector('.count');
      el.classList.toggle('active', i === this.selectedIndex);
      el.classList.toggle('empty', !data);
      if (data) {
        icon.style.backgroundImage = `url(${blockIconDataURL(data.id, this.atlasCanvas)})`;
        icon.style.backgroundSize = 'cover';
        el.title = BLOCK_INFO[data.id]?.name || '';
        if (this.mode === 'survival' && isFinite(data.count)) {
          count.textContent = data.count > 1 ? data.count : '';
        } else {
          count.textContent = '';
        }
      } else {
        icon.style.backgroundImage = 'none';
        el.title = '';
        count.textContent = '';
      }
    });
  }

  _buildHighlight() {
    const geo = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.9 });
    this.highlight = new THREE.LineSegments(edges, mat);
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  select(i) {
    const next = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    if (next === this.selectedIndex) return;
    this.selectedIndex = next;
    this._refreshHotbarDOM();
    if (this.onSlot) this.onSlot(this.selectedIndex);
  }

  selectedBlock() {
    const s = this.slots[this.selectedIndex];
    return s && s.count > 0 ? s.id : null;
  }

  // Add `qty` of blockId to inventory; returns true if all units were stored.
  addBlock(id, qty = 1) {
    if (NO_DROP.has(id) || qty <= 0) return false;
    let remaining = qty;
    for (let i = 0; i < HOTBAR_SIZE && remaining > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && isFinite(s.count) && s.count < STACK_MAX) {
        const room = STACK_MAX - s.count;
        const add = Math.min(room, remaining);
        s.count += add;
        remaining -= add;
      }
    }
    for (let i = 0; i < HOTBAR_SIZE && remaining > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(STACK_MAX, remaining);
        this.slots[i] = { id, count: add };
        remaining -= add;
      }
    }
    this._refreshHotbarDOM();
    if (this.onInventoryChange) this.onInventoryChange();
    return remaining === 0;
  }

  _consumeSelected() {
    const s = this.slots[this.selectedIndex];
    if (!s || s.count <= 0) return false;
    if (!isFinite(s.count)) return true; // creative: infinite
    s.count -= 1;
    if (s.count <= 0) this.slots[this.selectedIndex] = null;
    this._refreshHotbarDOM();
    if (this.onInventoryChange) this.onInventoryChange();
    return true;
  }

  setMode(mode, inventory) {
    this.mode = mode === 'survival' ? 'survival' : 'creative';
    this.slots = this._buildInitialSlots(inventory);
    this._refreshHotbarDOM();
  }

  _onWheel(e) {
    const dir = Math.sign(e.deltaY);
    this.select(this.selectedIndex + dir);
  }

  _onKeyDown(e) {
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= HOTBAR_SIZE) this.select(n - 1);
    }
  }

  _onMouseDown(e) {
    if (!this.player.locked) return;
    if (this.player.dead) return;
    const hit = this._raycast();
    if (!hit) return;

    if (e.button === 0) {
      const { x, y, z, id } = hit.block;
      if (id === BLOCK.BEDROCK) return;
      // Fluids are protected: you cannot break them directly. To remove a
      // source, you must seal its 6 neighbours (= "boucher la source"); the
      // flow dries up by itself.
      if (BLOCK_INFO[id]?.fluid) return;
      this.world.setBlock(x, y, z, BLOCK.AIR);
      this.audio?.playBreak(id);
      this.onBreak?.(x, y, z, id);
      this.onEdit?.(x, y, z, BLOCK.AIR);
      this._propagateFluids(x, y, z);
      this.onChange?.();
      if (this.mode === 'survival') this.addBlock(id, 1);
    } else if (e.button === 2) {
      const id = this.selectedBlock();
      if (id == null) return;
      const nx = hit.block.x + hit.normal.x;
      const ny = hit.block.y + hit.normal.y;
      const nz = hit.block.z + hit.normal.z;
      if (this._blockIntersectsPlayer(nx, ny, nz)) return;
      // Cannot place a block where a fluid source already is — the source has
      // to be sealed by surrounding it, not overwritten.
      if (isFluidSource(this.world.getBlock(nx, ny, nz))) return;
      if (!this._consumeSelected()) return;
      this.world.setBlock(nx, ny, nz, id);
      this.audio?.playPlace(id);
      this.onEdit?.(nx, ny, nz, id);
      this._propagateFluids(nx, ny, nz);
      this.onChange?.();
    }
  }

  // Trigger a localised fluid recompute around a block change. The world
  // emits each resulting block update through onChange so we can broadcast
  // them as regular edits — only the originating client runs the simulation.
  _propagateFluids(x, y, z) {
    this.world.recomputeFluidsAround(x, y, z, {
      radius: 6,
      onChange: (cx, cy, cz, nid) => this.onEdit?.(cx, cy, cz, nid),
    });
  }

  _blockIntersectsPlayer(bx, by, bz) {
    const p = this.player.position;
    const halfW = 0.3, height = 1.8;
    const minX = p.x - halfW, maxX = p.x + halfW;
    const minY = p.y - height / 2, maxY = p.y + height / 2;
    const minZ = p.z - halfW, maxZ = p.z + halfW;
    return (bx + 1 > minX && bx < maxX &&
            by + 1 > minY && by < maxY &&
            bz + 1 > minZ && bz < maxZ);
  }

  _raycast() {
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(dir);

    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.y > 0 ? 1 : -1;
    const stepZ = dir.z > 0 ? 1 : -1;

    const tDeltaX = Math.abs(1 / dir.x);
    const tDeltaY = Math.abs(1 / dir.y);
    const tDeltaZ = Math.abs(1 / dir.z);

    const frac = (v, s) => {
      const f = v - Math.floor(v);
      return s > 0 ? (1 - f) : f;
    };
    let tMaxX = tDeltaX * frac(origin.x, stepX);
    let tMaxY = tDeltaY * frac(origin.y, stepY);
    let tMaxZ = tDeltaZ * frac(origin.z, stepZ);

    let nx = 0, ny = 0, nz = 0;
    let traveled = 0;

    while (traveled < REACH) {
      const id = this.world.getBlock(x, y, z);
      if (isSolid(id)) {
        return {
          block: { x, y, z, id },
          normal: { x: nx, y: ny, z: nz },
        };
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          x += stepX; traveled = tMaxX; tMaxX += tDeltaX;
          nx = -stepX; ny = 0; nz = 0;
        } else {
          z += stepZ; traveled = tMaxZ; tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      } else {
        if (tMaxY < tMaxZ) {
          y += stepY; traveled = tMaxY; tMaxY += tDeltaY;
          nx = 0; ny = -stepY; nz = 0;
        } else {
          z += stepZ; traveled = tMaxZ; tMaxZ += tDeltaZ;
          nx = 0; ny = 0; nz = -stepZ;
        }
      }
    }
    return null;
  }

  updateHighlight() {
    if (!this.player.locked || this.player.dead) {
      this.highlight.visible = false;
      return;
    }
    const hit = this._raycast();
    if (hit) {
      this.highlight.visible = true;
      this.highlight.position.set(hit.block.x + 0.5, hit.block.y + 0.5, hit.block.z + 0.5);
    } else {
      this.highlight.visible = false;
    }
  }
}
