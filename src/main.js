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
import { ItemDrops } from './itemDrops.js';
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
const pauseTabs    = document.querySelectorAll('.pause-tab');
const pausePages   = document.querySelectorAll('.pause-page');
const settingHand  = document.getElementById('setting-hand');
const settingFov   = document.getElementById('setting-fov');
const settingFovValue = document.getElementById('setting-fov-value');
const settingVolume = document.getElementById('setting-volume');
const settingVolumeValue = document.getElementById('setting-volume-value');
const settingAutoJump = document.getElementById('setting-autojump');
const settingSprintLock = document.getElementById('setting-sprintlock');
const pauseLogoutBtn = document.getElementById('pause-logout-btn');
const pauseDeleteAccountBtn = document.getElementById('pause-delete-account-btn');
const mobileControls = document.getElementById('mobile-controls');
const mobileJoystick = document.getElementById('mobile-joystick');
const mobileStick = document.getElementById('mobile-stick');
const mobileJumpBtn = document.getElementById('mobile-jump');
const mobileBreakBtn = document.getElementById('mobile-break');
const mobilePlaceBtn = document.getElementById('mobile-place');
const mobileInvBtn = document.getElementById('mobile-inv');
const mobileViewBtn = document.getElementById('mobile-view');
const clockEl      = document.getElementById('clock');
const coordsEl     = document.getElementById('coords');
const fpsEl        = document.getElementById('fps');
const serverInfoEl = document.getElementById('server-info');
const playersPanel = document.getElementById('players-panel');
const playersList  = document.getElementById('players-list');
const chatLog      = document.getElementById('chat-log');
const chatInput    = document.getElementById('chat-input');
const survivalHud  = document.getElementById('survival-hud');
const heartsEl     = document.getElementById('hearts');
const airBarEl     = document.getElementById('air-bar');
const airFillEl    = document.getElementById('air-fill');
const deathOverlay = document.getElementById('death-overlay');
const deathCause   = document.getElementById('death-cause');
const respawnBtn   = document.getElementById('respawn-btn');
const damageFlash  = document.getElementById('damage-flash');
const deleteAccountBtn = document.getElementById('delete-account-btn');

// Chat UX: historique persistant, navigation flèches, tab-completion.
const chatState = {
  history: [],       // messages affichés reçus (persistants sur la session cliente)
  sent: [],          // textes envoyés par le joueur
  sentIndex: -1,
  commandList: ['/help'],
  tabMatches: [],
  tabIndex: 0,
  maxHistory: 180,
};

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
  // Précharge l’atlas (pack + fallback) pendant l’écran des mondes.
  ensureAtlas().catch(() => {});
}

async function doLogout() {
  if (auth?.token) await postJson('/api/logout', {}, auth.token).catch(() => {});
  clearAuth();
  auth = null;
  if (session) leaveSession();
  showAuthScreen();
}

async function doDeleteAccount() {
  if (!auth?.token) return;
  const ok = confirm(
    `Supprimer définitivement le compte "${auth.name}" ?\n\n` +
    `Toutes tes constructions, ton inventaire et ta progression dans tous les mondes seront effacés. Cette action est irréversible.`
  );
  if (!ok) return;
  const ok2 = confirm('Es-tu vraiment sûr ? Tape OK pour confirmer la suppression.');
  if (!ok2) return;
  try {
    await fetch('/api/account', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + auth.token },
    });
  } catch {}
  clearAuth();
  auth = null;
  if (session) leaveSession();
  showAuthScreen();
}

logoutBtn.addEventListener('click', async () => { await doLogout(); });

deleteAccountBtn?.addEventListener('click', async () => { await doDeleteAccount(); });

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
let baseFov = 75;

const PAUSE_SETTINGS_KEY = 'cubecraft-pause-settings';
const pauseSettings = {
  hand: 'right',
  fov: 75,
  volume: 100,
  autoJump: false,
  sprintLock: false,
  activeTab: 'main',
};

