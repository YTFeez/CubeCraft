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
      };
      room.players.set(playerId, player);

      send({
        type: 'welcome',
        you: { id: playerId, name, color },
        room: { id: room.id, name: room.name, seed: room.seed },
        timeOfDay: globalTimeOfDay,
        edits: room.edits,
        spawn: saved.x != null
          ? { x: saved.x, y: saved.y, z: saved.z, yaw: saved.yaw || 0, pitch: saved.pitch || 0, slot: saved.slot || 0 }
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
      case 'chat': {
        const text = (msg.text || '').toString().slice(0, 200);
        if (!text) return;
        broadcast(room, { type: 'chat', from: me.name, color: me.color, text });
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
