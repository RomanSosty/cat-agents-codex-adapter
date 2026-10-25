import { fingerprintToolInput } from './state.js';

export function sanitizeHookEvent(source) {
  if (!source || typeof source !== 'object' ||
      typeof source.session_id !== 'string' || !source.session_id ||
      typeof source.hook_event_name !== 'string') return null;
  const event = {};
  for (const [key, max] of Object.entries({
    hook_event_name: 40, session_id: 200, turn_id: 200, cwd: 4096,
    tool_name: 200, tool_use_id: 200, source: 40, reason: 40,
  })) {
    if (typeof source[key] === 'string' && source[key].length <= max) event[key] = source[key];
  }
  const inputKey = fingerprintToolInput(source);
  if (inputKey) event.tool_input_key = inputKey;
  return event;
}