function loadPauseSettings() {
  try {
    const raw = localStorage.getItem(PAUSE_SETTINGS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') Object.assign(pauseSettings, p);
  } catch {}
}

function savePauseSettings() {
  try { localStorage.setItem(PAUSE_SETTINGS_KEY, JSON.stringify(pauseSettings)); } catch {}
}

function applyPauseSettingsUI() {
  if (settingHand) settingHand.value = pauseSettings.hand === 'left' ? 'left' : 'right';
  if (settingFov) settingFov.value = String(pauseSettings.fov | 0);
  if (settingFovValue) settingFovValue.textContent = String(pauseSettings.fov | 0);
  if (settingVolume) settingVolume.value = String(Math.max(0, Math.min(100, pauseSettings.volume | 0)));
  if (settingVolumeValue) settingVolumeValue.textContent = `${Math.max(0, Math.min(100, pauseSettings.volume | 0))}%`;
  if (settingAutoJump) settingAutoJump.checked = !!pauseSettings.autoJump;
  if (settingSprintLock) settingSprintLock.checked = !!pauseSettings.sprintLock;
  document.body.classList.toggle('left-hand', pauseSettings.hand === 'left');
}

function applyPauseSettingsRuntime() {
  baseFov = Math.max(60, Math.min(110, pauseSettings.fov | 0));
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
  if (session?.audio?.setVolume) session.audio.setVolume((pauseSettings.volume | 0) / 100);
  if (session?.player?.setPreferences) {
    session.player.setPreferences({
      autoJump: !!pauseSettings.autoJump,
      sprintLock: !!pauseSettings.sprintLock,
    });
  }
}

function setPauseTab(tab) {
  const safe = ['main', 'settings', 'account'].includes(tab) ? tab : 'main';
  pauseSettings.activeTab = safe;
  pauseTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === safe));
  pausePages.forEach(p => p.classList.toggle('active', p.dataset.tab === safe));
  savePauseSettings();
}

loadPauseSettings();
applyPauseSettingsUI();
applyPauseSettingsRuntime();
pauseTabs.forEach(tab => tab.addEventListener('click', () => setPauseTab(tab.dataset.tab || 'main')));
setPauseTab(pauseSettings.activeTab || 'main');

settingHand?.addEventListener('change', () => {
  pauseSettings.hand = settingHand.value === 'left' ? 'left' : 'right';
  applyPauseSettingsUI();
  savePauseSettings();
});
settingFov?.addEventListener('input', () => {
  pauseSettings.fov = Math.max(60, Math.min(110, Number(settingFov.value) || 75));
  applyPauseSettingsUI();
  applyPauseSettingsRuntime();
  savePauseSettings();
});
settingVolume?.addEventListener('input', () => {
  pauseSettings.volume = Math.max(0, Math.min(100, Number(settingVolume.value) || 0));
  applyPauseSettingsUI();
  applyPauseSettingsRuntime();
  savePauseSettings();
});
settingAutoJump?.addEventListener('change', () => {
  pauseSettings.autoJump = !!settingAutoJump.checked;
  applyPauseSettingsRuntime();
  savePauseSettings();
});
settingSprintLock?.addEventListener('change', () => {
  pauseSettings.sprintLock = !!settingSprintLock.checked;
  applyPauseSettingsRuntime();
  savePauseSettings();
});
pauseLogoutBtn?.addEventListener('click', async () => { await doLogout(); });
pauseDeleteAccountBtn?.addEventListener('click', async () => { await doDeleteAccount(); });

/** Atlas blocs (async : charge le resource pack `/texture-pack/` par-dessus le procédural). */
let atlasCanvas = null;
let atlasTex = null;

function buildEmergencyAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#777';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#999';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillRect(32, 32, 32, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { canvas, texture };
}

async function ensureAtlas() {
  if (atlasCanvas && atlasTex) return;
  try {
    const built = await buildAtlas();
    atlasCanvas = built.canvas;
    atlasTex = built.texture;
  } catch (err) {
    console.error('Atlas load failed, using emergency fallback atlas:', err);
    const fb = buildEmergencyAtlas();
    atlasCanvas = fb.canvas;
    atlasTex = fb.texture;
  }
}

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
const isMobileDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

