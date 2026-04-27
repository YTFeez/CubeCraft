// Cubecraft multiplayer server: serves the static client and runs a WebSocket
// hub that synchronises 4 themed worlds (rooms) between connected players.
//
// Each room is fully procedural on the client side (seed-based generation), so
// the server only stores: edits (block modifications), current time of day and
// the list of connected players. Bandwidth stays minimal.

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const accounts = require('./server/accounts');

const PORT = process.env.PORT || 8080;
const SAVE_DIR = path.join(__dirname, 'world-saves');
const SAVE_INTERVAL_MS = 30_000;
const DAY_LENGTH_S = 240; // one in-game day = 240 real seconds
const GLOBAL_TIME_FILE = path.join(SAVE_DIR, '_global-time.json');

// Admin accounts get access to /commands. Default: just "EXE". Override with
// the ADMIN_USERS env var (comma-separated, e.g. "EXE,Mod1,Mod2").
const ADMIN_USERS = (process.env.ADMIN_USERS || 'EXE')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function isAdmin(username) {
  return !!username && ADMIN_USERS.includes(username.toLowerCase());
}

// --- Themes (server only needs id + seed; everything visual is client-side) ---
const ROOMS = [
  { id: 'faction', name: 'Faction',           seed: 'faction-2026' },
  { id: 'minage',  name: 'Minage',            seed: 'minage-2026'  },
  { id: 'event',   name: 'Événement',         seed: 'event-2026'   },
  { id: 'pvp',     name: 'Mini-jeux & PvP',   seed: 'pvp-2026'     },
];

// --- Persistent state ---
if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });

// Single time-of-day shared by *all* rooms. Restored from disk on boot, ticked
// by the server itself so it never drifts and is identical for every player.
let globalTimeOfDay = 0.3;
let globalTimeDirty = false;
try {
  if (fs.existsSync(GLOBAL_TIME_FILE)) {
    const data = JSON.parse(fs.readFileSync(GLOBAL_TIME_FILE, 'utf8'));
    if (typeof data.t === 'number') globalTimeOfDay = ((data.t % 1) + 1) % 1;
  }
} catch {}

function loadRoom(roomDef) {
  const file = path.join(SAVE_DIR, `${roomDef.id}.json`);
  let edits = {};
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      edits = data.edits || {};
    } catch (e) {
      console.warn(`[${roomDef.id}] save illisible:`, e.message);
    }
  }
  return {
    ...roomDef,
    edits,             // { "cx,cz": { "lx,ly,lz": blockId, ... }, ... }
    players: new Map(),// id -> { ws, name, x, y, z, yaw, pitch, color }
    dirty: false,
  };
}

const rooms = new Map(ROOMS.map(r => [r.id, loadRoom(r)]));

function saveRoom(room) {
  if (!room.dirty) return;
  const file = path.join(SAVE_DIR, `${room.id}.json`);
  const data = { edits: room.edits, savedAt: Date.now() };
  fs.writeFile(file, JSON.stringify(data), err => {
    if (err) console.warn(`[${room.id}] save error:`, err.message);
  });
  room.dirty = false;
}

function saveGlobalTime() {
  if (!globalTimeDirty) return;
  fs.writeFile(GLOBAL_TIME_FILE, JSON.stringify({ t: globalTimeOfDay }), () => {});
  globalTimeDirty = false;
}

setInterval(() => {
  for (const r of rooms.values()) saveRoom(r);
  saveGlobalTime();
}, SAVE_INTERVAL_MS);

// Server-driven clock: tick once per second, broadcast to everyone every 5s.
const TIME_TICK_MS = 1000;
setInterval(() => {
  globalTimeOfDay = (globalTimeOfDay + (TIME_TICK_MS / 1000) / DAY_LENGTH_S) % 1;
  globalTimeDirty = true;
}, TIME_TICK_MS);

// --- Express ---
const app = express();
app.use(express.json({ limit: '64kb' }));

