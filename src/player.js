import * as THREE from 'three';
import { isSolid, isFluid, fluidGroup, BLOCK } from './blocks.js';
import { WORLD_HEIGHT } from './world.js';

// Player is an AABB centered on the x/z feet position.
const HALF_W = 0.3;   // half-width
const HEIGHT = 1.8;
const EYE = 1.62;
const CROUCH_EYE = 1.32;
const GRAVITY = 28;
const JUMP_SPEED = 9.2;
const WALK_SPEED = 4.6;
const RUN_SPEED = 7.4;
const AIR_CONTROL = 0.35;

export class Player {
  constructor(camera, world, domElement, scene = null) {
    this.camera = camera;
    this.world = world;
    this.dom = domElement;

    this.position = new THREE.Vector3(0, WORLD_HEIGHT, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.onGround = false;
    this.inWater = false;

    this.yaw = 0;
    this.pitch = 0;

    this.keys = new Set();
    this.running = false;
    this.crouching = false;
    this.locked = false;
    this.eyeHeight = EYE;
    this.viewMode = 0; // 0: first person, 1: third back, 2: third front
    this._walkCycle = 0;
    this.autoJump = false;
    this.sprintLock = false;
    this.scene = scene;
    this.avatar = null;

    // --- Survival state ---
    this.surviveMode = false;
    this.maxHealth = 20;
    this.health = 20;
    this.maxAir = 15; // seconds underwater
    this.airTime = 15;
    this.dead = false;
    this._damageImmuneUntil = 0;
    this._lastDamageAt = -Infinity;
    this._peakY = this.position.y;
    this._wasOnGround = false;
    this._lavaDmgAcc = 0;
    this._drownDmgAcc = 0;
    this._regenAcc = 0;
    this.onHealthChange = null;
    this.onAirChange = null;
    this.onDeath = null;
    this.onDamage = null;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._buildAvatar();

    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    document.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  lock() { this.dom.requestPointerLock(); }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  _onPointerLockChange() {
    this.locked = document.pointerLockElement === this.dom;
  }

  _onMouseMove(e) {
    if (!this.locked) return;
    const sensitivity = 0.0025;
    this.yaw   -= e.movementX * sensitivity;
    this.pitch -= e.movementY * sensitivity;
    const lim = Math.PI / 2 - 0.01;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  _onKeyDown(e) {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.running = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.crouching = true;
    if (e.code === 'KeyV') this.viewMode = (this.viewMode + 1) % 3;
  }
  _onKeyUp(e) {
    this.keys.delete(e.code);
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') this.running = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.crouching = false;
  }

  // --- Survival API ---
  setMode(mode) {
    this.surviveMode = mode === 'survival';
    if (!this.surviveMode) {
      this.dead = false;
      this.health = this.maxHealth;
      this.airTime = this.maxAir;
      if (this.onHealthChange) this.onHealthChange(this.health, this.maxHealth);
      if (this.onAirChange) this.onAirChange(this.airTime, this.maxAir);
    }
  }

  takeDamage(amount, cause = '') {
    if (!this.surviveMode || this.dead || amount <= 0) return;
    const now = performance.now() / 1000;
    if (now < this._damageImmuneUntil && cause !== 'lava' && cause !== 'drown') return;
    this.health = Math.max(0, this.health - amount);
    this._lastDamageAt = now;
    this._damageImmuneUntil = now + 0.5;
    this._regenAcc = 0;
    if (this.onDamage) this.onDamage(amount, cause);
    if (this.onHealthChange) this.onHealthChange(this.health, this.maxHealth);
    if (this.health <= 0) {
      this.dead = true;
      this.health = 0;
      if (this.onDeath) this.onDeath(cause);
    }
  }

  heal(amount) {
    if (!this.surviveMode || this.dead || amount <= 0) return;
    const next = Math.min(this.maxHealth, this.health + amount);
    if (next === this.health) return;
    this.health = next;
    if (this.onHealthChange) this.onHealthChange(this.health, this.maxHealth);
  }

  reviveAt(x, y, z) {
    this.dead = false;
    this.health = this.maxHealth;
    this.airTime = this.maxAir;
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this._peakY = y;
    this._wasOnGround = false;
    if (this.onHealthChange) this.onHealthChange(this.health, this.maxHealth);
    if (this.onAirChange) this.onAirChange(this.airTime, this.maxAir);
  }

  respawn() {
    // Search around (0,0) in expanding rings for a column whose surface is dry land.
    const findSurface = (x, z) => {
      for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
        const id = this.world.getBlock(x, y, z);
        if (id !== BLOCK.AIR && !isFluid(id)) {
          return { y, id };
        }
      }
      return null;
    };
    for (let r = 0; r < 32; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const surface = findSurface(dx, dz);
          if (!surface) continue;
          const above = this.world.getBlock(dx, surface.y + 1, dz);
          if (isFluid(above)) continue;
          this.position.set(dx + 0.5, surface.y + 1.01, dz + 0.5);
          this.velocity.set(0, 0, 0);
          return;
        }
      }
    }
    this.position.set(0.5, WORLD_HEIGHT - 5, 0.5);
  }