async function joinWorld(themeId) {
  if (!auth?.token) { showAuthScreen(); return; }
  const theme = themeById(themeId);
  const name = auth.name;

  selectionEl.classList.add('hidden');
  loading.classList.remove('hidden');
  progressBar.style.width = '5%';

  try {
    await ensureAtlas();
  } catch (e) {
    console.error(e);
    alert('Impossible de charger les textures du jeu.');
    selectionEl.classList.remove('hidden');
    loading.classList.add('hidden');
    return;
  }
  progressBar.style.width = '10%';

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
  setupMobileControls(session);

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
  audio.setVolume((pauseSettings.volume | 0) / 100);
  const player = new Player(camera, world, canvas);
  player.setPreferences({
    autoJump: !!pauseSettings.autoJump,
    sprintLock: !!pauseSettings.sprintLock,
  });
  const particles = new Particles(scene, atlasTex);
  const remotePlayers = new RemotePlayers(scene);
  const itemDrops = new ItemDrops(scene, atlasCanvas);

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
      // Server is authoritative for time-of-day; just trust it.
      if (typeof m.t === 'number' && session) session.timeOfDay = m.t;
    },
    itemSpawn: (m) => itemDrops.add(m),
    itemDespawn: (m) => {
      // If the local player is the one who picked it up, give them the block.
      const drop = itemDrops.drops.get(m.dropId);
      if (drop && m.by === network.you?.id && session) {
        session.interaction.addBlock(drop.blockId, 1);
        if (session.isSurvival) session.invDirty = true;
      }
      itemDrops.remove(m.dropId);
    },
    chat: (m) => addChatLine(m.from, m.text, m.color),
    system: (m) => addSystemLine(m.text, m.color || '#9aa5b1'),
    announce: (m) => addAnnounceLine(m.from, m.text),
    teleport: (m) => {
      if (!session || typeof m.x !== 'number') return;
      session.player.position.set(m.x, m.y, m.z);
      session.player.velocity.set(0, 0, 0);
    },
    worldReset: (m) => {
      if (!session) return;
      addSystemLine(m.message || 'Monde réinitialisé.', '#ff8080');
      setTimeout(() => leaveSession(), 600);
    },
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
  chatState.commandList = Array.isArray(welcome.commandList) && welcome.commandList.length
    ? welcome.commandList
    : ['/help'];
  if (Array.isArray(welcome.recentChat) && welcome.recentChat.length) {
    chatState.history = welcome.recentChat.slice(-chatState.maxHistory);
    renderChatHistory(12);
  }

  // Apply initial world state from the server.
  world.applyServerEdits(welcome.edits || {});
  for (const p of welcome.players) {
    knownPlayers.set(p.id, { name: p.name, color: p.color });
    remotePlayers.add(p);
  }
  for (const d of welcome.drops || []) itemDrops.add(d);
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

  // === Survival mode setup ===
  const isSurvival = theme.mode === 'survival';
  player.setMode(theme.mode || 'creative');
  if (isSurvival) {
    if (typeof welcome.spawn?.health === 'number') player.health = Math.max(1, Math.min(player.maxHealth, welcome.spawn.health));
    if (typeof welcome.spawn?.air === 'number') player.airTime = Math.max(0, Math.min(player.maxAir, welcome.spawn.air));
  }

  // === Interaction / hotbar (per-theme blocks) ===
  const initialSlot = welcome.spawn?.slot | 0;
  let invDirty = false;
  let lastInvSent = 0;
  const factionReq = async (path, body = null) => {
    const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token };
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return data || { ok: false, error: 'Erreur faction' };
  };
  const factionApi = {
    state: () => factionReq('/api/faction'),
    create: (nameV) => factionReq('/api/faction/create', { name: String(nameV || '').trim() }),
    invite: (target) => factionReq('/api/faction/invite', { target: String(target || '').trim() }),
    accept: () => factionReq('/api/faction/accept', {}),
    decline: () => factionReq('/api/faction/decline', {}),
    leave: () => factionReq('/api/faction/leave', {}),
    kick: (target) => factionReq('/api/faction/kick', { target: String(target || '').trim() }),
    transfer: (target) => factionReq('/api/faction/transfer', { target: String(target || '').trim() }),
  };
  const interaction = new Interaction({
    camera, world, player, scene, atlasCanvas, audio,
    hotbar: theme.hotbar,
    initialSlot,
    mode: theme.mode || 'creative',
    initialInventory: welcome.spawn?.inventory || null,
    onBreak: (x, y, z, id) => particles.spawnBreak(x, y, z, id),
    onEdit: (x, y, z, id) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const lx = x - cx * CHUNK_SIZE;
      const lz = z - cz * CHUNK_SIZE;
      network.sendEdit(cx, cz, lx, y, lz, id);
    },
    onSlot: (slot) => network.sendSlot(slot),
    onInventoryChange: () => { invDirty = true; },
    onDropItem: (drop) => network.sendDropItem(drop),
    factionApi,
  });

  const session = {
    theme, scene, world, player, audio, particles, interaction,
    sky, skyU, sun, hemi, ambient, stars, clouds,
    opaqueMat, transparentMat, waterMat, waterTime,
    network, remotePlayers, knownPlayers, itemDrops,
    timeOfDay: welcome.timeOfDay ?? 0.3,
    spawn: welcome.spawn || null,
    refreshPlayersList,
    bobPhase: 0, currentFov: baseFov,
    mobileActive: false,
    isSurvival,
    get invDirty() { return invDirty; },
    set invDirty(v) { invDirty = v; },
    get lastInvSent() { return lastInvSent; },
    set lastInvSent(v) { lastInvSent = v; },
  };

  // === Wire survival HUD + death ===
  setupSurvivalHud(session);

  return session;
}

