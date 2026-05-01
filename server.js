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
    drops: new Map(),  // dropId -> { x, y, z, vx, vy, vz, blockId, ownerId, t }
    chatHistory: [],   // derniers messages (persistants en mémoire serveur)
    nextDropId: 1,
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
  for (const r of rooms.values()) {
    saveRoom(r);
    // Periodic per-player save: snapshot every connected player so a crash or
    // a brutal disconnect doesn't lose progress (position, health, inventory…).
    for (const p of r.players.values()) {
      if (!p.username) continue;
      accounts.setWorldData(p.username, r.id, {
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, slot: p.slot | 0,
        inventory: Array.isArray(p.inventory) ? p.inventory : undefined,
        health: typeof p.health === 'number' ? p.health : undefined,
        air: typeof p.air === 'number' ? p.air : undefined,
      });
    }
  }
  saveGlobalTime();
}, SAVE_INTERVAL_MS);

// --- Item drops housekeeping ---
const DROP_LIFETIME_S = 300;
function roomBroadcast(room, obj) {
  const text = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(text);
  }
}
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    for (const [id, d] of r.drops) {
      if (now - d.spawnedAt > DROP_LIFETIME_S * 1000) {
        r.drops.delete(id);
        roomBroadcast(r, { type: 'itemDespawn', dropId: id });
      }
    }
  }
}, 5000);

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

