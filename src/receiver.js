const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { SessionStateMachine } = require('./state');
const { publishSnapshot } = require('./cat-office-client');
const { findDesktopProcess } = require('./codex-process');
const { SOCKET_PATH, OFFICE_URL, localToken } = require('./runtime-config');

class Adapter {
  constructor({ processFinder = findDesktopProcess, publish = publishSnapshot,
                socketPath = SOCKET_PATH, officeUrl = OFFICE_URL, token = localToken(),
                processPollMs = 1000, heartbeatMs = 5000 } = {}) {
    this.processFinder = processFinder;
    this.publish = publish;
    this.socketPath = socketPath;
    this.officeUrl = officeUrl;
    this.token = token;
    this.processPollMs = processPollMs;
    this.heartbeatMs = heartbeatMs;
    this.state = new SessionStateMachine();
    this.desktop = null;
    this.server = null;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.dirty = false;
    this.sending = null;
    this.scanSequence = 0;
  }

  async refreshProcess() {
    const sequence = ++this.scanSequence;
    const next = await this.processFinder();
    if (sequence !== this.scanSequence) return this.desktop;
    const nextId = next?.id ?? null;
    this.desktop = next;
    if (this.state.setProcess(nextId)) this.requestPublish();
    return next;
  }

  async receive(message) {
    if (!message || !Number.isInteger(message.parentPid) ||
        typeof message.occurredAt !== 'string' || !message.event) return false;
    if (!this.desktop || message.parentPid !== this.desktop.appServerPid) {
      try { await this.refreshProcess(); } catch { return false; }
    }
    if (!this.desktop || message.parentPid !== this.desktop.appServerPid) return false;
    if (Number.isFinite(this.desktop.appServerStartedAt) &&
        Date.parse(message.occurredAt) < this.desktop.appServerStartedAt) return false;
    const changed = this.state.apply(message.event, {
      processId: this.desktop.id, occurredAt: message.occurredAt,
    });
    if (changed) this.requestPublish();
    return changed;
  }

  requestPublish() {
    this.dirty = true;
    if (this.sending) return this.sending;
    this.sending = (async () => {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.publish(this.state.snapshot(), {
            url: `${this.officeUrl}/api/external-sources/codex/sessions`, token: this.token,
          });
        } catch (error) {
          console.error('Cat Office snapshot:', error.message);
          // Heartbeat retries even when the office is unavailable.
        }
      }
    })().finally(() => {
      this.sending = null;
      if (this.dirty) this.requestPublish();
    });
    return this.sending;
  }

  async start() {
    fs.mkdirSync(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
    if (fs.existsSync(this.socketPath)) {
      const active = await new Promise((resolve, reject) => {
        const socket = net.createConnection(this.socketPath);
        const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 100);
        socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
        socket.once('error', error => {
          clearTimeout(timer);
          if (error.code === 'ECONNREFUSED') resolve(false);
          else reject(error);
        });
      });
      if (active) throw new Error('Codex adapter is already running');
      fs.unlinkSync(this.socketPath);
    }
    this.server = net.createServer(socket => {
      socket.setEncoding('utf8');
      let buffer = '';
      socket.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 16 * 1024) return socket.destroy();
        const end = buffer.indexOf('\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = '';
        socket.end();
        try { void this.receive(JSON.parse(line)); } catch { /* malformed local event */ }
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.socketPath, resolve);
    });
    fs.chmodSync(this.socketPath, 0o600);
    try { await this.refreshProcess(); } catch (error) { console.error('Process scan:', error.message); }
    await this.requestPublish();
    this.pollTimer = setInterval(() => {
      this.refreshProcess().catch(error => console.error('Process scan:', error.message));
    }, this.processPollMs);
    this.heartbeatTimer = setInterval(() => this.requestPublish(), this.heartbeatMs);
    console.log(`Codex adapter listening on ${this.socketPath}`);
  }

  async stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.state.setProcess(null);
    await this.requestPublish();
    if (this.server) await new Promise(resolve => this.server.close(resolve));
    try { fs.unlinkSync(this.socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

module.exports = { Adapter };