// =========================================================================
// SURVIVAL HUD + DEATH
// =========================================================================
function setupSurvivalHud(s) {
  const isSurv = s.isSurvival;
  survivalHud.classList.toggle('hidden', !isSurv);
  airBarEl.classList.add('hidden');
  damageFlash.classList.remove('on');
  deathOverlay.classList.add('hidden');

  if (!isSurv) {
    s.player.onHealthChange = null;
    s.player.onAirChange = null;
    s.player.onDamage = null;
    s.player.onDeath = null;
    return;
  }

  renderHearts(s.player.health, s.player.maxHealth);
  renderAir(s.player.airTime, s.player.maxAir);
  let healthDirty = false;

  s.player.onHealthChange = (hp, max) => {
    renderHearts(hp, max);
    healthDirty = true;
  };
  s.player.onAirChange = (air, max) => {
    renderAir(air, max);
    healthDirty = true;
  };
  s.player.onDamage = () => {
    damageFlash.classList.add('on');
    setTimeout(() => damageFlash.classList.remove('on'), 220);
  };
  s.player.onDeath = (cause) => {
    deathCause.textContent = causeText(cause);
    deathOverlay.classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  };

  s._healthDirty = () => healthDirty;
  s._clearHealthDirty = () => { healthDirty = false; };
}

function renderHearts(hp, max) {
  if (!heartsEl) return;
  const totalHearts = Math.ceil(max / 2);
  const filled = Math.floor(hp / 2);
  const half = hp % 2 === 1;
  let html = '';
  for (let i = 0; i < totalHearts; i++) {
    let cls = 'heart empty';
    if (i < filled) cls = 'heart full';
    else if (i === filled && half) cls = 'heart half';
    html += `<span class="${cls}"></span>`;
  }
  heartsEl.innerHTML = html;
}

function renderAir(air, max) {
  if (!airBarEl || !airFillEl) return;
  const ratio = Math.max(0, Math.min(1, air / max));
  if (ratio >= 0.999) {
    airBarEl.classList.add('hidden');
  } else {
    airBarEl.classList.remove('hidden');
    airFillEl.style.width = `${ratio * 100}%`;
  }
}

function causeText(cause) {
  switch (cause) {
    case 'fall':  return 'Tu es tombé de trop haut.';
    case 'lave':
    case 'lava':  return 'Tu as fondu dans la lave.';
    case 'drown': return 'Tu t\u2019es noyé.';
    case 'void':  return 'Tu es tombé dans le vide.';
    default:      return 'Tu es mort.';
  }
}

respawnBtn?.addEventListener('click', () => {
  if (!session) return;
  doRespawn();
});

