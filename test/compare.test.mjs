import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { compare } from '../bin/lib/compare.mjs'
import { cli, fakeEnv, scratch } from './helpers.mjs'

const q = (query, should_trigger, outcomes) => {
  const hits = outcomes.filter((o) => o === 'triggered').length
  const runs = outcomes.filter((o) => o === 'triggered' || o === 'not-triggered').length
  return { query, should_trigger, outcomes, hits, runs, timeouts: 0, errors: 0 }
}
const report = (over = {}, queries) => ({
  tool: 'skilltrigger',
  date: '2026-09-18',
  skill: 'handoff',
  cliVersion: '2.1.268 (Claude Code)',
  model: 'claude-fable-5-1',
  roster: { slashCommands: 59, skills: 40 },
  runsPerQuery: 2,
  description: { bytes: 300, sha256: 'a'.repeat(64), overridden: false },
  verdict: 'ok',
  queries,
  totals: {},
  ...over,
})
const A = report({}, [q('one', true, ['triggered', 'triggered']), q('two', true, ['not-triggered', 'not-triggered']), q('three', false, ['not-triggered', 'not-triggered']), q('gone', true, ['triggered', 'triggered'])])
const B = report({ date: '2026-09-19', description: { bytes: 330, sha256: 'b'.repeat(64), overridden: false } }, [
  q('one', true, ['triggered', 'not-triggered']),
  q('two', true, ['triggered', 'triggered']),
  q('three', false, ['not-triggered', 'not-triggered']),
  q('new', false, ['not-triggered', 'not-triggered']),
])

test('per query and total differences; ±1 at two runs is noise', () => {
  const c = compare(A, B)
  const row = (name) => c.rows.find((r) => r.query === name)
  assert.equal(row('one').delta, -1)
  assert.equal(row('one').noise, true)
  assert.equal(row('two').delta, 2)
  assert.equal(row('two').noise, false)
  assert.equal(row('three').delta, 0)
  assert.equal(row('gone').only, 'a')
  assert.equal(row('new').only, 'b')
  assert.deepEqual(c.totals.positives, { a: { hits: 2, runs: 4 }, b: { hits: 3, runs: 4 }, delta: 1 })
  assert.deepEqual(c.warnings, [])
  assert.match(c.text, /description changed/)
})

test('a different model, CLI or roster is a warning: the number belongs to the roster too', () => {
  const c = compare(A, { ...B, model: 'claude-opus-5', cliVersion: '2.1.270 (Claude Code)', roster: { slashCommands: 83, skills: 64 } })
  assert.equal(c.warnings.length, 3)
  assert.match(c.warnings.join('\n'), /model/)
  assert.match(c.warnings.join('\n'), /CLI/)
  assert.match(c.warnings.join('\n'), /roster.*59.*83/)
})

test('a report without a verdict is flagged, not compared as if it had one', () => {
  const c = compare(A, { ...B, verdict: 'no-verdict' })
  assert.match(c.warnings.join('\n'), /no verdict/)
})

test('the command prints the comparison and exits 0; a bad file exits 1', async () => {
  const s = scratch()
  try {
    const a = join(s.dir, 'a.json')
    const b = join(s.dir, 'b.json')
    writeFileSync(a, JSON.stringify(A))
    writeFileSync(b, JSON.stringify({ ...B, roster: { slashCommands: 83, skills: 64 } }))
    const r = await cli(['compare', a, b], fakeEnv(s.dir))
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /warning: .*roster/)
    assert.match(r.out, /noise/)
    writeFileSync(b, '{')
    assert.equal((await cli(['compare', a, b], fakeEnv(s.dir))).code, 1)
  } finally {
    s.cleanup()
  }
})