  update(dt) {
    // If dead, freeze input but keep camera responsive.
    if (this.dead) {
      this.velocity.set(0, 0, 0);
      this._updateViewAndAvatar(dt);
      return;
    }

    // Build movement input in local frame (Z=forward, X=right).
    let inputX = 0, inputZ = 0;
    // AZERTY: Z=forward, S=back, Q=left, D=right. Also support WASD.
    if (this.keys.has('KeyZ') || this.keys.has('KeyW') || this.keys.has('ArrowUp')) inputZ -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))                         inputZ += 1;
    if (this.keys.has('KeyQ') || this.keys.has('KeyA') || this.keys.has('ArrowLeft'))inputX -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight'))                        inputX += 1;

    const len = Math.hypot(inputX, inputZ);
    if (len > 0) { inputX /= len; inputZ /= len; }

    // Detect water around the player (eye-level check for "in water").
    this.inWater = this._isInWater();

    let speedMult = 1;
    if (this.inWater) speedMult = 0.55;
    if (this.crouching) speedMult *= 0.45;
    const sprinting = this.running || this.sprintLock;
    const speed = (sprinting ? RUN_SPEED : WALK_SPEED) * speedMult;

    // Convert local -> world using yaw.
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    // forward local (-Z) in world: (sinY, 0, -cosY)... with yaw positive CCW around Y.
    // We want: pressing forward (inputZ = -1) moves along camera forward direction.
    const forwardX = -sinY;
    const forwardZ = -cosY;
    const rightX   =  cosY;
    const rightZ   = -sinY;

    const wantVX = (rightX * inputX + forwardX * -inputZ) * speed;
    const wantVZ = (rightZ * inputX + forwardZ * -inputZ) * speed;

    // Apply horizontal velocity with blending depending on ground state.
    const blend = this.onGround ? 1 : AIR_CONTROL;
    this.velocity.x += (wantVX - this.velocity.x) * blend;
    this.velocity.z += (wantVZ - this.velocity.z) * blend;

    // Apply horizontal damping if no input and grounded.
    if (len === 0 && this.onGround) {
      const damp = Math.pow(0.0005, dt); // strong friction
      this.velocity.x *= damp;
      this.velocity.z *= damp;
    }

    // Gravity and jump (water gives buoyancy + ability to swim up).
    if (this.inWater) {
      const headFluid = isFluid(this._blockAtEye());
      const feetFluid = isFluid(this._blockAtFeet());
      // Buoyancy: dampened gravity, hold space to swim up.
      const grav = GRAVITY * 0.18;
      this.velocity.y -= grav * dt;
      if (this.keys.has('Space')) {
        // Continuous swim-up acceleration while space is held.
        this.velocity.y += GRAVITY * 0.75 * dt;
        // Near the surface, give an extra pop so holding space exits water.
        if (!headFluid && feetFluid) this.velocity.y = Math.max(this.velocity.y, JUMP_SPEED * 0.98);
        if (this.onGround) this.velocity.y = Math.max(this.velocity.y, JUMP_SPEED * 0.95);
        if (this.velocity.y > 7.2) this.velocity.y = 7.2;
      }
      // Strong drag in water so you don't sink/rise too fast.
      const yDrag = this.keys.has('Space') ? 0.32 : 0.05;
      this.velocity.y *= Math.pow(yDrag, dt);
      if (this.velocity.y < -3.5) this.velocity.y = -3.5;
    } else {
      if (this.keys.has('Space') && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -60) this.velocity.y = -60;
    }

    // Integrate + collide.
    this.onGround = false;
    this._moveAxis(this.velocity.x * dt, 0, 0);
    this._moveAxis(0, this.velocity.y * dt, 0);
    this._moveAxis(0, 0, this.velocity.z * dt);

    // Basic Minecraft-like auto jump.
    if (this.autoJump && !this.inWater && this.onGround && len > 0.2 && !this.crouching) {
      const ahead = 0.38;
      const tx = this.position.x + forwardX * ahead;
      const tz = this.position.z + forwardZ * ahead;
      const feetY = Math.floor(this.position.y - HEIGHT / 2 + 0.02);
      const blockAhead = this.world.getBlock(Math.floor(tx), feetY, Math.floor(tz));
      const headAhead = this.world.getBlock(Math.floor(tx), feetY + 1, Math.floor(tz));
      if (isSolid(blockAhead) && !isFluid(blockAhead) && headAhead === BLOCK.AIR) {
        this.velocity.y = Math.max(this.velocity.y, JUMP_SPEED * 0.82);
        this.onGround = false;
      }
    }

    // Fell out of world.
    if (this.position.y < -20) {
      if (this.surviveMode) this.takeDamage(this.maxHealth, 'void');
      else this.respawn();
    }

    // --- Survival ticks ---
    if (this.surviveMode && !this.dead) this._tickSurvival(dt);

    this._updateViewAndAvatar(dt);
  }

  _updateViewAndAvatar(dt) {
    const tEye = this.crouching ? CROUCH_EYE : EYE;
    const k = Math.min(1, dt * 12);
    this.eyeHeight += (tEye - this.eyeHeight) * k;

    const headX = this.position.x;
    const headY = this.position.y + this.eyeHeight - HEIGHT / 2;
    const headZ = this.position.z;

    this.camera.rotation.set(0, 0, 0);
    if (this.viewMode === 2) {
      this.camera.rotateY(this.yaw + Math.PI);
      this.camera.rotateX(-this.pitch * 0.35);
    } else {
      this.camera.rotateY(this.yaw);
      this.camera.rotateX(this.pitch);
    }

    if (this.viewMode === 0) {
      this.camera.position.set(headX, headY, headZ);
    } else {
      const dist = this.viewMode === 1 ? 3.3 : -2.4;
      const up = this.crouching ? 0.55 : 0.8;
      const sinY = Math.sin(this.yaw);
      const fx = -sinY;
      const fz = -Math.cos(this.yaw);
      const camX = headX - fx * dist;
      const camY = headY + up;
      const camZ = headZ - fz * dist;
      this.camera.position.set(camX, camY, camZ);
    }

    if (!this.avatar) return;
    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    this._walkCycle += planar * dt * 5.6;
    const swing = Math.sin(this._walkCycle) * Math.min(0.75, planar * 0.2);
    const crouchDrop = this.crouching ? 0.22 : 0;

    this.avatar.group.visible = this.viewMode !== 0;
    this.avatar.group.position.set(this.position.x, this.position.y - HEIGHT / 2, this.position.z);
    this.avatar.group.rotation.y = this.yaw + Math.PI;
    this.avatar.body.position.y = 0.9 - crouchDrop;
    this.avatar.head.position.y = 1.55 - crouchDrop * 0.4;
    this.avatar.armL.position.y = 1.04 - crouchDrop;
    this.avatar.armR.position.y = 1.04 - crouchDrop;
    this.avatar.legL.position.y = 0.34;
    this.avatar.legR.position.y = 0.34;
    this.avatar.armL.rotation.x = swing;
    this.avatar.armR.rotation.x = -swing;
    this.avatar.legL.rotation.x = -swing;
    this.avatar.legR.rotation.x = swing;
  }

  _buildAvatar() {
    if (!this.scene) return;
    const group = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x6ec6ff });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2f6f88 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xe3b28f });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.72, 0.3), mat);
    body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), skin);
    head.position.y = 1.55;
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.18), dark);
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.18), dark);
    armL.position.set(-0.38, 1.04, 0);
    armR.position.set(0.38, 1.04, 0);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.2), dark);
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.2), dark);
    legL.position.set(-0.14, 0.34, 0);
    legR.position.set(0.14, 0.34, 0);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), eyeMat);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), eyeMat);
    eyeL.position.set(-0.09, 1.58, -0.22);
    eyeR.position.set(0.09, 1.58, -0.22);

    group.add(body, head, armL, armR, legL, legR, eyeL, eyeR);
    this.scene.add(group);
    this.avatar = { group, body, head, armL, armR, legL, legR };
  }

  _moveAxis(dx, dy, dz) {
    const nx = this.position.x + dx;
    const ny = this.position.y + dy;
    const nz = this.position.z + dz;

    if (!this._collides(nx, this.position.y, this.position.z) && dx !== 0) {
      this.position.x = nx;
    } else if (dx !== 0) {
      this.velocity.x = 0;
    }

    if (!this._collides(this.position.x, ny, this.position.z) && dy !== 0) {
      this.position.y = ny;
    } else if (dy !== 0) {
      if (dy < 0) this.onGround = true;
      this.velocity.y = 0;
    }

    if (!this._collides(this.position.x, this.position.y, nz) && dz !== 0) {
      this.position.z = nz;
    } else if (dz !== 0) {
      this.velocity.z = 0;
    }
  }

  // Check AABB vs solid voxels. Position is the center-bottom-ish:
  // player occupies [x-HALF_W, x+HALF_W] x [y-HEIGHT/2, y+HEIGHT/2] x [z-HALF_W, z+HALF_W].
  _collides(x, y, z) {
    const minX = Math.floor(x - HALF_W);
    const maxX = Math.floor(x + HALF_W);
    const minY = Math.floor(y - HEIGHT / 2);
    const maxY = Math.floor(y + HEIGHT / 2 - 0.001);
    const minZ = Math.floor(z - HALF_W);
    const maxZ = Math.floor(z + HALF_W);
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          const id = this.world.getBlock(bx, by, bz);
          if (isSolid(id)) {
            // Leaves and fluids (water, lava) are passable so you can walk through tree canopies and swim.
            if (id === BLOCK.LEAVES || isFluid(id)) continue;
            return true;
          }
        }
      }
    }
    return false;
  }

  _tickSurvival(dt) {
    // Fall damage: track peak Y while airborne; on landing, hurt.
    if (this.onGround) {
      if (!this._wasOnGround) {
        const fall = this._peakY - this.position.y;
        if (fall > 3.5) {
          const dmg = Math.floor(fall - 3);
          if (dmg > 0) this.takeDamage(dmg, 'fall');
        }
      }
      this._peakY = this.position.y;
    } else {
      if (this.position.y > this._peakY) this._peakY = this.position.y;
    }
    this._wasOnGround = this.onGround;

    // Lava damage: head OR feet in lava -> 2 dmg every 0.5s (4/s).
    const headBlock = this._blockAtEye();
    const feetBlock = this._blockAtFeet();
    const inLava = fluidGroup(headBlock) === 'lava' || fluidGroup(feetBlock) === 'lava';
    if (inLava) {
      this._lavaDmgAcc += dt;
      if (this._lavaDmgAcc >= 0.5) {
        this._lavaDmgAcc -= 0.5;
        this.takeDamage(2, 'lava');
      }
    } else {
      this._lavaDmgAcc = 0;
    }

    // Drowning: head in water -> deplete air, then 2 dmg/sec.
    if (fluidGroup(headBlock) === 'water') {
      this.airTime = Math.max(0, this.airTime - dt);
      if (this.airTime <= 0) {
        this._drownDmgAcc += dt;
        if (this._drownDmgAcc >= 1) {
          this._drownDmgAcc -= 1;
          this.takeDamage(2, 'drown');
        }
      }
      if (this.onAirChange) this.onAirChange(this.airTime, this.maxAir);
    } else {
      this._drownDmgAcc = 0;
      if (this.airTime < this.maxAir) {
        this.airTime = Math.min(this.maxAir, this.airTime + dt * 8);
        if (this.onAirChange) this.onAirChange(this.airTime, this.maxAir);
      }
    }

    // Passive regen: no damage for 4s -> +1 HP every 1.5s.
    const now = performance.now() / 1000;
    if (this.health < this.maxHealth && now - this._lastDamageAt > 4) {
      this._regenAcc += dt;
      if (this._regenAcc >= 1.5) {
        this._regenAcc -= 1.5;
        this.heal(1);
      }
    }
  }

  _blockAtEye() {
    const eyeY = this.position.y + EYE - HEIGHT / 2;
    return this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(eyeY),
      Math.floor(this.position.z),
    );
  }

  _blockAtFeet() {
    return this.world.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y - HEIGHT / 2 + 0.05),
      Math.floor(this.position.z),
    );
  }

  _isInWater() {
    // Treat any fluid (water, lava) as "swimming". Sample at body center + feet.
    const yMid = this.position.y;
    const yFeet = this.position.y - 0.7;
    const x = Math.floor(this.position.x);
    const z = Math.floor(this.position.z);
    const id1 = this.world.getBlock(x, Math.floor(yMid), z);
    const id2 = this.world.getBlock(x, Math.floor(yFeet), z);
    return isFluid(id1) || isFluid(id2);
  }

  destroy() {
    if (this.avatar?.group) {
      this.scene?.remove(this.avatar.group);
      this.avatar.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
          else o.material.dispose();
        }
      });
      this.avatar = null;
    }
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  setPreferences({ autoJump = this.autoJump, sprintLock = this.sprintLock } = {}) {
    this.autoJump = !!autoJump;
    this.sprintLock = !!sprintLock;
  }
}
