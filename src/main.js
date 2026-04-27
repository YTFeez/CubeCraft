import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildAtlas } from './blocks.js';
import { World, CHUNK_SIZE } from './world.js';
import { Player } from './player.js';
import { Interaction } from './interaction.js';
import { Audio } from './audio.js';
import { Particles } from './particles.js';
import { buildClouds, buildStars } from './sky.js';
import { Network } from './network.js';
import { RemotePlayers } from './remoteplayers.js';
import { THEMES, themeById } from './themes.js';

const VIEW_RADIUS = 5;
const DAY_LENGTH = 240;

// =========================================================================
// DOM REFS
// =========================================================================
const canvas       = document.getElementById('game');
const authEl       = document.getElementById('auth');
const authForm     = document.getElementById('auth-form');
const authNameInp  = document.getElementById('auth-name');
const authPwInp    = document.getElementById('auth-password');
const authSubmit   = document.getElementById('auth-submit');
const authError    = document.getElementById('auth-error');
const authTabs     = document.querySelectorAll('.auth-tab');
const selectionEl  = document.getElementById('selection');
const worldsEl     = document.getElementById('worlds');
const meNameEl     = document.getElementById('me-name');
const logoutBtn    = document.getElementById('logout-btn');
const menu         = document.getElementById('menu');
const menuSubtitle = document.getElementById('menu-subtitle');
const loading      = document.getElementById('loading');
const progressBar  = document.getElementById('progress-bar');
const playBtn      = document.getElementById('play-btn');
const leaveBtn     = document.getElementById('leave-btn');
const clockEl      = document.getElementById('clock');
const coordsEl     = document.getElementById('coords');
const fpsEl        = document.getElementById('fps');
const serverInfoEl = document.getElementById('server-info');
const playersPanel = document.getElementById('players-panel');
const playersList  = document.getElementById('players-list');
const chatLog      = document.getElementById('chat-log');
const chatInput    = document.getElementById('chat-input');

// =========================================================================
// SELECTION SCREEN (rendered first so it's always visible)
// =========================================================================
function renderWorldCards(stats = {}) {
  worldsEl.innerHTML = '';
  for (const theme of Object.values(THEMES)) {
    const s = stats[theme.id] || { players: 0, editCount: 0 };
    const card = document.createElement('div');
    card.className = 'world-card';
    card.style.setProperty('--c1', theme.color);
    card.style.setProperty('--c2', theme.accent);
    card.innerHTML = `
      <div class="world-bg"></div>
      <h3>${theme.name}</h3>
      <div class="tagline">${theme.tagline}</div>
      <div class="stats">
        <span class="badge">${s.players} en ligne</span>
        <span class="badge">${s.editCount} blocs</span>
      </div>
    `;
    card.addEventListener('click', () => joinWorld(theme.id));
    worldsEl.appendChild(card);
  }
}

async function refreshStats() {
  try {
    const r = await fetch('/api/rooms');
    const data = await r.json();
    const map = {};
    for (const room of data.rooms) map[room.id] = room;
    renderWorldCards(map);
  } catch {
    renderWorldCards();
  }
}

// =========================================================================
// AUTH (login / register before world selection)
// =========================================================================
const AUTH_KEY = 'cubecraft-auth';
let auth = null; // { name, token }

function loadStoredAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveAuth(a) { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); }
function clearAuth() { localStorage.removeItem(AUTH_KEY); }

let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  authTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === mode));
  authSubmit.textContent = mode === 'login' ? 'Se connecter' : 'Créer le compte';
  authPwInp.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  authError.textContent = '';
}
authTabs.forEach(tab => tab.addEventListener('click', () => setAuthMode(tab.dataset.tab)));

async function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data: data || {} };
}

async function getMe(token) {
  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authError.textContent = '';
  authSubmit.disabled = true;
  const name = authNameInp.value.trim();
  const password = authPwInp.value;
  const url = authMode === 'login' ? '/api/login' : '/api/register';
  const r = await postJson(url, { name, password });
  authSubmit.disabled = false;
  if (!r.ok) {
    authError.textContent = r.data.error || 'Erreur';
    return;
  }
  auth = { name: r.data.name, token: r.data.token };
  saveAuth(auth);
  showSelectionScreen();
});

