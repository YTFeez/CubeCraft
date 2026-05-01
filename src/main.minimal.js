import * as THREE from 'three';
import { BLOCK, BLOCK_INFO, buildAtlas } from './blocks.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Interaction } from './interaction.js';
import { Audio } from './audio.js';
import { Particles } from './particles.js';
import { THEMES, themeById } from './themes.js';

const VIEW_RADIUS = 4;

const canvas = document.getElementById('game');
const authEl = document.getElementById('auth');
const selectionEl = document.getElementById('selection');
const worldsEl = document.getElementById('worlds');
const meNameEl = document.getElementById('me-name');
const logoutBtn = document.getElementById('logout-btn');
const deleteAccountBtn = document.getElementById('delete-account-btn');
const menu = document.getElementById('menu');
const menuSubtitle = document.getElementById('menu-subtitle');
const loading = document.getElementById('loading');
const progressBar = document.getElementById('progress-bar');
const playBtn = document.getElementById('play-btn');
const leaveBtn = document.getElementById('leave-btn');
const chatEl = document.getElementById('chat');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const playersPanel = document.getElementById('players-panel');
const serverInfoEl = document.getElementById('server-info');
const coordsEl = document.getElementById('coords');
const fpsEl = document.getElementById('fps');
const clockEl = document.getElementById('clock');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 800);

