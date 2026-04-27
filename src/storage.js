const KEY = 'cubecraft-save-v1';

export function saveWorld(world, player, timeOfDay) {
  const data = {
    ...world.serializeEdits(),
    player: {
      pos: [player.position.x, player.position.y, player.position.z],
      yaw: player.yaw,
      pitch: player.pitch,
    },
    time: timeOfDay,
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('Sauvegarde impossible', e);
    return false;
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSave() {
  localStorage.removeItem(KEY);
}