function showAuthScreen() {
  selectionEl.classList.add('hidden');
  authEl.classList.remove('hidden');
  authPwInp.value = '';
  setAuthMode('login');
  // Focus the name field for fast re-entry.
  setTimeout(() => authNameInp.focus(), 50);
}

function showSelectionScreen() {
  authEl.classList.add('hidden');
  selectionEl.classList.remove('hidden');
  meNameEl.textContent = auth?.name || '?';
  renderWorldCards();
  refreshStats();
}

logoutBtn.addEventListener('click', async () => {
  if (auth?.token) await postJson('/api/logout', {}, auth.token).catch(() => {});
  clearAuth();
  auth = null;
  showAuthScreen();
});

// Bootstrap: try existing token, otherwise show login.
(async () => {
  const stored = loadStoredAuth();
  if (stored?.token) {
    const me = await getMe(stored.token);
    if (me?.name) {
      auth = { name: me.name, token: stored.token };
      showSelectionScreen();
      return;
    }
    clearAuth();
  }
  showAuthScreen();
})();

setInterval(() => { if (!session && auth) refreshStats(); }, 5000);

// =========================================================================
// RENDERER + ATLAS (built lazily so the selection screen never blocks)
// =========================================================================
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 800);
const baseFov = 75;

const { canvas: atlasCanvas, texture: atlasTex } = buildAtlas();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =========================================================================
// SESSION (created once a player chooses a world)
// =========================================================================
let session = null; // { theme, world, player, interaction, audio, particles, network, remotePlayers, knownPlayers, sky, skyU, sun, hemi, ambient, stars, clouds, opaqueMat, transparentMat, waterMat, waterTime, timeOfDay, scene, leader, ... }
let pendingChunkPos = null;

async function joinWorld(themeId) {
  if (!auth?.token) { showAuthScreen(); return; }
  const theme = themeById(themeId);
  const name = auth.name;

  selectionEl.classList.add('hidden');
  loading.classList.remove('hidden');
  progressBar.style.width = '5%';

  session = await createSession(theme, name).catch(err => {
    console.error(err);
    if (err && err.message === 'AUTH') {
      clearAuth();
      auth = null;
      loading.classList.add('hidden');
      showAuthScreen();
      return null;
    }
    alert('Connexion au serveur impossible. Le serveur Node tourne-t-il bien ?');
    selectionEl.classList.remove('hidden');
    loading.classList.add('hidden');
    return null;
  });
  if (!session) return;

  // Initial chunk generation around spawn.
  await initialGenerate(session);

  // Show in-game menu (paused) so user clicks "Jouer" once textures and chunks are ready.
  loading.classList.add('hidden');
  menu.classList.remove('hidden');
  menuSubtitle.textContent = `Connecté au monde "${theme.name}" en tant que ${name}`;

  if (!animating) { animating = true; animate(); }
}