let atlasCanvas = null;
let atlasTex = null;
let session = null;
let animating = false;
let last = performance.now();
let fpsFrames = 0;
let fpsAcc = 0;
const soloChatState = {
  sent: [],
  sentIndex: 0,
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function addChatLine(from, text, color = '#ffffff') {
  if (!chatLog) return;
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.innerHTML = `<span class="from" style="color:${color}">${escapeHtml(from)}:</span>${escapeHtml(text)}`;
  chatLog.appendChild(line);
  while (chatLog.childElementCount > 120) chatLog.removeChild(chatLog.firstChild);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function addSystemLine(text, color = '#9aa5b1') {
  if (!chatLog) return;
  const line = document.createElement('div');
  line.className = 'chat-line system';
  line.innerHTML = `<i style="color:${color}">${escapeHtml(text)}</i>`;
  chatLog.appendChild(line);
  while (chatLog.childElementCount > 120) chatLog.removeChild(chatLog.firstChild);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function parseTimeArg(arg) {
  const t = (arg || '').toLowerCase();
  if (t === 'day' || t === 'jour') return 'day';
  if (t === 'night' || t === 'nuit') return 'night';
  if (t === 'noon' || t === 'midi') return 'noon';
  if (t === 'midnight' || t === 'minuit') return 'midnight';
  return null;
}

function resolveBlockId(token) {
  if (!token) return null;
  if (/^\d+$/.test(token)) {
    const id = Number(token);
    if (BLOCK_INFO[id]) return id;
    return null;
  }
  const key = token.trim().toUpperCase();
  if (BLOCK[key] != null) return BLOCK[key];
  const found = Object.entries(BLOCK).find(([k]) => k.toLowerCase() === token.toLowerCase());
  return found ? found[1] : null;
}

function runLocalCommand(rawText) {
  if (!session) return;
  const [cmdRaw, ...rest] = rawText.trim().split(/\s+/);
  const cmd = (cmdRaw || '').toLowerCase();
  const arg = rest.join(' ');
  const s = session;
  switch (cmd) {
    case '/help':
      addSystemLine('Commandes: /help, /tp x y z, /time <day|night|noon|midnight>, /gamemode <creative|survival>, /give <id|name> [count], /clearinv');
      return;
    case '/tp': {
      if (rest.length < 3) return addSystemLine('Usage: /tp <x> <y> <z>', '#ff8080');
      const x = Number(rest[0]), y = Number(rest[1]), z = Number(rest[2]);
      if (![x, y, z].every(Number.isFinite)) return addSystemLine('Coordonnées invalides.', '#ff8080');
      s.player.position.set(x, y, z);
      s.player.velocity.set(0, 0, 0);
      addSystemLine(`Téléporté en ${x} ${y} ${z}`, '#7fd87f');
      return;
    }
    case '/time': {
      const v = parseTimeArg(arg);
      if (!v) return addSystemLine('Usage: /time <day|night|noon|midnight>', '#ff8080');
      const textMap = { day: '☀ jour', night: '☾ nuit', noon: '☀ midi', midnight: '☾ minuit' };
      clockEl.textContent = textMap[v];
      addSystemLine(`Heure fixée: ${v}`, '#7fd87f');
      return;
    }
    case '/gamemode':
    case '/gm': {
      const m = (rest[0] || '').toLowerCase();
      if (m !== 'creative' && m !== 'survival') return addSystemLine('Usage: /gamemode <creative|survival>', '#ff8080');
      s.player.setMode(m);
      s.interaction.setMode(m);
      addSystemLine(`Mode changé: ${m}`, '#7fd87f');
      return;
    }
    case '/give': {
      const id = resolveBlockId(rest[0]);
      if (id == null) return addSystemLine('Bloc inconnu. Usage: /give <id|name> [count]', '#ff8080');
      const count = Math.max(1, Math.min(64, Number(rest[1] || 1) | 0));
      s.interaction.addBlock(id, count);
      addSystemLine(`+${count} ${BLOCK_INFO[id]?.name || `block ${id}`}`, '#7fd87f');
      return;
    }
    case '/clearinv':
    case '/clearinventory': {
      s.interaction.setMode('creative', null);
      addSystemLine('Inventaire remis à zéro (créatif).', '#7fd87f');
      return;
    }
    default:
      addSystemLine(`Commande inconnue: ${cmd}`, '#ff8080');
  }
}

function openChat() {
  if (!chatInput || !session) return;
  chatInput.classList.add('visible');
  chatInput.value = '';
  soloChatState.sentIndex = soloChatState.sent.length;
  chatInput.focus();
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeChat() {
  if (!chatInput) return;
  chatInput.classList.remove('visible');
  chatInput.blur();
}

function buildEmergencyAtlas() {
  const tile = 16;
  const cols = 4;
  const rows = 9;
  const canvas = document.createElement('canvas');
  canvas.width = tile * cols;
  canvas.height = tile * rows;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * tile;
      const y = r * tile;
      ctx.fillStyle = (r + c) % 2 === 0 ? '#8a8a8a' : '#686868';
      ctx.fillRect(x, y, tile, tile);
    }
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
    console.warn('Atlas failed, fallback used', err);
    const built = buildEmergencyAtlas();
    atlasCanvas = built.canvas;
    atlasTex = built.texture;
  }
}

function renderWorldCards() {
  worldsEl.innerHTML = '';
  for (const theme of Object.values(THEMES)) {
    const card = document.createElement('div');
    card.className = 'world-card';
    card.style.setProperty('--c1', theme.color);
    card.style.setProperty('--c2', theme.accent);
    card.innerHTML = `
      <div class="world-bg"></div>
      <h3>${theme.name}</h3>
      <div class="tagline">${theme.tagline}</div>
      <div class="stats"><span class="badge">mode minimal</span><span class="badge">offline</span></div>
    `;
    card.addEventListener('click', () => joinWorld(theme.id));
    worldsEl.appendChild(card);
  }
}

async function initialGenerate(s) {
  const { world, player } = s;
  const total = (VIEW_RADIUS * 2 + 1) ** 2;
  let done = 0;
  const deadline = performance.now() + 8000;
  const [cx, cz] = world.worldToChunk(player.position.x, player.position.z);

  for (let dz = -VIEW_RADIUS; dz <= VIEW_RADIUS; dz++) {
    for (let dx = -VIEW_RADIUS; dx <= VIEW_RADIUS; dx++) {
      const ch = world.ensureChunk(cx + dx, cz + dz);
      world.dirty.add(ch);
      done++;
    }
    progressBar.style.width = `${Math.round((done / total) * 100)}%`;
    await new Promise((r) => setTimeout(r, 0));
    if (performance.now() > deadline) break;
  }

  let guard = 0;
  while (world.dirty.size > 0 && guard++ < 180 && performance.now() <= deadline) {
    world.flushDirty(8);
    await new Promise((r) => setTimeout(r, 0));
  }
  player.respawn();
}

async function joinWorld(themeId) {
  const theme = themeById(themeId);
  selectionEl.classList.add('hidden');
  loading.classList.remove('hidden');
  progressBar.style.width = '5%';

  await ensureAtlas();
  progressBar.style.width = '12%';

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(theme.fog.day, 40, 160);
  scene.background = new THREE.Color(theme.fog.day);

  const hemi = new THREE.HemisphereLight(0xcfdcf0, 0x5c4a35, 0.8);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.85);
  sun.position.set(50, 90, 30);
  scene.add(sun);

  const opaqueMat = new THREE.MeshLambertMaterial({ map: atlasTex, side: THREE.DoubleSide, vertexColors: true });
  const transparentMat = new THREE.MeshLambertMaterial({ map: atlasTex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.4, vertexColors: true });
  const waterMat = new THREE.MeshLambertMaterial({ map: atlasTex, side: THREE.DoubleSide, transparent: true, opacity: 0.8, depthWrite: false, vertexColors: true });

  const world = new World(theme, scene, opaqueMat, transparentMat, waterMat);
  const player = new Player(camera, world, canvas);
  const startMode = theme.mode === 'survival' ? 'survival' : 'creative';
  player.setMode(startMode);
  const audio = new Audio();
  const particles = new Particles(scene, atlasTex);
  const interaction = new Interaction({
    camera, world, player, scene, atlasCanvas, audio,
    hotbar: theme.hotbar,
    mode: startMode,
    onBreak: (x, y, z, id) => particles.spawnBreak(x, y, z, id),
    onEdit: () => {},
    onSlot: () => {},
    onInventoryChange: () => {},
    onDropItem: () => {},
  });

  session = { theme, scene, world, player, interaction, particles, audio };
  await initialGenerate(session);

  loading.classList.add('hidden');
  menu.classList.remove('hidden');
  menuSubtitle.textContent = `Mode minimal - ${theme.name}`;
  serverInfoEl.textContent = `Mode minimal local`;
  addSystemLine(`Mode actuel: ${startMode}. Tape /gamemode creative|survival ou appuie sur G.`);
  if (!animating) { animating = true; animate(); }
}

function leaveSession() {
  if (!session) return;
  try { session.player.destroy?.(); } catch {}
  session.scene.traverse((obj) => {
    if (!obj || !obj.isMesh) return;
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m && m.dispose && m.dispose());
      else if (obj.material.dispose) obj.material.dispose();
    }
  });
  session = null;
  menu.classList.add('hidden');
  loading.classList.add('hidden');
  selectionEl.classList.remove('hidden');
}

