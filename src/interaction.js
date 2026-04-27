import * as THREE from 'three';
import { BLOCK, HOTBAR_BLOCKS, BLOCK_INFO, isSolid, blockIconDataURL } from './blocks.js';

const REACH = 6;

export class Interaction {
  constructor({ camera, world, player, scene, atlasCanvas, audio, onChange, onBreak, onEdit, onSlot, hotbar, initialSlot }) {
    this.camera = camera;
    this.world = world;
    this.player = player;
    this.scene = scene;
    this.audio = audio;
    this.onChange = onChange;
    this.onBreak = onBreak;
    this.onEdit = onEdit;
    this.onSlot = onSlot;
    this.hotbar = hotbar && hotbar.length ? hotbar : HOTBAR_BLOCKS;
    this.selectedIndex = Math.max(0, Math.min(this.hotbar.length - 1, initialSlot | 0));
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = REACH;

    this._buildHotbar(atlasCanvas);
    this._buildHighlight();

    window.addEventListener('wheel', e => this._onWheel(e), { passive: true });
    window.addEventListener('keydown', e => this._onKeyDown(e));
    window.addEventListener('mousedown', e => this._onMouseDown(e));
  }

  _buildHotbar(atlasCanvas) {
    const bar = document.getElementById('hotbar');
    bar.innerHTML = '';
    this.hotbar.forEach((id, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === this.selectedIndex ? ' active' : '');
      slot.dataset.index = i;
      slot.title = BLOCK_INFO[id].name;
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = (i + 1);
      const icon = document.createElement('div');
      icon.className = 'icon';
      icon.style.backgroundImage = `url(${blockIconDataURL(id, atlasCanvas)})`;
      icon.style.backgroundSize = 'cover';
      slot.appendChild(key);
      slot.appendChild(icon);
      slot.addEventListener('click', () => this.select(i));
      bar.appendChild(slot);
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
    const next = (i + this.hotbar.length) % this.hotbar.length;
    if (next === this.selectedIndex) return;
    this.selectedIndex = next;
    const slots = document.querySelectorAll('#hotbar .slot');
    slots.forEach((s, idx) => s.classList.toggle('active', idx === this.selectedIndex));
    if (this.onSlot) this.onSlot(this.selectedIndex);
  }

  selectedBlock() { return this.hotbar[this.selectedIndex]; }

  _onWheel(e) {
    const dir = Math.sign(e.deltaY);
    this.select(this.selectedIndex + dir);
  }

  _onKeyDown(e) {
    if (e.code.startsWith('Digit')) {
      const n = parseInt(e.code.slice(5), 10);
      if (n >= 1 && n <= this.hotbar.length) this.select(n - 1);
    }
  }

  _onMouseDown(e) {
    if (!this.player.locked) return;
    const hit = this._raycast();
    if (!hit) return;

    if (e.button === 0) {
      // Break
      const { x, y, z, id } = hit.block;
      if (id === BLOCK.BEDROCK) return;
      this.world.setBlock(x, y, z, BLOCK.AIR);
      this.audio?.playBreak(id);
      this.onBreak?.(x, y, z, id);
      this.onEdit?.(x, y, z, BLOCK.AIR);
      this.onChange?.();
    } else if (e.button === 2) {
      // Place adjacent
      const nx = hit.block.x + hit.normal.x;
      const ny = hit.block.y + hit.normal.y;
      const nz = hit.block.z + hit.normal.z;
      if (this._blockIntersectsPlayer(nx, ny, nz)) return;
      const id = this.selectedBlock();
      this.world.setBlock(nx, ny, nz, id);
      this.audio?.playPlace(id);
      this.onEdit?.(nx, ny, nz, id);
      this.onChange?.();
    }
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

  // Voxel ray traversal (Amanatides & Woo) from camera.
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
    if (!this.player.locked) {
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
