// ST-15: positives that presuppose a session. `claude -p` starts from nothing, so a prompt
// like "dump the state of this refactor" measures whether the model loads the skill
// before it goes looking for material a real session would already hold. An eval item
// marked `needs_context: true` is run like any other, counted apart from the positives,
// and reported as its own group — a number, not a footnote. Its runs still count towards
// the no-verdict rule: a timeout is the environment breaking, whatever the prompt asked.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { compare } from '../bin/lib/compare.mjs'
import { parseEvalSet } from '../bin/lib/skill.mjs'
import { SKILL, cli, fakeEnv, readLog, scratch } from './helpers.mjs'

const POS = 'show me a demo of the thing'
const CTX = 'dump the state of this demo into DEMO.md'
const NEG = ['what is the capital of France', 'write a haiku about tea']
const SET = [
  { query: POS, should_trigger: true },
  { query: CTX, should_trigger: true, needs_context: true },
  { query: NEG[0], should_trigger: false },
  { query: NEG[1], should_trigger: false },
]
const OLD = 'OLD-TEXT: the description as it stands.'
const NEW = 'NEW-TEXT: the rewrite under test.'

async function run(env = {}, args = [], items = SET) {
  const s = scratch()
  const out = join(s.dir, 'out')
  try {
    const evals = join(s.dir, 'evals.json')
    writeFileSync(evals, JSON.stringify(items))
    const r = await cli(['run', '--skill', SKILL, '--eval', evals, '--out', out, '--timeout', '5', ...args], fakeEnv(s.dir, env))
    const files = existsSync(out) ? readdirSync(out) : []
    const json = files.find((f) => f.endsWith('.json'))
    const md = files.find((f) => f.endsWith('.md'))
    return { ...r, log: readLog(s.dir), report: json ? JSON.parse(readFileSync(join(out, json), 'utf8')) : null, md: md ? readFileSync(join(out, md), 'utf8') : '' }
  } finally {
    s.cleanup()
  }
}
const modes = (map) => ({ FAKE_CLAUDE_QUERIES: JSON.stringify(map) })
const healthy = modes({ [POS]: 'trigger', [CTX]: 'miss', [NEG[0]]: 'miss', [NEG[1]]: 'miss' })

test('the eval set: needs_context is a boolean, and marks a positive only', () => {
  assert.equal(parseEvalSet(JSON.stringify(SET))[1].needs_context, true)
  assert.doesNotThrow(() => parseEvalSet(JSON.stringify([{ query: 'q', should_trigger: false, needs_context: false }])))
  assert.throws(() => parseEvalSet(JSON.stringify([{ query: 'q', should_trigger: true, needs_context: 'yes' }])), /item 0: needs_context must be true or false/)
  assert.throws(() => parseEvalSet(JSON.stringify([{ query: 'q', should_trigger: false, needs_context: true }])), /item 0: needs_context marks a positive/)
})

test('a needs_context positive is run, then counted apart from the positives', async () => {
  const r = await run(healthy)
  assert.equal(r.code, 0, r.out)
  const rep = r.report
  assert.equal(r.log.filter((l) => l.prompt === CTX).length, 2, 'run like any other query')
  assert.equal(rep.verdict, 'ok')
  assert.deepEqual(rep.totals.positives, { triggered: 2, runs: 2 }, 'the positives leave it out')
  assert.deepEqual(rep.totals.needsContext, { triggered: 0, runs: 2, passed: 0, queries: 1 })
  assert.equal(rep.totals.passed, 3)
  assert.equal(rep.totals.queries, 3, 'the pass count is over the queries that count')
  assert.equal(rep.queries.find((q) => q.query === CTX).needs_context, true)
  // stdout: the headline names the group, and the pass line counts it apart
  assert.match(r.out, /positives triggered 2\/2 · negatives fired 0\/4 · needs_context positives triggered 0\/2/)
  assert.match(r.out, /3\/3 pass .*; needs_context: 0\/1 pass/)
  // Markdown: its own group, not a row of the main table
  const [main, group] = r.md.split('## Positives that presuppose a session')
  assert.ok(group, r.md)
  assert.ok(!main.includes(`| ${CTX} |`), 'not in the main table')
  assert.match(group, new RegExp(`\\| ${CTX} \\| 0/2 \\| 0 \\| 0 \\| fail \\|`))
  assert.match(group, /needs_context positives triggered 0\/2/)
})