function animate() {
  requestAnimationFrame(animate);
  if (!session) { renderer.clear(); return; }

  const now = performance.now();
  let dt = (now - last) / 1000;
  if (dt > 0.1) dt = 0.1;
  last = now;

  const s = session;
  if (s.player.locked) {
    s.player.update(dt);
    s.interaction.updateHighlight();
    s.interaction.updateMining(dt);
    s.particles.update(dt);
  }

  const [cx, cz] = s.world.worldToChunk(s.player.position.x, s.player.position.z);
  s.world.ensureAround(cx, cz, VIEW_RADIUS);
  s.world.unloadOutside(cx, cz, VIEW_RADIUS + 1);
  s.world.flushDirty(2);

  coordsEl.textContent = `x:${s.player.position.x.toFixed(1)} y:${s.player.position.y.toFixed(1)} z:${s.player.position.z.toFixed(1)}`;
  clockEl.textContent = '☀ mode minimal';
  fpsFrames++;
  fpsAcc += dt;
  if (fpsAcc >= 0.5) {
    fpsEl.textContent = `FPS: ${Math.round(fpsFrames / fpsAcc)}`;
    fpsFrames = 0;
    fpsAcc = 0;
  }

  renderer.render(s.scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

canvas.addEventListener('click', () => {
  if (!session || !menu.classList.contains('hidden')) return;
  if (chatInput?.classList.contains('visible')) return;
  session.player.lock();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('pointerlockchange', () => {
  if (!session) return;
  const inventoryEl = document.getElementById('inventory');
  const invOpen = inventoryEl && !inventoryEl.classList.contains('hidden');
  const chatOpen = !!chatInput?.classList.contains('visible');
  if (!document.pointerLockElement && !invOpen && !chatOpen) menu.classList.remove('hidden');
});

playBtn?.addEventListener('click', () => {
  if (!session) return;
  menu.classList.add('hidden');
  session.player.lock();
});
leaveBtn?.addEventListener('click', () => leaveSession());

chatInput?.addEventListener('keydown', (e) => {
  if (e.code === 'Enter') {
    const txt = chatInput.value.trim();
    if (txt) {
      if (txt.startsWith('/')) runLocalCommand(txt);
      else addChatLine('OFFLINE', txt, '#7bdff2');
      soloChatState.sent.push(txt);
      if (soloChatState.sent.length > 120) soloChatState.sent.shift();
    }
    closeChat();
    e.preventDefault();
    return;
  }
  if (e.code === 'Escape') {
    closeChat();
    e.preventDefault();
    return;
  }
  if (e.code === 'ArrowUp') {
    if (!soloChatState.sent.length) return;
    soloChatState.sentIndex = Math.max(0, soloChatState.sentIndex - 1);
    chatInput.value = soloChatState.sent[soloChatState.sentIndex] || '';
    e.preventDefault();
    return;
  }
  if (e.code === 'ArrowDown') {
    if (!soloChatState.sent.length) return;
    soloChatState.sentIndex = Math.min(soloChatState.sent.length, soloChatState.sentIndex + 1);
    chatInput.value = soloChatState.sent[soloChatState.sentIndex] || '';
    e.preventDefault();
  }
});

window.addEventListener('keydown', (e) => {
  if (!session) return;
  if (e.code === 'KeyG' && !e.repeat) {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const nextMode = session.player.surviveMode ? 'creative' : 'survival';
    session.player.setMode(nextMode);
    session.interaction.setMode(nextMode);
    addSystemLine(`Mode changé: ${nextMode}`, '#7fd87f');
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyT' && !chatInput?.classList.contains('visible')) {
    openChat();
    e.preventDefault();
  }
});

logoutBtn?.addEventListener('click', () => {});
deleteAccountBtn?.addEventListener('click', () => {});
authEl?.classList.add('hidden');
chatEl?.classList.remove('hidden');
playersPanel?.classList.remove('visible');
selectionEl.classList.remove('hidden');
meNameEl.textContent = 'OFFLINE';
renderWorldCards();
addSystemLine('Mode solo local: chat et commandes actifs. Tape /help');
