// ST-17: `run --threshold` — the per-query trigger rate a positive must reach and a
// negative must stay under, 0.5 by default. It decides pass and fail per query and
// nothing else: the totals, the verdict and the exit code do not read it.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { compare } from '../bin/lib/compare.mjs'
import { EVALS, SKILL, cli, fakeEnv, readLog, scratch } from './helpers.mjs'

const POS = ['show me a demo of the thing', 'run the demo for the new feature']
const NEG = ['what is the capital of France', 'write a haiku about tea']
const OLD = 'OLD-TEXT: the description as it stands.'
const NEW = 'NEW-TEXT: the rewrite under test.'

async function run(env = {}, args = []) {
  const s = scratch()
  const out = join(s.dir, 'out')
  try {
    const r = await cli(['run', '--skill', SKILL, '--eval', EVALS, '--out', out, '--timeout', '5', ...args], fakeEnv(s.dir, env))
    const files = existsSync(out) ? readdirSync(out) : []
    const json = files.find((f) => f.endsWith('.json'))
    const md = files.find((f) => f.endsWith('.md'))
    return { ...r, log: readLog(s.dir), report: json ? JSON.parse(readFileSync(join(out, json), 'utf8')) : null, md: md ? readFileSync(join(out, md), 'utf8') : '' }
  } finally {
    s.cleanup()
  }
}
// One hit in two on the second positive and on the first negative: a rate of 0.5, which
// passes a positive and fails a negative at 0.5, and the other way round at 0.75.
const half = { [POS[0]]: 'trigger', [POS[1]]: ['trigger', 'miss'], [NEG[0]]: ['trigger', 'miss'], [NEG[1]]: 'miss' }
const pass = (rep, q) => rep.queries.find((x) => x.query === q).pass

test('the default is 0.5, recorded as before', async () => {
  const r = await run({ FAKE_CLAUDE_QUERIES: JSON.stringify(half) })
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.triggerThreshold, 0.5)
  assert.equal(pass(r.report, POS[1]), true)
  assert.equal(pass(r.report, NEG[0]), false)
})

test('--threshold moves pass and fail per query, and is recorded in the JSON, the Markdown and the summary', async () => {
  const r = await run({ FAKE_CLAUDE_QUERIES: JSON.stringify(half) }, ['--threshold', '0.75'])
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.triggerThreshold, 0.75)
  assert.equal(pass(r.report, POS[0]), true)
  assert.equal(pass(r.report, POS[1]), false, 'a positive at 1/2 is under 0.75')
  assert.equal(pass(r.report, NEG[0]), true, 'a negative at 1/2 is under 0.75')
  assert.equal(r.report.totals.passed, 3)
  // The totals and the verdict do not read the threshold.
  assert.deepEqual(r.report.totals.positives, { triggered: 3, runs: 4 })
  assert.equal(r.report.verdict, 'ok')
  assert.match(r.md, /\| Pass threshold \| trigger rate ≥ 0\.75 for a positive, < 0\.75 for a negative \|/)
  assert.match(r.out, /3\/4 pass at a trigger rate threshold of 0\.75/)
})

test('a threshold outside (0, 1) is a usage error before any gate runs', async () => {
  for (const bad of ['0', '1', '1.5', '-0.2', 'half', '']) {
    const r = await run({}, [`--threshold=${bad}`])
    assert.equal(r.code, 1, `${bad}: ${r.out}`)
    assert.match(r.out, /--threshold must be a number strictly between 0 and 1/, bad)
    assert.equal(r.log.length, 0, `${bad}: no gate ran`)
  }
})

test('a paired run judges both sides at the same threshold', async () => {
  const env = { FAKE_CLAUDE_DESCRIPTIONS: JSON.stringify({ [OLD]: half, [NEW]: half }) }
  const r = await run(env, ['--baseline-description', OLD, '--description', NEW, '--threshold', '0.75'])
  assert.equal(r.code, 0, r.out)
  const rep = r.report
  assert.equal(rep.paired, true)
  assert.equal(rep.triggerThreshold, 0.75)
  for (const side of [rep.baseline, rep.candidate]) {
    assert.equal(side.triggerThreshold, 0.75)
    assert.equal(pass(side, POS[1]), false)
    assert.equal(pass(side, NEG[0]), true)
  }
  assert.match(r.md, /trigger rate ≥ 0\.75/)
})

const report = (triggerThreshold) => ({ tool: 'skilltrigger', date: '2026-10-03', skill: 's', cliVersion: '2.1.268', model: 'm', roster: { slashCommands: 1, skills: 1 }, runsPerQuery: 2, verdict: 'ok', triggerThreshold, queries: [{ query: 'q', should_trigger: true, hits: 1, runs: 2, outcomes: ['triggered', 'not-triggered'] }] })

test('compare warns when the two reports were judged at different thresholds', () => {
  const c = compare(report(0.5), report(0.75))
  assert.equal(c.warnings.length, 1, c.warnings.join('\n'))
  assert.match(c.warnings[0], /pass threshold differs: 0\.5 vs 0\.75/)
  assert.match(c.text, /warning: pass threshold differs/)
  assert.deepEqual(compare(report(0.75), report(0.75)).warnings, [])
})

test('help names the option', async () => {
  const s = scratch()
  try {
    const r = await cli(['help'], fakeEnv(s.dir))
    assert.match(r.out, /--threshold 0\.5/)
  } finally {
    s.cleanup()
  }
})