function doRespawn() {
  if (!session) return;
  const p = session.player;
  p.respawn();
  p.reviveAt(p.position.x, p.position.y, p.position.z);
  deathOverlay.classList.add('hidden');
  // After respawn, treat inventory as dirty so server saves the (possibly cleared) state.
  if (session.isSurvival) session.invDirty = true;
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
  teardownMobileControls();
  // Always flush inventory before disconnecting so creative hotbar arrangement
  // is persisted too, not only survival inventories.
  try { session.network.sendInventory(session.interaction.exportInventory()); } catch {}
  if (session.isSurvival) {
    try { session.network.sendHealth(session.player.health, session.player.airTime); } catch {}
  }
  try { session.itemDrops?.clear(); } catch {}
  try { session.network.disconnect(); } catch {}
  try { session.player.destroy?.(); } catch {}
  survivalHud.classList.add('hidden');
  deathOverlay.classList.add('hidden');

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
  pushChatEntry({ type: 'chat', from, text, color, ts: Date.now() });
  appendChatEntryDom({ type: 'chat', from, text, color }, !chatInput.classList.contains('visible'));
}

function addSystemLine(text, color = '#9aa5b1') {
  // System messages can be multi-line.
  const lines = String(text).split('\n');
  for (const t of lines) {
    pushChatEntry({ type: 'system', text: t, color, ts: Date.now() });
    appendChatEntryDom({ type: 'system', text: t, color }, !chatInput.classList.contains('visible'));
  }
}

function addAnnounceLine(from, text) {
  pushChatEntry({ type: 'announce', from, text, ts: Date.now() });
  appendChatEntryDom({ type: 'announce', from, text }, !chatInput.classList.contains('visible'));
}

function pushChatEntry(entry) {
  chatState.history.push(entry);
  if (chatState.history.length > chatState.maxHistory) {
    chatState.history.splice(0, chatState.history.length - chatState.maxHistory);
  }
}

function appendChatEntryDom(entry, transient = true) {
  const nearBottom = (chatLog.scrollTop + chatLog.clientHeight) >= (chatLog.scrollHeight - 16);
  const line = document.createElement('div');
  if (entry.type === 'system') {
    line.className = 'chat-line system';
    line.innerHTML = `<i style="color:${entry.color || '#9aa5b1'}">${escapeHtml(entry.text || '')}</i>`;
  } else if (entry.type === 'announce') {
    line.className = 'chat-line announce';
    line.innerHTML = `<span class="announce-prefix">★ Annonce de ${escapeHtml(entry.from || '')}</span><br>${escapeHtml(entry.text || '')}`;
  } else if (entry.from === '-') {
    line.className = 'chat-line';
    line.innerHTML = `<i style="opacity:0.7">${escapeHtml(entry.text || '')}</i>`;
  } else {
    line.className = 'chat-line';
    line.innerHTML = `<span class="from" style="color:${entry.color || '#fff'}">${escapeHtml(entry.from || '')}:</span>${escapeHtml(entry.text || '')}`;
  }
  chatLog.appendChild(line);
  while (chatLog.childElementCount > 24) chatLog.removeChild(chatLog.firstChild);
  if (nearBottom || chatInput.classList.contains('visible')) {
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  if (transient) {
    const ttl = entry.type === 'announce' ? 14000 : (entry.type === 'system' ? 12000 : 8200);
    setTimeout(() => line.remove(), ttl);
  }
}

function renderChatHistory(limit = 24) {
  chatLog.innerHTML = '';
  const list = chatState.history.slice(-limit);
  for (const e of list) appendChatEntryDom(e, false);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}

function openChat() {
  if (!session) return;
  renderChatHistory(120);
  chatInput.classList.add('visible');
  chatInput.value = '';
  chatState.sentIndex = chatState.sent.length;
  chatState.tabMatches = [];
  chatState.tabIndex = 0;
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
    if (txt && session) {
      session.network.sendChat(txt);
      chatState.sent.push(txt);
      if (chatState.sent.length > 120) chatState.sent.shift();
    }
    chatState.sentIndex = chatState.sent.length;
    chatState.tabMatches = [];
    chatState.tabIndex = 0;
    closeChat();
    e.preventDefault();
  } else if (e.code === 'Escape') {
    closeChat();
  } else if (e.code === 'ArrowUp') {
    if (!chatState.sent.length) return;
    chatState.sentIndex = Math.max(0, chatState.sentIndex - 1);
    chatInput.value = chatState.sent[chatState.sentIndex] || '';
    e.preventDefault();
  } else if (e.code === 'ArrowDown') {
    if (!chatState.sent.length) return;
    chatState.sentIndex = Math.min(chatState.sent.length, chatState.sentIndex + 1);
    chatInput.value = chatState.sent[chatState.sentIndex] || '';
    e.preventDefault();
  } else if (e.code === 'Tab') {
    const v = chatInput.value;
    if (!v.startsWith('/')) return;
    const token = v.slice(1).trim().toLowerCase();
    const base = token.split(/\s+/)[0];
    if (!chatState.tabMatches.length) {
      chatState.tabMatches = chatState.commandList.filter(c => c.startsWith('/' + base));
      if (!chatState.tabMatches.length) return;
      chatState.tabIndex = 0;
    } else {
      chatState.tabIndex = (chatState.tabIndex + 1) % chatState.tabMatches.length;
    }
    const choice = chatState.tabMatches[chatState.tabIndex];
    chatInput.value = choice + (v.includes(' ') ? v.slice(v.indexOf(' ')) : ' ');
    e.preventDefault();
  } else {
    chatState.tabMatches = [];
  }
});