// Permanently delete the calling user. Drops them from every room they may
// be connected to, then wipes their account data.
app.delete('/api/account', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const u = accounts.getUserByToken(token);
  if (!u) return res.status(401).json({ error: 'Token invalide' });
  const username = u.name;
  // Kick out of every room.
  for (const r of rooms.values()) {
    for (const [pid, p] of r.players) {
      if (p.username === username) {
        try { p.ws.close(); } catch {}
        r.players.delete(pid);
        roomBroadcast(r, { type: 'playerLeave', id: pid });
      }
    }
  }
  accounts.deleteAccount(username);
  res.json({ ok: true });
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
// Use manual upgrade handling so reverse proxies / trailing slashes never break
// the handshake (Render can forward `/ws` or `/ws/` depending on edge pathing).
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {}
  const ok =
    pathname === '/ws' ||
    pathname === '/ws/' ||
    pathname === '/';
  if (!ok) {
    try { socket.destroy(); } catch {}
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

let nextPlayerId = 1;
const PLAYER_COLORS = ['#ff7676', '#ffd166', '#06d6a0', '#118ab2', '#c77dff', '#f78c6b', '#7bdff2', '#b5ead7'];

// =========================================================================
// ADMIN COMMANDS
// =========================================================================

const ADMIN_HELP_LINES = [
  '/help, /h — affiche cette aide',
  '/cmds, /commands, /? — alias disponibles',
  '/list, /who, /online — joueurs en ligne',
  '/here, /where — infos du monde courant',
  '/tp <pseudo> — te téléporte vers ce joueur',
  '/tphere <pseudo> — téléporte ce joueur vers toi',
  '/find <pseudo> — indique le monde d\'un joueur',
  '/time <0-23|preset>, /settime <...> — règle l\'heure globale',
  '/day, /night, /morning, /sunset, /midnight — presets rapides',
  '/say <texte> — message admin dans ce monde',
  '/announce <texte> — annonce dans tous les mondes',
  '/me <action> — emote',
  '/kick <pseudo> — déconnecte un joueur',
  '/clear, /resetworld — reset les edits du monde',
  '/count, /players — nb de joueurs par monde',
  '/worlds — liste les mondes',
].join('\n');
const ADMIN_HELP = ADMIN_HELP_LINES;

const COMMAND_ALIASES = {
  help: ['h', '?', 'aide', 'commands', 'cmds', 'adminhelp'],
  list: ['who', 'online', 'players', 'joueurs', 'listall', 'whois', 'lsplayers'],
  here: ['where', 'room', 'monde', 'world', 'roominfo', 'worldinfo'],
  worlds: ['rooms', 'maps', 'mondes', 'worldlist', 'roomlist'],
  count: ['playercount', 'pc', 'census', 'pop'],
  tp: ['teleport', 'goto', 'warp', 'jumpto'],
  tphere: ['bring', 'summon', 'pull', 'tpbring', 'comehere'],
  find: ['whereis', 'locate', 'findplayer', 'lookup'],
  time: ['settime', 'heure', 'clock', 'timeof', 'timeofday'],
  day: ['jour', 'sunrise2', 'time_day'],
  night: ['nuit', 'time_night'],
  morning: ['matin', 'dawn', 'sunrise', 'time_morning'],
  sunset: ['soir', 'evening', 'dusk', 'time_sunset'],
  midnight: ['minuit', 'time_midnight'],
  say: ['s', 'chatadmin', 'speak', 'talk', 'msgworld'],
  announce: ['broadcast', 'bc', 'global', 'all', 'shout', 'news'],
  me: ['emote', 'action', 'pose'],
  kick: ['k', 'boot', 'disconnect', 'remove'],
  clear: ['resetworld', 'reset', 'wipe', 'clean', 'purge', 'clearworld'],
};

const COMMAND_ALIASES_INDEX = (() => {
  const m = new Map();
  for (const [base, aliases] of Object.entries(COMMAND_ALIASES)) {
    m.set(base, base);
    for (const a of aliases) m.set(a, base);
  }
  return m;
})();

const PUBLIC_COMMANDS = ['/help'];
const ADMIN_COMMANDS = Array.from(new Set(
  Object.entries(COMMAND_ALIASES).flatMap(([base, aliases]) =>
    [base, ...aliases].map(c => `/${c}`))
));

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

function normalizeCommand(cmdRaw) {
  const key = (cmdRaw || '').toLowerCase().trim();
  return COMMAND_ALIASES_INDEX.get(key) || key;
}

function pushRoomChat(room, entry) {
  if (!room.chatHistory) room.chatHistory = [];
  room.chatHistory.push(entry);
  if (room.chatHistory.length > 120) room.chatHistory.splice(0, room.chatHistory.length - 120);
}

function handleCommand(send, broadcast, me, room, body) {
  const [cmdRaw, ...rest] = body.trim().split(/\s+/);
  const cmd = normalizeCommand(cmdRaw);
  const arg = rest.join(' ');

  if (cmd === 'help') {
    if (isAdmin(me.username)) {
      sendSystem(send, ADMIN_HELP);
      sendSystem(send, `Alias admin actifs: ${ADMIN_COMMANDS.length}`, '#9aa5b1');
    }
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
    case 'here': {
      sendSystem(send, `Monde: ${room.name} (${room.id}) · joueurs: ${room.players.size} · edits: ${Object.keys(room.edits).length}`, '#9aa5b1');
      break;
    }
    case 'worlds': {
      const lines = Array.from(rooms.values()).map(r => `${r.name} (${r.id}) — ${r.players.size} joueurs`);
      sendSystem(send, lines.join('\n'), '#9aa5b1');
      break;
    }
    case 'count': {
      const total = Array.from(rooms.values()).reduce((a, r) => a + r.players.size, 0);
      sendSystem(send, `Total en ligne: ${total}`, '#9aa5b1');
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
    case 'find': {
      if (!arg) return sendSystem(send, 'Usage: /find <pseudo>', '#ff8080');
      const found = findPlayerEverywhere(arg);
      if (!found) return sendSystem(send, `"${arg}" introuvable.`, '#ff8080');
      sendSystem(send, `${found.player.name} est dans ${found.room.name} (${found.room.id}).`, '#7fd87f');
      break;
    }
    case 'day': globalTimeOfDay = 0.5; globalTimeDirty = true; broadcastEverywhere({ type: 'timeSync', t: globalTimeOfDay }); sendSystem(send, 'Heure réglée: jour.', '#7fd87f'); break;
    case 'night': globalTimeOfDay = 0.0; globalTimeDirty = true; broadcastEverywhere({ type: 'timeSync', t: globalTimeOfDay }); sendSystem(send, 'Heure réglée: nuit.', '#7fd87f'); break;
    case 'morning': globalTimeOfDay = 0.25; globalTimeDirty = true; broadcastEverywhere({ type: 'timeSync', t: globalTimeOfDay }); sendSystem(send, 'Heure réglée: matin.', '#7fd87f'); break;
    case 'sunset': globalTimeOfDay = 0.75; globalTimeDirty = true; broadcastEverywhere({ type: 'timeSync', t: globalTimeOfDay }); sendSystem(send, 'Heure réglée: coucher du soleil.', '#7fd87f'); break;
    case 'midnight': globalTimeOfDay = 0.0; globalTimeDirty = true; broadcastEverywhere({ type: 'timeSync', t: globalTimeOfDay }); sendSystem(send, 'Heure réglée: minuit.', '#7fd87f'); break;
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
      const payload = { type: 'chat', from: me.name + ' [ADMIN]', color: '#ffd166', text: arg };
      pushRoomChat(room, { type: 'chat', from: payload.from, color: payload.color, text: payload.text, ts: Date.now() });
      broadcast(room, payload);
      break;
    }
    case 'announce': case 'broadcast': {
      if (!arg) return;
      broadcastEverywhere({ type: 'announce', from: me.name, text: arg });
      break;
    }
    case 'me': {
      if (!arg) return;
      const payload = { type: 'chat', from: '*', color: '#ffd166', text: `${me.name} ${arg}` };
      pushRoomChat(room, { type: 'chat', from: payload.from, color: payload.color, text: payload.text, ts: Date.now() });
      broadcast(room, payload);
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

      // Snapshot all currently-active drops so the joining client can render
      // them immediately. Ages are computed from spawnedAt.
      const nowT = Date.now();
      const dropsSnapshot = Array.from(room.drops.values()).map(d => ({
        dropId: d.dropId,
        x: d.x, y: d.y, z: d.z,
        vx: 0, vy: 0, vz: 0, // freeze on spawn for late joiners
        blockId: d.blockId,
        ownerId: d.ownerId,
        t: (nowT - d.spawnedAt) / 1000,
      }));

      send({
        type: 'welcome',
        you: { id: playerId, name, color },
        room: { id: room.id, name: room.name, seed: room.seed },
        commandList: isAdmin(name) ? ADMIN_COMMANDS : PUBLIC_COMMANDS,
        recentChat: room.chatHistory || [],
        timeOfDay: globalTimeOfDay,
        edits: room.edits,
        drops: dropsSnapshot,
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
          // Sanitize: up to 36 slots (9 hotbar + 27 main), each { id:int>=0,
          // count:int 0..64 }. Older clients only send 9; that's still fine.
          me.inventory = msg.slots.slice(0, 36).map(s => {
            if (!s || typeof s.id !== 'number' || s.id < 0) return null;
            const count = Math.max(0, Math.min(64, s.count | 0));
            return count > 0 ? { id: s.id | 0, count } : null;
          });
        }
        break;
      }
      case 'dropItem': {
        // Spawn a new item drop visible to everyone in the room. We trust the
        // client's spawn position (it's guarded by the local raycast/inventory
        // logic) but cap the velocity so a malicious client can't fling drops
        // across the world.
        if (typeof msg.blockId !== 'number') return;
        const cap = (v, m) => Math.max(-m, Math.min(m, +v || 0));
        const dropId = room.nextDropId++;
        const drop = {
          dropId,
          x: +msg.x || me.x,
          y: +msg.y || me.y,
          z: +msg.z || me.z,
          vx: cap(msg.vx, 8),
          vy: cap(msg.vy, 8),
          vz: cap(msg.vz, 8),
          blockId: msg.blockId | 0,
          ownerId: playerId,
          spawnedAt: Date.now(),
        };
        room.drops.set(dropId, drop);
        roomBroadcast(room, {
          type: 'itemSpawn',
          dropId, x: drop.x, y: drop.y, z: drop.z,
          vx: drop.vx, vy: drop.vy, vz: drop.vz,
          blockId: drop.blockId, ownerId: drop.ownerId, t: 0,
        });
        break;
      }
      case 'pickup': {
        const dropId = msg.dropId | 0;
        const drop = room.drops.get(dropId);
        if (!drop) return;
        // 0.6s grace period for the dropper to walk away from their own item.
        if (drop.ownerId === playerId && (Date.now() - drop.spawnedAt) < 600) return;
        room.drops.delete(dropId);
        roomBroadcast(room, { type: 'itemDespawn', dropId, by: playerId });
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
          pushRoomChat(room, { type: 'chat', from: me.name + adminTag, color, text, ts: Date.now() });
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
