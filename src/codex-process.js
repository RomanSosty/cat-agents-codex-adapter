const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function parseProcesses(output) {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
    return match ? [{
      pid: Number(match[1]), ppid: Number(match[2]),
      started: match[3].trim(), command: match[4].trim(),
    }] : [];
  });
}

function desktopProcess(processes) {
  const gui = processes.find(item =>
    /^\/Applications\/(ChatGPT|Codex)\.app\/Contents\/MacOS\/\1(?:\s|$)/.test(item.command));
  if (!gui) return null;
  const appServer = processes.find(item => item.ppid === gui.pid &&
    /\/CodexCLI\.app\/Contents\/MacOS\/codex\b/.test(item.command) &&
    /\bapp-server\b/.test(item.command));
  if (!appServer) return null;
  return {
    id: `${gui.command.split(' ')[0]}:${gui.pid}:${gui.started}:${appServer.pid}:${appServer.started}`,
    guiPid: gui.pid,
    appServerPid: appServer.pid,
    appServerStartedAt: Date.parse(appServer.started),
  };
}

async function findDesktopProcess() {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,command='], {
    timeout: 2000, maxBuffer: 8 * 1024 * 1024,
  });
  return desktopProcess(parseProcesses(stdout));
}

module.exports = { parseProcesses, desktopProcess, findDesktopProcess };