// =========================================================================
// GLOBAL UI WIRING
// =========================================================================
function setupMobileControls(s) {
  if (!isMobileDevice || !mobileControls) return;
  mobileControls.classList.remove('hidden');
  s.mobileActive = true;
  s.player.setMobileMode(true);

  const resetStick = () => {
    s.player.setVirtualMove(0, 0);
    if (mobileStick) {
      mobileStick.style.left = '40px';
      mobileStick.style.top = '40px';
    }
  };

  const moveFromTouch = (clientX, clientY) => {
    const rect = mobileJoystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const maxR = rect.width * 0.35;
    const d = Math.hypot(dx, dy);
    if (d > maxR && d > 0) {
      dx = (dx / d) * maxR;
      dy = (dy / d) * maxR;
    }
    if (mobileStick) {
      mobileStick.style.left = `${rect.width / 2 + dx - 20}px`;
      mobileStick.style.top = `${rect.height / 2 + dy - 20}px`;
    }
    s.player.setVirtualMove(dx / maxR, dy / maxR);
  };

  mobileJoystick.ontouchstart = (e) => {
    const t = e.touches[0];
    if (!t) return;
    moveFromTouch(t.clientX, t.clientY);
    e.preventDefault();
  };
  mobileJoystick.ontouchmove = (e) => {
    const t = e.touches[0];
    if (!t) return;
    moveFromTouch(t.clientX, t.clientY);
    e.preventDefault();
  };
  mobileJoystick.ontouchend = () => resetStick();
  mobileJoystick.ontouchcancel = () => resetStick();

  let lastLook = null;
  canvas.ontouchstart = (e) => {
    const t = e.touches[0];
    if (!t) return;
    lastLook = { x: t.clientX, y: t.clientY };
  };
  canvas.ontouchmove = (e) => {
    const t = e.touches[0];
    if (!t || !lastLook) return;
    const dx = t.clientX - lastLook.x;
    const dy = t.clientY - lastLook.y;
    s.player.lookBy(dx, dy);
    lastLook = { x: t.clientX, y: t.clientY };
    e.preventDefault();
  };
  canvas.ontouchend = () => { lastLook = null; };

  mobileJumpBtn.ontouchstart = (e) => { s.player.setVirtualJump(true); e.preventDefault(); };
  mobileJumpBtn.ontouchend = () => s.player.setVirtualJump(false);
  mobileJumpBtn.ontouchcancel = () => s.player.setVirtualJump(false);

  mobileBreakBtn.ontouchstart = (e) => { s.interaction._onMouseDown({ button: 0 }); e.preventDefault(); };
  mobileBreakBtn.ontouchend = () => s.interaction._onMouseUp();
  mobileBreakBtn.ontouchcancel = () => s.interaction._onMouseUp();

  mobilePlaceBtn.ontouchstart = (e) => { s.interaction._onMouseDown({ button: 2 }); e.preventDefault(); };
  mobileInvBtn.ontouchstart = (e) => {
    if (s.interaction.invOpen) s.interaction.closeInventory();
    else s.interaction.openInventory();
    e.preventDefault();
  };
  mobileViewBtn.ontouchstart = (e) => {
    s.player.viewMode = (s.player.viewMode + 1) % 3;
    e.preventDefault();
  };
}