async function createSession(theme, name) {
  // === Scene + atmosphere ===
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(theme.fog.day, CHUNK_SIZE * (VIEW_RADIUS - 1), CHUNK_SIZE * (VIEW_RADIUS + 1));

  const sky = new Sky();
  sky.scale.setScalar(450);
  scene.add(sky);
  const skyU = sky.material.uniforms;
  skyU.turbidity.value = theme.sky.turbidity;
  skyU.rayleigh.value = theme.sky.rayleigh;
  skyU.mieCoefficient.value = 0.004;
  skyU.mieDirectionalG.value = theme.sky.mieG;

  const stars = buildStars(800);
  scene.add(stars);
  const clouds = buildClouds();
  scene.add(clouds);

  const hemi = new THREE.HemisphereLight(theme.light.hemiTop, theme.light.hemiBottom, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  scene.add(sun);
  const ambient = new THREE.AmbientLight(theme.light.ambient, 0.25);
  scene.add(ambient);

  // === Materials ===
  const opaqueMat = new THREE.MeshLambertMaterial({
    map: atlasTex, side: THREE.DoubleSide, vertexColors: true,
  });
  const transparentMat = new THREE.MeshLambertMaterial({
    map: atlasTex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.4, vertexColors: true,
  });
  const waterMat = new THREE.MeshLambertMaterial({
    map: atlasTex, side: THREE.DoubleSide, transparent: true, opacity: 0.8,
    depthWrite: false, vertexColors: true,
  });
  let waterTime = 0;
  waterMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPos;'
    ).replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uTime;\nvarying vec3 vWorldPos;'
    ).replace(
      '#include <map_fragment>',
      `
        vec2 wobble = vec2(
          sin(uTime * 1.4 + vWorldPos.x * 0.6 + vWorldPos.z * 0.4),
          cos(uTime * 1.1 + vWorldPos.z * 0.6 - vWorldPos.x * 0.3)
        ) * (0.5 / 64.0);
        vec4 sampledDiffuseColor = texture2D(map, vMapUv + wobble);
        diffuseColor *= sampledDiffuseColor;
      `
    );
    waterMat.userData.shader = shader;
  };

  // === World + entities ===
  const world = new World(theme, scene, opaqueMat, transparentMat, waterMat);
  const audio = new Audio();
  const player = new Player(camera, world, canvas);
  const particles = new Particles(scene, atlasTex);
  const remotePlayers = new RemotePlayers(scene);

  // === Networking ===
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  const knownPlayers = new Map(); // id -> { name, color }

  const handlers = {
    playerJoin: (m) => {
      knownPlayers.set(m.player.id, { name: m.player.name, color: m.player.color });
      remotePlayers.add(m.player);
      addChatLine('-', `${m.player.name} a rejoint`, m.player.color);
      refreshPlayersList();
    },
    playerLeave: (m) => {
      const p = knownPlayers.get(m.id);
      if (p) addChatLine('-', `${p.name} est parti`, p.color);
      knownPlayers.delete(m.id);
      remotePlayers.remove(m.id);
      refreshPlayersList();
    },
    pos: (m) => remotePlayers.setTarget(m.id, m.x, m.y, m.z, m.yaw, m.pitch),
    edit: (m) => {
      // Own edits come back too: skip applying them again (we already did optimistically).
      if (m.by === network.you?.id) return;
      world.applyRemoteEdit(m.cx, m.cz, m.lx, m.ly, m.lz, m.blockId);
    },
    timeSync: (m) => {
      if (!session.leader && typeof m.t === 'number') session.timeOfDay = m.t;
    },
    chat: (m) => addChatLine(m.from, m.text, m.color),
    error: (m) => {
      if (m.code === 'AUTH') {
        clearAuth();
        auth = null;
        leaveSession();
        showAuthScreen();
        return;
      }
      alert(m.message || 'Erreur serveur');
    },
    disconnected: () => {
      if (!session) return;
      alert('Déconnecté du serveur.');
      leaveSession();
    },
  };

  const network = new Network({ url: wsUrl, roomId: theme.id, name, token: auth.token, handlers });
  const welcome = await network.connect();

  // The room owner (first player) is the time-of-day leader.
  let leader = welcome.players.length === 0;

  // Apply initial world state from the server.
  world.applyServerEdits(welcome.edits || {});
  for (const p of welcome.players) {
    knownPlayers.set(p.id, { name: p.name, color: p.color });
    remotePlayers.add(p);
  }
  knownPlayers.set(network.you.id, { name: network.you.name, color: network.you.color, self: true });
  refreshPlayersList();

  serverInfoEl.textContent = `${theme.name} · pseudo: ${name}`;
  playersPanel.classList.add('visible');

  function refreshPlayersList() {
    playersList.innerHTML = '';
    const entries = Array.from(knownPlayers.entries()).sort((a, b) => a[0] - b[0]);
    for (const [id, p] of entries) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color;
      const span = document.createElement('span');
      span.textContent = p.name + (p.self ? ' (toi)' : '');
      li.appendChild(dot);
      li.appendChild(span);
      playersList.appendChild(li);
    }
  }

  // === Interaction / hotbar (per-theme blocks) ===
  const initialSlot = welcome.spawn?.slot | 0;
  const interaction = new Interaction({
    camera, world, player, scene, atlasCanvas, audio,
    hotbar: theme.hotbar,
    initialSlot,
    onBreak: (x, y, z, id) => particles.spawnBreak(x, y, z, id),
    onEdit: (x, y, z, id) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const lx = x - cx * CHUNK_SIZE;
      const lz = z - cz * CHUNK_SIZE;
      network.sendEdit(cx, cz, lx, y, lz, id);
    },
    onSlot: (slot) => network.sendSlot(slot),
  });

  const session = {
    theme, scene, world, player, audio, particles, interaction,
    sky, skyU, sun, hemi, ambient, stars, clouds,
    opaqueMat, transparentMat, waterMat, waterTime,
    network, remotePlayers, knownPlayers,
    leader, timeOfDay: welcome.timeOfDay ?? 0.3,
    spawn: welcome.spawn || null,
    refreshPlayersList,
    bobPhase: 0, currentFov: baseFov,
  };

  // Promote ourselves to leader if everyone else leaves.
  const originalLeave = handlers.playerLeave;
  network.handlers.playerLeave = (m) => {
    originalLeave(m);
    if (knownPlayers.size <= 1) session.leader = true;
  };

  return session;
}

