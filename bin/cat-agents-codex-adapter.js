#!/usr/bin/env node
import path from 'node:path';
import { editHooks } from '../src/hook-install.js';
import { ROOT, localToken } from '../src/runtime-config.js';

async function main() {
  const command = process.argv[2];
  if (command === 'install-hooks' || command === 'remove-hooks') {
    const result = editHooks({ action: command === 'install-hooks' ? 'install' : 'remove' });
    console.log(result.changed ? `Updated ${result.target}` : 'No change');
    return;
  }
  if (command === 'launch' || command === 'stop-live') {
    const { launchLive, stopLive } = await import('../src/live-processes.js');
    console.log((command === 'launch' ? launchLive() : stopLive()).join('\n'));
    return;
  }
  if (command === 'office') {
    process.env.CAT_AGENTS_HOOKS = 'off';
    process.env.CAT_AGENTS_EXTERNAL_TOKEN = localToken();
    process.env.DATA_DIR ||= path.join(ROOT, 'vendor', 'cat-agents', 'data');
    await import('../vendor/cat-agents/server/index.js');
    return;
  }
  if (command === 'start') {
    const { Adapter } = await import('../src/receiver.js');
    const adapter = new Adapter();
    await adapter.start();
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      adapter.stop().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  console.error('Usage: cat-agents-codex-adapter <launch|stop-live|office|start|install-hooks|remove-hooks>');
  process.exitCode = 2;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
