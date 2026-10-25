const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeHookEvent } = require('../src/hook-event');
const { editHooks } = require('../src/hook-install');
const { parseProcesses, desktopProcess } = require('../src/codex-process');
const { Adapter } = require('../src/receiver');

test('hook strips content but preserves event identity and input correlation', () => {
  const event = sanitizeHookEvent({
    hook_event_name: 'PermissionRequest', session_id: 'thr_a', turn_id: 'turn_a',
    cwd: '/work/demo', tool_name: 'Bash', tool_input: { command: 'SECRET' },
    prompt: 'PRIVATE PROMPT', tool_response: 'PRIVATE RESULT', transcript_path: '/secret/path',
  });
  assert.deepEqual(Object.keys(event).sort(), [
    'cwd', 'hook_event_name', 'session_id', 'tool_input_key', 'tool_name', 'turn_id',
  ]);
  assert.equal(JSON.stringify(event).includes('SECRET'), false);
  assert.equal(JSON.stringify(event).includes('PRIVATE'), false);
  assert.equal(event.tool_input_key.length, 64);
});

test('hook installation preserves other hooks and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-hooks-'));
  try {
    const target = path.join(dir, 'hooks.json');
    const original = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'other-hook' }] }] } };
    fs.writeFileSync(target, JSON.stringify(original));
    const options = { target, nodePath: '/usr/local/bin/node', script: '/tmp/my-hook.js' };
    assert.equal(editHooks({ ...options, action: 'install' }).changed, true);
    const installed = fs.readFileSync(target, 'utf8');
    assert.equal(editHooks({ ...options, action: 'install' }).changed, false);
    assert.equal(fs.readFileSync(target, 'utf8'), installed);
    assert.equal(JSON.parse(installed).hooks.Stop.length, 2);
    assert.equal(editHooks({ ...options, action: 'remove' }).changed, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('process scanner selects GUI-owned app-server, not another Codex process', () => {
  const output = [
    '89184     1 Sun Oct 25 20:11:36 2026     /Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
    '89229 89184 Sun Oct 25 20:11:37 2026     /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex app-server',
    '92485 89434 Sun Oct 25 20:21:15 2026     /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex app-server --listen stdio://',
  ].join('\n');
  const selected = desktopProcess(parseProcesses(output));
  assert.equal(selected.guiPid, 89184);
  assert.equal(selected.appServerPid, 89229);
  assert.ok(selected.id.includes('20:11:36 2026'));
});

test('live receiver rejects stale process events and publishes cleared snapshot', async () => {
  let desktop = { id: 'desktop-a', appServerPid: 100, appServerStartedAt: 0 };
  const sent = [];
  const adapter = new Adapter({ processFinder: async () => desktop,
    publish: async sessions => { sent.push(sessions); }, token: 'test', officeUrl: 'http://127.0.0.1:4317' });
  await adapter.refreshProcess();
  const event = sanitizeHookEvent({ hook_event_name: 'UserPromptSubmit', session_id: 'thr_a',
    turn_id: 'turn_a', cwd: '/work/demo', prompt: 'private' });
  assert.equal(await adapter.receive({ parentPid: 100, occurredAt: '2026-10-25T19:00:01Z', event }), true);
  await adapter.requestPublish();
  assert.equal(sent.at(-1)[0].status, 'busy');
  desktop = { id: 'desktop-b', appServerPid: 200, appServerStartedAt: 0 };
  await adapter.refreshProcess();
  await adapter.requestPublish();
  assert.deepEqual(sent.at(-1), []);
  assert.equal(await adapter.receive({ parentPid: 100, occurredAt: '2026-10-25T19:00:02Z', event }), false);
  assert.deepEqual(adapter.state.snapshot(), []);
});