async function initialGenerate(s) {
  const { world, player } = s;
  const total = (VIEW_RADIUS * 2 + 1) ** 2;
  let done = 0;

  // If we have a saved spawn, seed the player's position now so chunks are
  // generated around it (otherwise we generate around 0,0).
  if (s.spawn) {
    player.position.set(s.spawn.x, s.spawn.y, s.spawn.z);
    player.yaw = s.spawn.yaw || 0;
    player.pitch = s.spawn.pitch || 0;
    player.velocity.set(0, 0, 0);
  }

  const [cx, cz] = world.worldToChunk(player.position.x, player.position.z);
  const rings = [];
  for (let r = 0; r <= VIEW_RADIUS; r++) {
    const ring = [];
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        ring.push([dx, dz]);
      }
    }
    rings.push(ring);
  }

  for (const ring of rings) {
    for (const [dx, dz] of ring) {
      const ch = world.ensureChunk(cx + dx, cz + dz);
      world.dirty.add(ch);
      done++;
    }
    progressBar.style.width = `${(done / total) * 100}%`;
    await new Promise(r => setTimeout(r, 0));
  }

  for (const ch of world.chunks.values()) world.dirty.add(ch);
  while (world.dirty.size > 0) {
    world.flushDirty(8);
    await new Promise(r => setTimeout(r, 0));
  }

  if (s.spawn) {
    // If the saved spot ended up inside a solid block (world edits since last
    // logout), fall back to a fresh respawn.
    const id = s.world.getBlock(Math.floor(s.spawn.x), Math.floor(s.spawn.y), Math.floor(s.spawn.z));
    if (id !== 0) player.respawn();
  } else {
    player.respawn();
  }
  s.network.sendPos(player.position.x, player.position.y, player.position.z, player.yaw, player.pitch);
}

function leaveSession() {
  if (!session) return;
  try { session.network.disconnect(); } catch {}
  try { session.player.destroy?.(); } catch {}

  session.remotePlayers.clear();
  session.scene.traverse(obj => {
    if (obj.isMesh || obj.isLineSegments || obj.isPoints) {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m && m.dispose());
        else obj.material.dispose();
      }
    }
  });
  session = null;

  playersPanel.classList.remove('visible');
  serverInfoEl.textContent = '';
  document.getElementById('hotbar').innerHTML = '';
  menu.classList.add('hidden');
  loading.classList.add('hidden');
  if (auth) {
    selectionEl.classList.remove('hidden');
    refreshStats();
  } else {
    showAuthScreen();
  }
}

// =========================================================================
// ATMOSPHERE
// =========================================================================
const sunSph = new THREE.Vector3();
const sunDir = new THREE.Vector3();

