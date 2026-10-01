// The detector decides one run from the events of `claude -p --output-format
// stream-json --verbose --include-partial-messages`. Every outcome it can return is
// produced here from a literal event sequence.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDetector, lineSplitter } from '../bin/lib/stream.mjs'

const STUB = 'demo-skill-stub-0a1b2c3d'
const STUB_PATH = `/tmp/project/.claude/commands/${STUB}.md`
const init = (extra = {}) => ({ type: 'system', subtype: 'init', model: 'm-1', slash_commands: ['a', STUB], skills: ['x'], ...extra })
const se = (event) => ({ type: 'stream_event', event })
const start = (name) => se({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name, input: {} } })
const delta = (s) => se({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: s } })
const blockStop = se({ type: 'content_block_stop', index: 0 })
const msgStop = se({ type: 'message_stop' })
const textBlock = [
  se({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  se({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `I could use ${STUB} here` } }),
  blockStop,
]

function feed(events) {
  const d = createDetector({ stubName: STUB, stubPath: STUB_PATH })
  for (const [i, e] of events.entries()) {
    const r = d.feed(e)
    if (r) return { ...r, at: i }
  }
  return { ...d.end({ code: 0 }), at: -1 }
}

test('a Skill call naming the stub triggers, as soon as the name is complete', () => {
  const r = feed([init(), start('Skill'), delta('{"skill":"demo-skill-st'), delta('ub-0a1b2c3d"}'), blockStop, msgStop])
  assert.equal(r.outcome, 'triggered')
  assert.equal(r.at, 3, 'decided on the delta that completed the name, before the block closed')
})

test('a SlashCommand naming the stub triggers', () => {
  assert.equal(feed([init(), start('SlashCommand'), delta(`{"command":"/${STUB}"}`), blockStop]).outcome, 'triggered')
})

test('a Read of the stub file triggers', () => {
  assert.equal(feed([init(), start('Read'), delta(JSON.stringify({ file_path: STUB_PATH })), blockStop]).outcome, 'triggered')
})

test('a text answer is not a trigger, even when the text names the stub', () => {
  const r = feed([init(), ...textBlock, msgStop])
  assert.equal(r.outcome, 'not-triggered')
  assert.equal(r.at, 4, 'decided at the end of the first message')
})

test('another tool first is not a trigger', () => {
  assert.equal(feed([init(), start('Bash'), delta('{"command":"ls"}'), blockStop, msgStop]).outcome, 'not-triggered')
})

test('a Skill call naming another skill is not a trigger', () => {
  assert.equal(feed([init(), start('Skill'), delta('{"skill":"other"}'), blockStop, msgStop]).outcome, 'not-triggered')
})

test('a Read of another file is not a trigger', () => {
  assert.equal(feed([init(), start('Read'), delta('{"file_path":"/tmp/project/README.md"}'), blockStop, msgStop]).outcome, 'not-triggered')
})

test('a ToolSearch-only first message does not decide; the next one does', () => {
  const r = feed([
    init(),
    start('ToolSearch'),
    delta('{"query":"select:Skill"}'),
    blockStop,
    msgStop,
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
    start('Skill'),
    delta(`{"skill":"${STUB}"}`),
  ])
  assert.equal(r.outcome, 'triggered')
})

test('parallel tool calls in the first message: the stub among them triggers', () => {
  const r = feed([init(), start('Bash'), delta('{"command":"ls"}'), blockStop, start('Skill'), delta(`{"skill":"${STUB}"}`), blockStop, msgStop])
  assert.equal(r.outcome, 'triggered')
})

test('without partial events, the full assistant message is read', () => {
  const r = feed([init(), { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: STUB } }] } }])
  assert.equal(r.outcome, 'triggered')
  const miss = feed([init(), { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }, { type: 'result', subtype: 'success', is_error: false, result: 'hello' }])
  assert.equal(miss.outcome, 'not-triggered')
})

test('an authentication failure is an error, never a miss', () => {
  const r = feed([init(), { type: 'assistant', message: { content: [{ type: 'text', text: 'Failed to authenticate. API Error: 401' }] }, error: 'authentication_failed' }])
  assert.equal(r.outcome, 'error')
  assert.match(r.reason, /authenticate/i)
})

test('a synthetic API error message is an error', () => {
  const r = feed([init(), { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: 400 model not found' }] } }])
  assert.equal(r.outcome, 'error')
})

test('a result flagged is_error is an error', () => {
  assert.equal(feed([init(), { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'boom' }]).outcome, 'error')
})

test('a stream that ends without a decision is an error', () => {
  const d = createDetector({ stubName: STUB, stubPath: STUB_PATH })
  d.feed(init())
  assert.equal(d.end({ code: 1, stderr: 'segfault' }).outcome, 'error')
})

test('a run whose init event does not list the stub is an error: the stub was never seen', () => {
  const r = feed([init({ slash_commands: ['a', 'b'] }), ...textBlock, msgStop])
  assert.equal(r.outcome, 'error')
  assert.match(r.reason, /not in the roster/)
})

test('the init event is kept: model and roster', () => {
  const d = createDetector({ stubName: STUB, stubPath: STUB_PATH })
  d.feed(init())
  assert.equal(d.init.model, 'm-1')
  assert.deepEqual(d.init.slash_commands, ['a', STUB])
})

test('lineSplitter reassembles lines split across chunks and skips non-JSON', () => {
  const seen = []
  const s = lineSplitter((e) => seen.push(e))
  s.push('{"a":1}\n{"b"')
  s.push(':2}\nnot json\n')
  s.push('{"c":3}')
  s.end()
  assert.deepEqual(seen, [{ a: 1 }, { b: 2 }, { c: 3 }])
})
