const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { ROOT, RUN_DIR } = require('./runtime-config');

const CLI = path.join(ROOT, 'bin', 'cat-agents-codex-adapter.js');
const COMMANDS = ['office', 'start'];

function ownedProcess(command) {
  const file = path.join(RUN_DIR, `${command}.pid`);
  let pid;
  try { pid = Number(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const line = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
    return line.includes(CLI) && line.endsWith(` ${command}`) ? pid : null;
  } catch { return null; }
}

function launchLive() {
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  const result = [];
  for (const command of COMMANDS) {
    const existing = ownedProcess(command);
    if (existing) { result.push(`${command}: already running (PID ${existing})`); continue; }
    const fd = fs.openSync(path.join(RUN_DIR, `${command}.log`), 'a', 0o600);
    const child = spawn(process.execPath, [CLI, command], {
      cwd: ROOT, detached: true, stdio: ['ignore', fd, fd],
    });
    fs.closeSync(fd);
    if (!child.pid) throw new Error(`Could not start ${command}`);
    fs.writeFileSync(path.join(RUN_DIR, `${command}.pid`), `${child.pid}\n`, { mode: 0o600 });
    child.unref();
    result.push(`${command}: started (PID ${child.pid})`);
  }
  return result;
}

function stopLive() {
  const result = [];
  for (const command of [...COMMANDS].reverse()) {
    const pid = ownedProcess(command);
    if (pid) {
      process.kill(pid, 'SIGTERM');
      result.push(`${command}: stopping (PID ${pid})`);
    } else result.push(`${command}: not running`);
  }
  return result;
}

module.exports = { launchLive, stopLive, ownedProcess };