function updateAtmosphere(s, t) {
  const theme = s.theme;
  const angle = (t - 0.25) * Math.PI * 2;
  const elevationDeg = Math.sin(angle) * 90;
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(180);
  sunSph.setFromSphericalCoords(1, phi, theta);
  sunDir.copy(sunSph);

  s.skyU.sunPosition.value.copy(sunSph);

  const elevNorm = Math.sin(angle);
  const daylight = THREE.MathUtils.clamp(elevNorm * 1.4 + 0.1, 0, 1);

  s.sun.position.copy(sunDir).multiplyScalar(120);
  s.sun.intensity = 0.15 + daylight * 1.05;
  const warmth = THREE.MathUtils.clamp(1 - Math.abs(elevNorm) * 1.4, 0, 1);
  s.sun.color.setRGB(1.0, 0.9 - warmth * 0.25, 0.75 - warmth * 0.45);
  s.hemi.intensity = 0.18 + daylight * 0.55;
  s.ambient.intensity = 0.18 + daylight * 0.12;

  renderer.toneMappingExposure = 0.4 + daylight * 0.6;

  const fogNight = new THREE.Color(theme.fog.night);
  const fogDay   = new THREE.Color(theme.fog.day);
  const fogWarm  = new THREE.Color(theme.fog.warm);
  let fog;
  if (elevNorm > 0.15) fog = fogDay;
  else if (elevNorm > -0.15) {
    const k = (elevNorm + 0.15) / 0.3;
    fog = fogWarm.clone().lerp(fogDay, k);
  } else if (elevNorm > -0.4) {
    const k = (elevNorm + 0.4) / 0.25;
    fog = fogNight.clone().lerp(fogWarm, k);
  } else fog = fogNight;
  s.scene.fog.color.copy(fog);

  const starOpacity = THREE.MathUtils.clamp((-elevNorm - 0.05) * 2.5, 0, 1);
  s.stars.material.opacity = starOpacity;
  s.stars.visible = starOpacity > 0.01;
  s.stars.rotation.y = t * Math.PI * 2;

  if (s.clouds.material) {
    s.clouds.material.opacity = 0.55 + daylight * 0.25;
    s.clouds.material.color.setRGB(0.9 + warmth * 0.1, 0.92 - warmth * 0.05, 1.0 - warmth * 0.15);
  }
}

