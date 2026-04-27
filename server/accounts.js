// Account storage with PBKDF2-hashed passwords. Single JSON file on disk so we
// stay dependency-free.
//
// File layout (data/users.json):
// {
//   "users": {
//     "alice": {
//       "name": "alice",
//       "salt": "<hex>",
//       "hash": "<hex>",
//       "createdAt": 12345,
//       "tokens": ["<hex>", ...],
//       "worldData": {
//         "<roomId>": { "x": 1, "y": 2, "z": 3, "yaw": 0, "pitch": 0, "slot": 0 }
//       }
//     }
//   }
// }

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

const NAME_RE = /^[a-zA-Z0-9_-]{3,16}$/;
const PBKDF2_ITERS = 120_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { users: {} };
let saveTimer = null;

function loadFromDisk() {
  if (fs.existsSync(USERS_FILE)) {
    try {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      db = JSON.parse(raw);
      if (!db.users) db.users = {};
    } catch (e) {
      console.warn('users.json illisible, recréation:', e.message);
      db = { users: {} };
    }
  }
}

function flush() {
  fs.writeFile(USERS_FILE, JSON.stringify(db, null, 2), err => {
    if (err) console.warn('Sauvegarde comptes échouée:', err.message);
  });
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; flush(); }, 500);
}

function saveSync() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return { salt, hash };
}

function constantTimeEqual(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

// --- Public API ---

function register(rawName, password) {
  const name = (rawName || '').trim();
  if (!NAME_RE.test(name)) {
    return { ok: false, error: 'Pseudo invalide (3-16 caractères, lettres/chiffres/_/-).' };
  }
  if (typeof password !== 'string' || password.length < 4 || password.length > 64) {
    return { ok: false, error: 'Mot de passe entre 4 et 64 caractères.' };
  }
  const lower = name.toLowerCase();
  // Case-insensitive uniqueness.
  for (const existingKey of Object.keys(db.users)) {
    if (existingKey.toLowerCase() === lower) {
      return { ok: false, error: 'Pseudo déjà pris.' };
    }
  }
  const { salt, hash } = hashPassword(password);
  const token = newToken();
  db.users[name] = {
    name,
    salt, hash,
    createdAt: Date.now(),
    tokens: [token],
    worldData: {},
  };
  scheduleSave();
  return { ok: true, name, token };
}

function login(rawName, password) {
  const name = (rawName || '').trim();
  // Find user case-insensitively but keep canonical casing.
  let canonical = null;
  const lower = name.toLowerCase();
  for (const k of Object.keys(db.users)) {
    if (k.toLowerCase() === lower) { canonical = k; break; }
  }
  if (!canonical) return { ok: false, error: 'Pseudo ou mot de passe incorrect.' };
  const u = db.users[canonical];
  const { hash } = hashPassword(password, u.salt);
  if (!constantTimeEqual(hash, u.hash)) {
    return { ok: false, error: 'Pseudo ou mot de passe incorrect.' };
  }
  const token = newToken();
  if (!u.tokens) u.tokens = [];
  u.tokens.push(token);
  // Cap tokens per user to avoid unbounded growth.
  if (u.tokens.length > 10) u.tokens = u.tokens.slice(-10);
  scheduleSave();
  return { ok: true, name: u.name, token };
}

function logout(token) {
  if (!token) return;
  for (const u of Object.values(db.users)) {
    if (u.tokens && u.tokens.includes(token)) {
      u.tokens = u.tokens.filter(t => t !== token);
      scheduleSave();
      return true;
    }
  }
  return false;
}

function getUserByToken(token) {
  if (!token) return null;
  for (const u of Object.values(db.users)) {
    if (u.tokens && u.tokens.includes(token)) return u;
  }
  return null;
}

function getWorldData(name, roomId) {
  const u = db.users[name];
  if (!u || !u.worldData) return null;
  return u.worldData[roomId] || null;
}

function setWorldData(name, roomId, data) {
  const u = db.users[name];
  if (!u) return;
  if (!u.worldData) u.worldData = {};
  // Merge so callers can update partial fields without erasing the rest.
  const prev = u.worldData[roomId] || {};
  const merged = { ...prev };
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined) merged[k] = v;
  }
  u.worldData[roomId] = merged;
  scheduleSave();
}

loadFromDisk();

module.exports = {
  register,
  login,
  logout,
  getUserByToken,
  getWorldData,
  setWorldData,
  saveSync,
};