// --- Auth endpoints ---
app.post('/api/register', (req, res) => {
  const { name, password } = req.body || {};
  const r = accounts.register(name, password);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ name: r.name, token: r.token });
});

app.post('/api/login', (req, res) => {
  const { name, password } = req.body || {};
  const r = accounts.login(name, password);
  if (!r.ok) return res.status(401).json({ error: r.error });
  res.json({ name: r.name, token: r.token });
});

app.post('/api/logout', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  accounts.logout(token);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const u = accounts.getUserByToken(token);
  if (!u) return res.status(401).json({ error: 'Token invalide' });
  res.json({ name: u.name, createdAt: u.createdAt });
});

app.use(express.static(__dirname, {
  // No client cache for now: the project is being iterated on actively, and
  // a stale main.js would silently break the selection screen.
  setHeaders: (res, filePath) => {
    if (
      filePath.endsWith('.html') ||
      filePath.endsWith('.js') ||
      filePath.endsWith('.css')
    ) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

// Lightweight info endpoint (used by the world-selection screen).
app.get('/api/rooms', (req, res) => {
  const out = ROOMS.map(r => {
    const room = rooms.get(r.id);
    return {
      id: r.id,
      name: r.name,
      players: room.players.size,
      editCount: Object.values(room.edits).reduce((acc, m) => acc + Object.keys(m).length, 0),
    };
  });
  res.json({ rooms: out });
});

const server = http.createServer(app);

// --- WebSocket hub ---
const wss = new WebSocketServer({ server, path: '/ws' });

let nextPlayerId = 1;
const PLAYER_COLORS = ['#ff7676', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#f78c6b', '#7bdff2', '#b5ead7'];

// =========================================================================
// ADMIN COMMANDS
// =========================================================================

const ADMIN_HELP = [
  '/help — affiche cette aide',
  '/list — liste tous les joueurs en ligne (tous les mondes)',
  '/tp <pseudo> — te téléporte vers ce joueur (même monde)',
  '/tphere <pseudo> — téléporte ce joueur vers toi (même monde)',
  '/time <0-23 | day | night | morning | sunset> — règle l\'heure pour tous les mondes',
  '/say <texte> — message en gold dans le chat de ce monde',
  '/announce <texte> — message diffusé dans tous les mondes',
  '/kick <pseudo> — déconnecte ce joueur',
  '/clear — réinitialise les blocs cassés/posés du monde courant',
].join('\n');

function sendSystem(send, text, color = '#9aa5b1') {
  send({ type: 'system', text, color });
}

function findPlayerInRoom(room, name) {
  const lower = name.toLowerCase();
  for (const p of room.players.values()) {
    if (p.username && p.username.toLowerCase() === lower) return p;
    if (p.name && p.name.toLowerCase() === lower) return p;
  }
  return null;
}

function findPlayerEverywhere(name) {
  const lower = name.toLowerCase();
  for (const r of rooms.values()) {
    for (const p of r.players.values()) {
      if (p.username && p.username.toLowerCase() === lower) return { room: r, player: p };
      if (p.name && p.name.toLowerCase() === lower) return { room: r, player: p };
    }
  }
  return null;
}

function parseTimeArg(arg) {
  const a = (arg || '').trim().toLowerCase();
  if (!a) return null;
  const presets = {
    'midnight': 0.0, 'minuit': 0.0, 'night': 0.0, 'nuit': 0.0,
    'morning': 0.25, 'matin': 0.25, 'sunrise': 0.25, 'aube': 0.25,
    'noon': 0.5, 'midi': 0.5, 'day': 0.5, 'jour': 0.5,
    'sunset': 0.75, 'soir': 0.75, 'evening': 0.75, 'crepuscule': 0.75,
  };
  if (a in presets) return presets[a];
  // Accept "13", "13.5", or "13:30"
  if (/^\d{1,2}:\d{1,2}$/.test(a)) {
    const [h, m] = a.split(':').map(Number);
    return ((h + m / 60) / 24) % 1;
  }
  const n = parseFloat(a);
  if (!isNaN(n)) {
    if (n >= 0 && n < 24) return (n / 24) % 1;
    if (n >= 0 && n <= 1) return n;
  }
  return null;
}

function broadcastEverywhere(obj) {
  const text = JSON.stringify(obj);
  for (const r of rooms.values()) {
    for (const p of r.players.values()) {
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(text);
    }
  }
}

function handleCommand(send, broadcast, me, room, body) {
  const [cmdRaw, ...rest] = body.trim().split(/\s+/);
  const cmd = (cmdRaw || '').toLowerCase();
  const arg = rest.join(' ');

  if (cmd === 'help') {
    if (isAdmin(me.username)) sendSystem(send, ADMIN_HELP);
    else sendSystem(send, 'Aucune commande disponible (compte non-admin).');
    return;
  }

  if (!isAdmin(me.username)) {
    sendSystem(send, `Commande inconnue: /${cmd}`, '#ff8080');
    return;
  }

  switch (cmd) {
    case 'list': {
      const lines = [];
      for (const r of rooms.values()) {
        if (r.players.size === 0) continue;
        const names = Array.from(r.players.values()).map(p => p.name).join(', ');
        lines.push(`[${r.name}] ${r.players.size} : ${names}`);
      }
      sendSystem(send, lines.length ? lines.join('\n') : 'Aucun joueur en ligne.', '#9aa5b1');
      break;
    }
    case 'tp': {
      if (!arg) return sendSystem(send, 'Usage: /tp <pseudo>', '#ff8080');
      const target = findPlayerInRoom(room, arg);
      if (!target) return sendSystem(send, `"${arg}" introuvable dans ce monde.`, '#ff8080');
      send({ type: 'teleport', x: target.x, y: target.y + 0.1, z: target.z });
      sendSystem(send, `→ Téléporté vers ${target.name}.`, '#7fd87f');
      break;
    }
    case 'tphere': {
      if (!arg) return sendSystem(send, 'Usage: /tphere <pseudo>', '#ff8080');
      const target = findPlayerInRoom(room, arg);
      if (!target) return sendSystem(send, `"${arg}" introuvable dans ce monde.`, '#ff8080');
      if (target.ws.readyState === target.ws.OPEN) {
        target.ws.send(JSON.stringify({ type: 'teleport', x: me.x, y: me.y + 0.1, z: me.z }));
      }
      sendSystem(send, `→ ${target.name} téléporté vers toi.`, '#7fd87f');
      break;
    }
    case 'time': {
      const t = parseTimeArg(arg);
      if (t == null) return sendSystem(send, 'Usage: /time <0-23 | day | night | morning | sunset>', '#ff8080');
      globalTimeOfDay = t;
      globalTimeDirty = true;
      broadcastEverywhere({ type: 'timeSync', t: globalTimeOfDay });
      const hh = Math.floor(t * 24);
      const mm = Math.floor((t * 24 - hh) * 60);
      sendSystem(send, `Heure réglée à ${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} (tous les mondes).`, '#7fd87f');
      break;
    }
    case 'say': {
      if (!arg) return;
      broadcast(room, { type: 'chat', from: me.name + ' [ADMIN]', color: '#ffd166', text: arg });
      break;
    }
    case 'announce': case 'broadcast': {
      if (!arg) return;
      broadcastEverywhere({ type: 'announce', from: me.name, text: arg });
      break;
    }
    case 'kick': {
      if (!arg) return sendSystem(send, 'Usage: /kick <pseudo>', '#ff8080');
      const found = findPlayerEverywhere(arg);
      if (!found) return sendSystem(send, `"${arg}" introuvable.`, '#ff8080');
      try {
        found.player.ws.send(JSON.stringify({ type: 'system', text: `Tu as été kické par ${me.name}.`, color: '#ff8080' }));
      } catch {}
      try { found.player.ws.close(); } catch {}
      sendSystem(send, `${found.player.name} a été kické.`, '#7fd87f');
      break;
    }
    case 'clear': {
      const count = Object.values(room.edits).reduce((acc, m) => acc + Object.keys(m).length, 0);
      room.edits = {};
      room.dirty = true;
      // Force everyone in this room to reload their session.
      const text = JSON.stringify({ type: 'worldReset', message: `${me.name} a réinitialisé "${room.name}".` });
      for (const p of room.players.values()) {
        if (p.ws.readyState === p.ws.OPEN) p.ws.send(text);
      }
      sendSystem(send, `${count} blocs réinitialisés. Rejoins le monde pour voir le résultat.`, '#7fd87f');
      break;
    }
    default:
      sendSystem(send, `Commande inconnue: /${cmd}. Tape /help.`, '#ff8080');
  }
}

wss.on('connection', (ws) => {
  let playerId = null;
  let room = null;

  function send(obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }
  function broadcast(roomRef, obj, exceptId = null) {
    const text = JSON.stringify(obj);
    for (const p of roomRef.players.values()) {
      if (p.id === exceptId) continue;
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(text);
    }
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'hello') {
      // Auth required.
      const user = accounts.getUserByToken(msg.token);
      if (!user) return send({ type: 'error', code: 'AUTH', message: 'Authentification requise' });

      const r = rooms.get(msg.roomId);
      if (!r) return send({ type: 'error', message: 'Monde inconnu' });

      // Prevent the same account from joining the same world twice (kick the
      // previous connection so refresh-after-disconnect just works).
      for (const [pid, existing] of r.players) {
        if (existing.username === user.name) {
          try { existing.ws.close(); } catch {}
          r.players.delete(pid);
        }
      }

      playerId = nextPlayerId++;
      room = r;
      const name = user.name;
      const color = PLAYER_COLORS[playerId % PLAYER_COLORS.length];

      // Restore last known position for this account+room (if any).
      const saved = accounts.getWorldData(name, room.id) || {};
      const player = {
        id: playerId, ws, name, color, username: name,
        x: typeof saved.x === 'number' ? saved.x : 0,
        y: typeof saved.y === 'number' ? saved.y : 80,
        z: typeof saved.z === 'number' ? saved.z : 0,
        yaw: saved.yaw || 0, pitch: saved.pitch || 0,
        slot: saved.slot | 0,
        inventory: Array.isArray(saved.inventory) ? saved.inventory : null,
        health: typeof saved.health === 'number' ? saved.health : null,
        air: typeof saved.air === 'number' ? saved.air : null,
      };
      room.players.set(playerId, player);

      send({
        type: 'welcome',
        you: { id: playerId, name, color },
        room: { id: room.id, name: room.name, seed: room.seed },
        timeOfDay: globalTimeOfDay,
        edits: room.edits,
        spawn: saved.x != null
          ? {
              x: saved.x, y: saved.y, z: saved.z,
              yaw: saved.yaw || 0, pitch: saved.pitch || 0,
              slot: saved.slot || 0,
              inventory: Array.isArray(saved.inventory) ? saved.inventory : null,
              health: typeof saved.health === 'number' ? saved.health : null,
              air: typeof saved.air === 'number' ? saved.air : null,
            }
          : null,
        players: Array.from(room.players.values())
          .filter(p => p.id !== playerId)
          .map(p => ({ id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch })),
      });

      broadcast(room, {
        type: 'playerJoin',
        player: { id: playerId, name, color, x: player.x, y: player.y, z: player.z, yaw: player.yaw, pitch: player.pitch },
      }, playerId);

      console.log(`[${room.id}] + ${name} (id=${playerId}, total=${room.players.size})`);
      return;
    }

    if (!room || playerId == null) return;
    const me = room.players.get(playerId);
    if (!me) return;

    switch (msg.type) {
      case 'move': {
        if (typeof msg.x !== 'number') return;
        me.x = msg.x; me.y = msg.y; me.z = msg.z;
        me.yaw = msg.yaw || 0; me.pitch = msg.pitch || 0;
        broadcast(room, {
          type: 'pos',
          id: playerId, x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch,
        }, playerId);
        break;
      }
      case 'edit': {
        const { cx, cz, lx, ly, lz, blockId } = msg;
        if (![cx, cz, lx, ly, lz, blockId].every(v => typeof v === 'number')) return;
        const key = `${cx},${cz}`;
        if (!room.edits[key]) room.edits[key] = {};
        const local = `${lx},${ly},${lz}`;
        if (blockId === 0) {
          // Air: keep the edit recorded so it overrides procedural terrain.
          room.edits[key][local] = 0;
        } else {
          room.edits[key][local] = blockId;
        }
        room.dirty = true;
        broadcast(room, {
          type: 'edit',
          cx, cz, lx, ly, lz, blockId,
          by: playerId,
        }); // include sender for confirmation
        break;
      }
      case 'time': {
        // Time is now server-authoritative. Ignore client-driven time updates.
        break;
      }
      case 'slot': {
        if (typeof msg.slot === 'number') me.slot = msg.slot | 0;
        break;
      }
      case 'inventory': {
        if (Array.isArray(msg.slots)) {
          // Sanitize: at most 9 slots, each { id:int>=0, count:int 0..64 }.
          me.inventory = msg.slots.slice(0, 9).map(s => {
            if (!s || typeof s.id !== 'number' || s.id < 0) return null;
            const count = Math.max(0, Math.min(64, s.count | 0));
            return count > 0 ? { id: s.id | 0, count } : null;
          });
        }
        break;
      }
      case 'health': {
        if (typeof msg.health === 'number') me.health = Math.max(0, Math.min(20, msg.health));
        if (typeof msg.air === 'number') me.air = Math.max(0, Math.min(15, msg.air));
        break;
      }
      case 'chat': {
        const text = (msg.text || '').toString().slice(0, 200);
        if (!text) return;
        if (text.startsWith('/')) {
          handleCommand(send, broadcast, me, room, text.slice(1));
        } else {
          const adminTag = isAdmin(me.username) ? ' [ADMIN]' : '';
          const color = isAdmin(me.username) ? '#ffd166' : me.color;
          broadcast(room, { type: 'chat', from: me.name + adminTag, color, text });
        }
        break;
      }
      case 'ping': {
        send({ type: 'pong', t: msg.t });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (room && playerId != null) {
      const me = room.players.get(playerId);
      if (me && me.username) {
        accounts.setWorldData(me.username, room.id, {
          x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch,
          slot: me.slot | 0,
          inventory: Array.isArray(me.inventory) ? me.inventory : undefined,
          health: typeof me.health === 'number' ? me.health : undefined,
          air: typeof me.air === 'number' ? me.air : undefined,
        });
      }
      room.players.delete(playerId);
      broadcast(room, { type: 'playerLeave', id: playerId });
      console.log(`[${room.id}] - id=${playerId} (total=${room.players.size})`);
    }
  });
});

// --- Periodic global time broadcast: every 5s, every room receives the same t ---
setInterval(() => {
  const text = JSON.stringify({ type: 'timeSync', t: globalTimeOfDay });
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    for (const p of room.players.values()) {
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(text);
    }
  }
}, 5000);

server.listen(PORT, () => {
  console.log(`Cubecraft server: http://localhost:${PORT}`);
  console.log(`WebSocket:        ws://localhost:${PORT}/ws`);
  console.log(`Rooms:            ${ROOMS.map(r => r.id).join(', ')}`);
});

// --- Graceful shutdown saves all rooms ---
function shutdown() {
  console.log('Sauvegarde en cours...');
  for (const r of rooms.values()) {
    // Save every connected player's last known position to their account.
    for (const p of r.players.values()) {
      if (p.username) {
        accounts.setWorldData(p.username, r.id, {
          x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, slot: p.slot | 0,
          inventory: Array.isArray(p.inventory) ? p.inventory : undefined,
          health: typeof p.health === 'number' ? p.health : undefined,
          air: typeof p.air === 'number' ? p.air : undefined,
        });
      }
    }
    r.dirty = true; saveRoom(r);
  }
  globalTimeDirty = true; saveGlobalTime();
  try { accounts.saveSync(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
