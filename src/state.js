const path = require('node:path');
const crypto = require('node:crypto');

const TURN_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop']);
const PRIORITY = { UserPromptSubmit: 0, PreToolUse: 1, PermissionRequest: 2, PostToolUse: 3, Stop: 4 };

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function inputKey(event) {
  if (typeof event.tool_input_key === 'string' && /^[a-f0-9]{64}$/.test(event.tool_input_key)) {
    return event.tool_input_key;
  }
  if (!event.tool_name || event.tool_input === undefined) return null;
  // Input is hashed in memory and never included in a snapshot or fixture output.
  return crypto.createHash('sha256').update(event.tool_name + '\0' + stableJson(event.tool_input)).digest('hex');
}

function activityFor(event, at) {
  const name = event.tool_name || 'Tool';
  return { name, category: name === 'Bash' ? 'shell' : 'tool', detail: name, ts: at };
}

function positionAfter(at, priority, session) {
  return at > session.lastAt || (at === session.lastAt && priority > session.lastPriority);
}

class SessionStateMachine {
  constructor() {
    this.processId = null;
    this.sessions = new Map();
    this.ended = new Map();
  }

  // processId must identify one GUI-process lifetime, e.g. executable path + PID + start time.
  setProcess(processId) {
    if (processId !== null && (typeof processId !== 'string' || !processId)) {
      throw new TypeError('processId must be a nonempty string or null');
    }
    if (this.processId === processId) return false;
    this.processId = processId;
    this.sessions.clear();
    this.ended.clear();
    return true;
  }

  apply(event, { processId, occurredAt } = {}) {
    if (!this.processId || processId !== this.processId) return false;
    if (!event || typeof event.session_id !== 'string' || !event.session_id) return false;
    const at = Date.parse(occurredAt);
    if (!Number.isFinite(at)) return false;
    const kind = event.hook_event_name;
    if (kind !== 'SessionStart' && kind !== 'SessionEnd' && !TURN_EVENTS.has(kind)) return false;
    const id = `codex:${event.session_id}`;
    let session = this.sessions.get(id);
    let created = false;
    const endedAt = this.ended.get(id);

    if (kind === 'SessionEnd') {
      if (endedAt !== undefined && at <= endedAt) return false;
      if (session && at < session.lastAt) return false;
      this.sessions.delete(id);
      this.ended.set(id, at);
      return Boolean(session);
    }

    if (endedAt !== undefined) {
      if (kind !== 'SessionStart' || at <= endedAt) return false;
      this.ended.delete(id);
    }

    if (TURN_EVENTS.has(kind) && (typeof event.turn_id !== 'string' || !event.turn_id)) return false;
    if (!session && kind === 'Stop') return false;

    if (!session) {
      created = true;
      const cwd = typeof event.cwd === 'string' ? event.cwd : '';
      const project = cwd ? path.basename(path.normalize(cwd)) : 'Codex';
      session = {
        id, source: 'codex', name: project, cwd, project,
        status: 'idle', statusSince: at, startedAt: at, activity: null, subagents: [],
        turnId: null, lastAt: -Infinity, lastPriority: -1,
        seenTurns: new Set(),
        activeToolUseId: null, waitingInputKey: null, waitingToolName: null,
      };
      this.sessions.set(id, session);
    }

    let enriched = false;
    if (!session.cwd && typeof event.cwd === 'string' && event.cwd) {
      session.cwd = event.cwd;
      session.project = path.basename(path.normalize(event.cwd));
      session.name = session.project;
      enriched = true;
    }
    if (kind === 'SessionStart') return created || enriched;

    if (session.turnId !== event.turn_id) {
      if (session.seenTurns.has(event.turn_id) || kind === 'Stop' || at < session.lastAt ||
          (at === session.lastAt && session.status !== 'idle' && kind !== 'UserPromptSubmit')) return false;
      session.turnId = event.turn_id;
      session.seenTurns.add(event.turn_id);
      session.lastAt = -Infinity;
      session.lastPriority = -1;
      session.activeToolUseId = null;
      session.waitingInputKey = null;
      session.waitingToolName = null;
    }

    const priority = PRIORITY[kind];
    if (!positionAfter(at, priority, session)) return false;

    // A delayed prompt hook must not overwrite activity already seen in its turn.
    if (kind === 'UserPromptSubmit' && session.lastAt !== -Infinity) return false;

    if (kind === 'PostToolUse') {
      const key = inputKey(event);
      if (session.status === 'waiting') {
        const matches = session.waitingInputKey
          ? session.waitingInputKey === key
          : session.activeToolUseId && event.tool_use_id
            ? session.activeToolUseId === event.tool_use_id
            : session.waitingToolName === event.tool_name;
        if (!matches) return false;
      } else if (session.activeToolUseId && event.tool_use_id &&
                 session.activeToolUseId !== event.tool_use_id) {
        return false;
      }
    }

    session.lastAt = at;
    session.lastPriority = priority;

    if (kind === 'UserPromptSubmit') {
      if (session.status !== 'busy' || session.activity !== null) {
        session.status = 'busy';
        session.statusSince = at;
        session.activity = null;
      }
      return true;
    }
    if (kind === 'PreToolUse') {
      // A permission hook can arrive before this hook for the same call.
      if (session.status !== 'waiting') {
        if (session.status !== 'busy') session.statusSince = at;
        session.status = 'busy';
        session.activity = activityFor(event, at);
        session.activeToolUseId = event.tool_use_id || null;
      }
      return true;
    }
    if (kind === 'PermissionRequest') {
      if (session.status !== 'waiting') session.statusSince = at;
      session.status = 'waiting';
      session.activity = activityFor(event, at);
      session.waitingInputKey = inputKey(event);
      session.waitingToolName = event.tool_name || null;
      return true;
    }
    if (kind === 'PostToolUse') {
      if (session.status === 'waiting') {
        session.waitingInputKey = null;
        session.waitingToolName = null;
      }
      if (session.status !== 'busy') session.statusSince = at;
      session.status = 'busy';
      session.activity = null;
      session.activeToolUseId = null;
      return true;
    }
    if (session.status !== 'idle') session.statusSince = at;
    session.status = 'idle';
    session.activity = null;
    session.activeToolUseId = null;
    session.waitingInputKey = null;
    session.waitingToolName = null;
    return true;
  }

  snapshot() {
    return [...this.sessions.values()].map(session => ({
      id: session.id,
      source: session.source,
      name: session.name,
      cwd: session.cwd,
      project: session.project,
      status: session.status,
      statusSince: session.statusSince,
      startedAt: session.startedAt,
      activity: session.activity && { ...session.activity },
      subagents: [],
    })).sort((a, b) => a.id.localeCompare(b.id));
  }
}

module.exports = { SessionStateMachine, fingerprintToolInput: inputKey };
