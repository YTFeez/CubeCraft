import * as THREE from 'three';
import { getFaceTile, tileUV } from './blocks.js';

const MAX_PARTICLES = 240;
const SIZE = 0.16;

// Lightweight particle system using an InstancedMesh of small textured cubes.
// Each particle is a tiny cube with the broken block's "side" texture, flying
// outwards with gravity. After lifetime, the slot is reused.
export class Particles {
  constructor(scene, atlasTexture) {
    this.scene = scene;
    this.geometry = makeUvCube();
    this.material = new THREE.MeshLambertMaterial({
      map: atlasTexture,
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, MAX_PARTICLES);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);

    // Per-instance UV offset is delivered via instanced attribute.
    const offsets = new Float32Array(MAX_PARTICLES * 2);
    this.uvOffsetAttr = new THREE.InstancedBufferAttribute(offsets, 2);
    this.geometry.setAttribute('uvOffset', this.uvOffsetAttr);

    // Inject UV offset uniform/attribute into the shader.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        '#include <common>\nattribute vec2 uvOffset;\nvarying vec2 vAtlasUv;'
      ).replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
         vAtlasUv = uv * vec2(0.25, 0.3333) + uvOffset;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vAtlasUv;'
      ).replace(
        '#include <map_fragment>',
        `vec4 sampledDiffuseColor = texture2D(map, vAtlasUv);
         if (sampledDiffuseColor.a < 0.4) discard;
         diffuseColor *= sampledDiffuseColor;`
      );
    };

    this.particles = []; // active particle data
    this.dummy = new THREE.Object3D();
  }

  spawnBreak(bx, by, bz, blockId) {
    const tile = getFaceTile(blockId, 'side');
    const [u0, v0] = tileUV(tile); // bottom-left in three.js UV space
    const count = 12;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const p = {
        x: bx + 0.5 + (Math.random() - 0.5) * 0.6,
        y: by + 0.5 + (Math.random() - 0.5) * 0.6,
        z: bz + 0.5 + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 3,
        vz: (Math.random() - 0.5) * 4,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 6,
        life: 0,
        maxLife: 0.7 + Math.random() * 0.4,
        u0, v0,
      };
      this.particles.push(p);
    }
  }

  update(dt) {
    const survivors = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      p.vy -= 18 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      // air drag
      p.vx *= 0.94;
      p.vz *= 0.94;
      survivors.push(p);
    }
    this.particles = survivors;

    const offsets = this.uvOffsetAttr.array;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const t = p.life / p.maxLife;
      const scale = SIZE * (1 - t * 0.5);
      this.dummy.position.set(p.x, p.y, p.z);
      this.dummy.rotation.set(p.rot, p.rot * 0.7, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      offsets[i * 2 + 0] = p.u0;
      offsets[i * 2 + 1] = p.v0;
    }
    this.mesh.count = this.particles.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.uvOffsetAttr.needsUpdate = true;
  }
}

// Build a cube where each face's UV is in [0,1] (we'll remap to atlas tile in the shader).
function makeUvCube() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  // BoxGeometry already has 0..1 UVs per face, perfect.
  return g;
}