test('an eval set without the field gives the report it always did', async () => {
  const r = await run(healthy, [], SET.map(({ needs_context, ...it }) => it))
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.totals.needsContext, undefined)
  assert.deepEqual(r.report.totals.positives, { triggered: 2, runs: 4 })
  assert.ok(!/needs_context|presuppose/.test(r.out + r.md))
})

test('its runs still count towards the verdict: a needs_context query that lost every run is no verdict', async () => {
  // Twenty queries × two runs: one lost query is 2 of 40, inside the 10% share.
  const items = Array.from({ length: 20 }, (_, i) => ({ query: `query number ${i}`, should_trigger: i < 10, ...(i === 3 ? { needs_context: true } : {}) }))
  const map = Object.fromEntries(items.map((it) => [it.query, it.should_trigger ? 'trigger' : 'miss']))
  const r = await run(modes({ ...map, 'query number 3': 'hang' }), ['--timeout', '1'], items)
  assert.equal(r.code, 3, r.out)
  assert.equal(r.report.verdict, 'no-verdict')
  assert.deepEqual(r.report.lostQueries, ['query number 3'])
})

test('a paired run keeps the group apart on both sides and in the comparison', async () => {
  const side = (ctx) => ({ [POS]: 'trigger', [CTX]: ctx, [NEG[0]]: 'miss', [NEG[1]]: 'miss' })
  const r = await run({ FAKE_CLAUDE_DESCRIPTIONS: JSON.stringify({ [OLD]: side('miss'), [NEW]: side('trigger') }) }, ['--baseline-description', OLD, '--description', NEW])
  assert.equal(r.code, 0, r.out)
  const rep = r.report
  assert.deepEqual(rep.baseline.totals.needsContext, { triggered: 0, runs: 2, passed: 0, queries: 1 })
  assert.deepEqual(rep.candidate.totals.needsContext, { triggered: 2, runs: 2, passed: 1, queries: 1 })
  assert.deepEqual(rep.comparison.totals.positives, { baseline: { hits: 2, runs: 2 }, candidate: { hits: 2, runs: 2 }, delta: 0, noise: false })
  // A total difference of two is within noise at two runs, as for the positives.
  assert.deepEqual(rep.comparison.totals.needsContext, { baseline: { hits: 0, runs: 2 }, candidate: { hits: 2, runs: 2 }, delta: 2, noise: true })
  assert.equal(rep.comparison.rows.find((x) => x.query === CTX).needs_context, true)
  assert.match(r.out, /needs_context positives triggered 0\/2 → 2\/2 \(\+2\) \(within noise\)/)
  assert.match(r.md, /## Positives that presuppose a session/)
  assert.match(r.md, /needs_context positives triggered 0\/2 → 2\/2 \(\+2\)/)
})

const q = (query, should_trigger, outcomes, extra = {}) => ({ query, should_trigger, outcomes, hits: outcomes.filter((o) => o === 'triggered').length, runs: outcomes.length, ...extra })
const report = (queries) => ({ tool: 'skilltrigger', date: '2026-10-03', skill: 's', cliVersion: '2.1.268', model: 'm', roster: { slashCommands: 1, skills: 1 }, runsPerQuery: 2, verdict: 'ok', queries })

test('compare totals the group apart, and warns when the two sets mark it differently', () => {
  const a = report([q(POS, true, ['triggered', 'triggered']), q(CTX, true, ['not-triggered', 'not-triggered'], { needs_context: true })])
  const b = report([q(POS, true, ['triggered', 'triggered']), q(CTX, true, ['triggered', 'triggered'], { needs_context: true })])
  const c = compare(a, b)
  assert.deepEqual(c.warnings, [])
  assert.deepEqual(c.totals.positives, { a: { hits: 2, runs: 2 }, b: { hits: 2, runs: 2 }, delta: 0 })
  assert.deepEqual(c.totals.needsContext, { a: { hits: 0, runs: 2 }, b: { hits: 2, runs: 2 }, delta: 2 })
  assert.match(c.text, /ctx {2}0\/2 → 2\/2/)
  assert.match(c.text, /needs_context positives triggered 0\/2 → 2\/2 \(\+2\)/)
  const unmarked = report([q(POS, true, ['triggered', 'triggered']), q(CTX, true, ['not-triggered', 'not-triggered'])])
  const d = compare(unmarked, b)
  assert.match(d.warnings.join('\n'), /needs_context differs on 1 shared query/)
  assert.deepEqual(d.totals.needsContext, { a: { hits: 0, runs: 2 }, b: { hits: 2, runs: 2 }, delta: 2 }, 'grouped by either mark')
  assert.ok(!/needs_context/.test(compare(unmarked, unmarked).text), 'nothing printed when no query is marked')
})
