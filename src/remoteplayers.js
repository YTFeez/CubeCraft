import * as THREE from 'three';

// Renders other connected players as a small body + head + floating name.
// Smoothly interpolates incoming position updates.

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map(); // id -> { group, target, current, name, label }
  }

  add(p) {
    if (this.players.has(p.id)) return;
    const group = new THREE.Group();
    const color = new THREE.Color(p.color || '#aaaaaa');

    // body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.0, 0.4),
      new THREE.MeshLambertMaterial({ color }),
    );
    body.position.y = 0.5;
    group.add(body);

    // head
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: color.clone().offsetHSL(0, 0, 0.1) }),
    );
    head.position.y = 1.3;
    group.add(head);

    // tiny "eyes" so we can see facing
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x101010 });
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
    const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
    eyeL.position.set(-0.12, 1.35, -0.26);
    eyeR.position.set( 0.12, 1.35, -0.26);
    group.add(eyeL); group.add(eyeR);

    // floating name label as a sprite
    const label = makeNameSprite(p.name || `Joueur ${p.id}`, p.color);
    label.position.y = 2.0;
    group.add(label);

    this.scene.add(group);

    this.players.set(p.id, {
      group,
      head,
      label,
      target: { x: p.x || 0, y: p.y || 0, z: p.z || 0, yaw: p.yaw || 0, pitch: p.pitch || 0 },
      current: { x: p.x || 0, y: p.y || 0, z: p.z || 0, yaw: p.yaw || 0, pitch: p.pitch || 0 },
      name: p.name,
    });
    group.position.set(p.x || 0, (p.y || 0) - 0.9, p.z || 0); // body offset so feet meet ground
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.group);
    p.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(m => m.dispose());
        else o.material.dispose();
      }
    });
    this.players.delete(id);
  }

  setTarget(id, x, y, z, yaw, pitch) {
    const p = this.players.get(id);
    if (!p) return;
    p.target.x = x; p.target.y = y; p.target.z = z; p.target.yaw = yaw; p.target.pitch = pitch;
  }

  update(dt) {
    const k = Math.min(1, dt * 12);
    for (const p of this.players.values()) {
      p.current.x += (p.target.x - p.current.x) * k;
      p.current.y += (p.target.y - p.current.y) * k;
      p.current.z += (p.target.z - p.current.z) * k;
      // Shortest yaw lerp.
      let dy = p.target.yaw - p.current.yaw;
      while (dy >  Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.current.yaw += dy * k;
      p.current.pitch += (p.target.pitch - p.current.pitch) * k;

      p.group.position.set(p.current.x, p.current.y - 0.9, p.current.z);
      p.group.rotation.y = p.current.yaw + Math.PI; // body faces away from "look" direction
      p.head.rotation.x = -p.current.pitch;
    }
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }
}

function makeNameSprite(name, color = '#ffffff') {
  const c = document.createElement('canvas');
  const padX = 16, padY = 10, fontSize = 28;
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
  const metrics = ctx.measureText(name);
  const w = Math.min(c.width, metrics.width + padX * 2);
  // Re-render with proper width:
  c.width = Math.ceil(w);
  c.height = fontSize + padY * 2;
  ctx.font = `bold ${fontSize}px "Segoe UI", sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, padX, c.height / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  // World units. 0.012 per pixel feels right for floating labels.
  const scale = 0.012;
  sprite.scale.set(c.width * scale, c.height * scale, 1);
  return sprite;
}