function teardownMobileControls() {
  if (!mobileControls) return;
  mobileControls.classList.add('hidden');
  canvas.ontouchstart = null;
  canvas.ontouchmove = null;
  canvas.ontouchend = null;
  if (mobileJoystick) {
    mobileJoystick.ontouchstart = null;
    mobileJoystick.ontouchmove = null;
    mobileJoystick.ontouchend = null;
    mobileJoystick.ontouchcancel = null;
  }
}

canvas.addEventListener('click', () => {
  if (!session) return;
  if (!menu.classList.contains('hidden')) return;
  if (chatInput.classList.contains('visible')) return;
  if (isMobileDevice) return;
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

menu.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  if (!session) return;
  if (session.mobileActive) return;
  const inventoryEl = document.getElementById('inventory');
  const inventoryOpen = inventoryEl && !inventoryEl.classList.contains('hidden');
  if (!document.pointerLockElement
      && !chatInput.classList.contains('visible')
      && deathOverlay.classList.contains('hidden')
      && !inventoryOpen) {
    setPauseTab('main');
    menu.classList.remove('hidden');
  }
});

window.addEventListener('keydown', e => {
  if (!session) return;
  if (chatInput.classList.contains('visible')) return;
  if (e.code === 'KeyT') {
    e.preventDefault();
    openChat();
  }
});

// =========================================================================
// MAIN LOOP
// =========================================================================
let last = performance.now();
let frames = 0;
let fpsTimer = 0;
let animating = false;

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

  if (s.player.locked || s.mobileActive) {
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
  s.interaction.updateMining(dt);
  s.particles.update(dt);
  s.remotePlayers.update(dt);
  if ((s.player.locked || s.mobileActive) && !s.player.dead) {
    s.itemDrops.update(dt, s.world, s.player, s.network.you?.id, (dropId) => s.network.sendPickup(dropId));
  } else {
    s.itemDrops.update(dt, s.world, s.player, -1, null);
  }

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
  const sprinting = s.player.running || s.player.sprintLock;
  if (moving) s.bobPhase += dt * (sprinting ? 12 : 8);
  const bobAmp = moving ? (sprinting ? 0.07 : 0.045) : 0;
  const bobY = Math.sin(s.bobPhase) * bobAmp;
  const bobX = Math.cos(s.bobPhase * 0.5) * bobAmp * 0.5;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  camera.position.addScaledVector(right, bobX);
  camera.position.y += bobY;

  const targetFov = baseFov + (sprinting && moving ? 6 : 0) + (s.player.inWater ? -3 : 0);
  s.currentFov += (targetFov - s.currentFov) * Math.min(1, dt * 8);
  if (Math.abs(s.currentFov - camera.fov) > 0.01) {
    camera.fov = s.currentFov;
    camera.updateProjectionMatrix();
  }

  // === Networking heartbeat ===
  s.network.sendPos(s.player.position.x, s.player.position.y, s.player.position.z, s.player.yaw, s.player.pitch);

  // Inventory sync runs in both modes (creative persists the hotbar
  // arrangement; survival persists the actual stacks).
  {
    const nowMs = performance.now();
    if (s.invDirty && nowMs - s.lastInvSent > 1500) {
      s.network.sendInventory(s.interaction.exportInventory());
      s.lastInvSent = nowMs;
      s.invDirty = false;
    }
    if (s.isSurvival && s._healthDirty && s._healthDirty() && nowMs - (s._lastHealthSent || 0) > 800) {
      s.network.sendHealth(s.player.health, s.player.airTime);
      s._clearHealthDirty();
      s._lastHealthSent = nowMs;
    }
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
