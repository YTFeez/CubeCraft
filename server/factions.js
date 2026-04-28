const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'factions.json');
const NAME_RE = /^[a-zA-Z0-9 _-]{3,24}$/;

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { nextId: 1, factions: {}, invites: {} };
let saveTimer = null;

function normalize(name) {
  return String(name || '').trim();
}
function lower(name) {
  return normalize(name).toLowerCase();
}
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(FILE, JSON.stringify(db, null, 2), () => {});
  }, 400);
}
function load() {
  if (!fs.existsSync(FILE)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (raw && typeof raw === 'object') db = { nextId: 1, factions: {}, invites: {}, ...raw };
  } catch {}
}
function stateFor(username) {
  const u = normalize(username);
  const faction = getFactionByMember(u);
  const invite = db.invites[lower(u)] || null;
  return { faction, invite };
}
function getFactionByMember(username) {
  const u = lower(username);
  for (const f of Object.values(db.factions)) {
    if (Array.isArray(f.members) && f.members.some(m => lower(m) === u)) {
      return {
        id: f.id,
        name: f.name,
        owner: f.owner,
        members: [...f.members],
        role: lower(f.owner) === u ? 'owner' : 'member',
        createdAt: f.createdAt,
      };
    }
  }
  return null;
}
function createFaction(ownerName, factionName) {
  const owner = normalize(ownerName);
  const name = normalize(factionName);
  if (!NAME_RE.test(name)) return { ok: false, error: 'Nom de faction invalide (3-24).' };
  if (getFactionByMember(owner)) return { ok: false, error: 'Tu es déjà dans une faction.' };
  const nameLower = lower(name);
  for (const f of Object.values(db.factions)) {
    if (lower(f.name) === nameLower) return { ok: false, error: 'Ce nom de faction existe déjà.' };
  }
  const id = `fac_${db.nextId++}`;
  db.factions[id] = { id, name, owner, members: [owner], createdAt: Date.now() };
  delete db.invites[lower(owner)];
  scheduleSave();
  return { ok: true, faction: getFactionByMember(owner) };
}
function leaveFaction(username) {
  const u = normalize(username);
  const f = getFactionByMember(u);
  if (!f) return { ok: false, error: 'Tu n’es dans aucune faction.' };
  const ref = db.factions[f.id];
  ref.members = ref.members.filter(m => lower(m) !== lower(u));
  if (lower(ref.owner) === lower(u)) {
    if (ref.members.length > 0) ref.owner = ref.members[0];
    else delete db.factions[ref.id];
  } else if (ref.members.length === 0) {
    delete db.factions[ref.id];
  }
  scheduleSave();
  return { ok: true };
}
function invite(ownerName, targetName) {
  const owner = normalize(ownerName);
  const target = normalize(targetName);
  const f = getFactionByMember(owner);
  if (!f) return { ok: false, error: 'Tu n’es dans aucune faction.' };
  if (lower(f.owner) !== lower(owner)) return { ok: false, error: 'Seul le chef peut inviter.' };
  if (getFactionByMember(target)) return { ok: false, error: 'Ce joueur est déjà en faction.' };
  db.invites[lower(target)] = { factionId: f.id, factionName: f.name, from: owner, ts: Date.now() };
  scheduleSave();
  return { ok: true };
}
function acceptInvite(username) {
  const u = normalize(username);
  if (getFactionByMember(u)) return { ok: false, error: 'Quitte ta faction actuelle d’abord.' };
  const inv = db.invites[lower(u)];
  if (!inv) return { ok: false, error: 'Aucune invitation en attente.' };
  const f = db.factions[inv.factionId];
  if (!f) {
    delete db.invites[lower(u)];
    return { ok: false, error: 'Invitation expirée.' };
  }
  if (!f.members.some(m => lower(m) === lower(u))) f.members.push(u);
  delete db.invites[lower(u)];
  scheduleSave();
  return { ok: true, faction: getFactionByMember(u) };
}
function declineInvite(username) {
  const u = normalize(username);
  if (!db.invites[lower(u)]) return { ok: false, error: 'Aucune invitation en attente.' };
  delete db.invites[lower(u)];
  scheduleSave();
  return { ok: true };
}
function kick(ownerName, targetName) {
  const owner = normalize(ownerName);
  const target = normalize(targetName);
  const f = getFactionByMember(owner);
  if (!f) return { ok: false, error: 'Tu n’es dans aucune faction.' };
  if (lower(f.owner) !== lower(owner)) return { ok: false, error: 'Seul le chef peut kick.' };
  if (lower(owner) === lower(target)) return { ok: false, error: 'Utilise “Quitter faction”.' };
  const ref = db.factions[f.id];
  const before = ref.members.length;
  ref.members = ref.members.filter(m => lower(m) !== lower(target));
  if (ref.members.length === before) return { ok: false, error: 'Joueur non trouvé dans la faction.' };
  scheduleSave();
  return { ok: true };
}
function transfer(ownerName, targetName) {
  const owner = normalize(ownerName);
  const target = normalize(targetName);
  const f = getFactionByMember(owner);
  if (!f) return { ok: false, error: 'Tu n’es dans aucune faction.' };
  if (lower(f.owner) !== lower(owner)) return { ok: false, error: 'Seul le chef peut transférer.' };
  const ref = db.factions[f.id];
  if (!ref.members.some(m => lower(m) === lower(target))) return { ok: false, error: 'Ce joueur n’est pas dans la faction.' };
  ref.owner = ref.members.find(m => lower(m) === lower(target)) || target;
  scheduleSave();
  return { ok: true };
}
function removeMember(username) {
  leaveFaction(username);
  delete db.invites[lower(username)];
  scheduleSave();
}
function saveSync() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

load();

module.exports = {
  stateFor,
  createFaction,
  leaveFaction,
  invite,
  acceptInvite,
  declineInvite,
  kick,
  transfer,
  removeMember,
  saveSync,
};
