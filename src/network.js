// WebSocket client. Handles connection, optimistic block edits, and
// dispatches server messages to the game.

export class Network {
  constructor({ url, roomId, name, token, handlers }) {
    this.url = url;
    this.roomId = roomId;
    this.name = name;
    this.token = token;
    this.handlers = handlers;
    this.ws = null;
    this.connected = false;
    this.you = null;
    this.lastSentPos = null;
    this.lastSentTime = 0;
    this.posInterval = 80; // ms between position updates
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      let resolved = false;

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          type: 'hello',
          roomId: this.roomId,
          name: this.name,
          token: this.token,
        }));
      });

      ws.addEventListener('message', (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'welcome') {
          this.connected = true;
          this.you = msg.you;
          if (!resolved) { resolved = true; resolve(msg); }
        }
        const fn = this.handlers[msg.type];
        if (fn) fn(msg);
      });

      ws.addEventListener('close', () => {
        this.connected = false;
        if (!resolved) { resolved = true; reject(new Error('connection fermée')); }
        if (this.handlers.disconnected) this.handlers.disconnected();
      });

      ws.addEventListener('error', (e) => {
        if (!resolved) { resolved = true; reject(e); }
      });
    });
  }

  disconnect() {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendPos(x, y, z, yaw, pitch) {
    const now = performance.now();
    if (now - this.lastSentTime < this.posInterval) return;
    // Skip if no significant change.
    if (this.lastSentPos) {
      const [px, py, pz, pyaw, ppitch] = this.lastSentPos;
      if (Math.abs(px - x) < 0.02 && Math.abs(py - y) < 0.02 && Math.abs(pz - z) < 0.02
          && Math.abs(pyaw - yaw) < 0.02 && Math.abs(ppitch - pitch) < 0.02) {
        return;
      }
    }
    this.lastSentTime = now;
    this.lastSentPos = [x, y, z, yaw, pitch];
    this.send({ type: 'move', x, y, z, yaw, pitch });
  }

  sendEdit(cx, cz, lx, ly, lz, blockId) {
    this.send({ type: 'edit', cx, cz, lx, ly, lz, blockId });
  }

  sendTime(t) { this.send({ type: 'time', t }); }

  sendChat(text) { this.send({ type: 'chat', text }); }

  sendSlot(slot) { this.send({ type: 'slot', slot }); }

  sendInventory(slots) { this.send({ type: 'inventory', slots }); }

  sendHealth(health, air) { this.send({ type: 'health', health, air }); }

  sendDropItem(drop) { this.send({ type: 'dropItem', ...drop }); }

  sendPickup(dropId) { this.send({ type: 'pickup', dropId }); }
}