// =========================================================================
// CHAT
// =========================================================================
function addChatLine(from, text, color = '#ffffff') {
  const line = document.createElement('div');
  line.className = 'chat-line';
  if (from === '-') {
    line.innerHTML = `<i style="opacity:0.7">${escapeHtml(text)}</i>`;
  } else {
    line.innerHTML = `<span class="from" style="color:${color}">${escapeHtml(from)}:</span>${escapeHtml(text)}`;
  }
  chatLog.appendChild(line);
  while (chatLog.childElementCount > 8) chatLog.removeChild(chatLog.firstChild);
  setTimeout(() => line.remove(), 8200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function openChat() {
  if (!session) return;
  chatInput.classList.add('visible');
  chatInput.value = '';
  chatInput.focus();
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeChat() {
  chatInput.classList.remove('visible');
  chatInput.blur();
}
chatInput.addEventListener('keydown', (e) => {
  if (e.code === 'Enter') {
    const txt = chatInput.value.trim();
    if (txt && session) session.network.sendChat(txt);
    closeChat();
    e.preventDefault();
  } else if (e.code === 'Escape') {
    closeChat();
  }
});

// =========================================================================
// GLOBAL UI WIRING
// =========================================================================
canvas.addEventListener('click', () => {
  if (!session) return;
  if (!menu.classList.contains('hidden')) return;
  if (chatInput.classList.contains('visible')) return;
  session.player.lock();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

playBtn.addEventListener('click', () => {
  if (!session) return;
  menu.classList.add('hidden');
  session.player.lock();
});

leaveBtn.addEventListener('click', () => {
  if (!session) return;
  if (!confirm('Quitter ce monde et revenir au menu de sélection ?')) return;
  leaveSession();
});

document.addEventListener('pointerlockchange', () => {
  if (!session) return;
  if (!document.pointerLockElement && !chatInput.classList.contains('visible')) {
    menu.classList.remove('hidden');
  }
});

window.addEventListener('keydown', e => {
  if (!session) return;
  if (chatInput.classList.contains('visible')) return;
  if (e.code === 'KeyT') {
    e.preventDefault();
    openChat();
  } else if (e.code === 'KeyL' && session.leader) {
    session.timeOfDay = (session.timeOfDay + 0.5) % 1;
    session.network.sendTime(session.timeOfDay);
  }
});

// =========================================================================
// MAIN LOOP
// =========================================================================
let last = performance.now();
let frames = 0;
let fpsTimer = 0;
let animating = false;
let netTimeTick = 0;

function animate() {
  requestAnimationFrame(animate);
  if (!session) { renderer.clear(); return; }

  const s = session;
  const now = performance.now();
  let dt = (now - last) / 1000;
  if (dt > 0.1) dt = 0.1;
  last = now;

  s.waterTime += dt;
  if (s.waterMat.userData.shader) s.waterMat.userData.shader.uniforms.uTime.value = s.waterTime;

  if (s.player.locked) {
    s.player.update(dt);
    const hSpeed = Math.hypot(s.player.velocity.x, s.player.velocity.z);
    if (s.player.onGround && hSpeed > 1) s.audio.playStep();
  }

  s.timeOfDay = (s.timeOfDay + dt / DAY_LENGTH) % 1;
  updateAtmosphere(s, s.timeOfDay);

  // Chunk streaming
  const [cx, cz] = s.world.worldToChunk(s.player.position.x, s.player.position.z);
  s.world.ensureAround(cx, cz, VIEW_RADIUS);
  s.world.unloadOutside(cx, cz, VIEW_RADIUS + 1);
  s.world.flushDirty(2);

  s.interaction.updateHighlight();
  s.particles.update(dt);
  s.remotePlayers.update(dt);

  // Sky/clouds/stars follow camera
  s.sky.position.set(camera.position.x, 0, camera.position.z);
  s.clouds.position.set(camera.position.x, 78, camera.position.z);
  if (s.clouds.material && s.clouds.material.map) {
    s.clouds.material.map.offset.x = (s.waterTime * 0.0035) % 1;
    s.clouds.material.map.offset.y = (s.waterTime * 0.0015) % 1;
  }
  s.stars.position.copy(camera.position);

  // View bobbing + FOV
  const hSpeed = Math.hypot(s.player.velocity.x, s.player.velocity.z);
  const moving = s.player.onGround && hSpeed > 0.5 && s.player.locked && !s.player.inWater;
  if (moving) s.bobPhase += dt * (s.player.running ? 12 : 8);
  const bobAmp = moving ? (s.player.running ? 0.07 : 0.045) : 0;
  const bobY = Math.sin(s.bobPhase) * bobAmp;
  const bobX = Math.cos(s.bobPhase * 0.5) * bobAmp * 0.5;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  camera.position.addScaledVector(right, bobX);
  camera.position.y += bobY;

  const targetFov = baseFov + (s.player.running && moving ? 6 : 0) + (s.player.inWater ? -3 : 0);
  s.currentFov += (targetFov - s.currentFov) * Math.min(1, dt * 8);
  if (Math.abs(s.currentFov - camera.fov) > 0.01) {
    camera.fov = s.currentFov;
    camera.updateProjectionMatrix();
  }

  // === Networking heartbeat ===
  s.network.sendPos(s.player.position.x, s.player.position.y, s.player.position.z, s.player.yaw, s.player.pitch);
  netTimeTick += dt;
  if (s.leader && netTimeTick > 5) {
    s.network.sendTime(s.timeOfDay);
    netTimeTick = 0;
  }

  // HUD
  const hours = Math.floor(s.timeOfDay * 24);
  const minutes = Math.floor((s.timeOfDay * 24 - hours) * 60);
  const icon = (s.timeOfDay > 0.25 && s.timeOfDay < 0.75) ? '☀' : '☾';
  clockEl.textContent = `${icon} ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}`;
  coordsEl.textContent =
    `x:${s.player.position.x.toFixed(1)} y:${s.player.position.y.toFixed(1)} z:${s.player.position.z.toFixed(1)}`;

  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fpsEl.textContent = `FPS: ${Math.round(frames / fpsTimer)}`;
    frames = 0;
    fpsTimer = 0;
  }

  renderer.render(s.scene, camera);
}
