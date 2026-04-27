import * as THREE from 'three';

// Build a sphere of star points around the player.
export function buildStars(count = 800) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Random direction on unit sphere, only on upper hemisphere.
    let x, y, z;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random();
      z = Math.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < 0.001);
    const len = Math.sqrt(x * x + y * y + z * z);
    const r = 380; // far away
    positions[i * 3 + 0] = (x / len) * r;
    positions[i * 3 + 1] = (y / len) * r;
    positions[i * 3 + 2] = (z / len) * r;
    // Slight variation in star color.
    const tint = 0.85 + Math.random() * 0.15;
    colors[i * 3 + 0] = tint;
    colors[i * 3 + 1] = tint;
    colors[i * 3 + 2] = Math.min(1, tint + Math.random() * 0.1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -1;
  return points;
}

// Build a low-poly cloud layer (a single textured plane with a procedural cloud
// noise alpha texture, scrolling subtly).
export function buildClouds() {
  const tex = makeCloudTexture(256, 256);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipMapLinearFilter;
  tex.generateMipmaps = true;
  tex.repeat.set(2, 2);
  const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;
  return mesh;
}

// Procedural soft cloud noise: layered value noise with bilinear interp.
function makeCloudTexture(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);

  const noise = (seed) => {
    // Build a low-res value noise grid.
    const sizes = [4, 8, 16, 32, 64];
    const grids = sizes.map((sz, i) => {
      const g = new Float32Array(sz * sz);
      let s = (seed * (i + 1) * 1009) >>> 0;
      for (let j = 0; j < g.length; j++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        g[j] = s / 4294967296;
      }
      return { sz, g };
    });
    return (u, v) => {
      let val = 0, amp = 0;
      for (let i = 0; i < grids.length; i++) {
        const { sz, g } = grids[i];
        const x = u * sz;
        const y = v * sz;
        const x0 = Math.floor(x) % sz;
        const y0 = Math.floor(y) % sz;
        const x1 = (x0 + 1) % sz;
        const y1 = (y0 + 1) % sz;
        const fx = x - Math.floor(x);
        const fy = y - Math.floor(y);
        const a = g[y0 * sz + x0];
        const b = g[y0 * sz + x1];
        const c = g[y1 * sz + x0];
        const d = g[y1 * sz + x1];
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const ab = a + (b - a) * sx;
        const cd = c + (d - c) * sx;
        const v0 = ab + (cd - ab) * sy;
        const w = 1 / (i + 1);
        val += v0 * w;
        amp += w;
      }
      return val / amp;
    };
  };

  const n = noise(7);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      let v0 = n(u, v);
      // Sharpen + threshold for cloud-like shapes.
      v0 = Math.pow(Math.max(0, v0 - 0.45) * 2.2, 1.4);
      const alpha = Math.min(1, v0) * 255;
      const i = (y * w + x) * 4;
      img.data[i + 0] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
