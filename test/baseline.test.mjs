// ST-14: `run --baseline-description` — the old text and the new one measured in one
// invocation, interleaved run by run under one preflight, so both numbers share the day,
// the CLI, the model and the roster by construction. Against the fake claude, which tells
// the two descriptions apart by a marker in the stub text (FAKE_CLAUDE_DESCRIPTIONS).
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { EVALS, SKILL, cli, fakeEnv, readLog, scratch } from './helpers.mjs'

const POS = ['show me a demo of the thing', 'run the demo for the new feature']
const NEG = ['what is the capital of France', 'write a haiku about tea']
const OLD = 'OLD-TEXT: the description as it stands.'
const NEW = 'NEW-TEXT: the rewrite under test.'
const PONG = 'Reply with exactly: pong'

async function run(env = {}, args = [], { evals = EVALS, keep = () => {} } = {}) {
  const s = scratch()
  const out = join(s.dir, 'out')
  try {
    const r = await cli(['run', '--skill', SKILL, '--eval', evals, '--out', out, '--timeout', '5', ...args], fakeEnv(s.dir, env))
    const files = existsSync(out) ? readdirSync(out) : []
    const jsonFile = files.find((f) => f.endsWith('.json'))
    const md = files.find((f) => f.endsWith('.md'))
    keep(s.dir, jsonFile ? join(out, jsonFile) : null)
    return {
      ...r,
      log: readLog(s.dir),
      report: jsonFile ? JSON.parse(readFileSync(join(out, jsonFile), 'utf8')) : null,
      reportText: jsonFile ? readFileSync(join(out, jsonFile), 'utf8') : '',
      md: md ? readFileSync(join(out, md), 'utf8') : '',
    }
  } finally {
    s.cleanup()
  }
}
const paired = ['--baseline-description', OLD, '--description', NEW]
const runs = (log) => log.filter((l) => l.prompt && l.prompt !== PONG)
const side = (l) => (l.stubText.includes(OLD) ? 'baseline' : l.stubText.includes(NEW) ? 'candidate' : 'neither')
const healthy = { FAKE_CLAUDE_QUERIES: JSON.stringify(Object.fromEntries([...POS.map((q) => [q, 'trigger']), ...NEG.map((q) => [q, 'miss'])])) }
const byText = (old, neu) => ({ FAKE_CLAUDE_DESCRIPTIONS: JSON.stringify({ [OLD]: old, [NEW]: neu }) })

test('the two descriptions alternate run by run, each query once with each text, under one preflight', async () => {
  const r = await run(healthy, paired)
  assert.equal(r.code, 0, r.out)
  const rs = runs(r.log)
  assert.equal(rs.length, 16, 'four queries × two runs × two descriptions')
  for (let i = 0; i < rs.length; i += 2) {
    assert.equal(rs[i].prompt, rs[i + 1].prompt, `pair ${i / 2} is one query`)
    assert.deepEqual([side(rs[i]), side(rs[i + 1])].sort(), ['baseline', 'candidate'], `pair ${i / 2} holds one run of each`)
  }
  // The order inside a pair flips every pass, so neither text always goes first.
  assert.deepEqual(rs.slice(0, 8).filter((_, i) => i % 2 === 0).map(side), ['baseline', 'baseline', 'baseline', 'baseline'])
  assert.deepEqual(rs.slice(8).filter((_, i) => i % 2 === 0).map(side), ['candidate', 'candidate', 'candidate', 'candidate'])
  assert.equal(r.log.filter((l) => l.prompt === PONG).length, 1, 'the gates ran once')
  assert.equal(r.log.filter((l) => l.argv[0] === 'auth').length, 1, 'the gates ran once')
})

test('the counts are kept apart: each side scores only its own runs', async () => {
  const r = await run(byText({ [POS[0]]: 'miss', [POS[1]]: ['trigger', 'miss'], [NEG[0]]: 'trigger', [NEG[1]]: 'miss' }, { [POS[0]]: 'trigger', [POS[1]]: 'trigger', [NEG[0]]: 'miss', [NEG[1]]: 'miss' }), paired)
  assert.equal(r.code, 0, r.out)
  const rep = r.report
  assert.equal(rep.paired, true)
  assert.deepEqual(rep.baseline.totals.positives, { triggered: 1, runs: 4 })
  assert.deepEqual(rep.baseline.totals.negatives, { fired: 2, runs: 4 })
  assert.deepEqual(rep.candidate.totals.positives, { triggered: 4, runs: 4 })
  assert.deepEqual(rep.candidate.totals.negatives, { fired: 0, runs: 4 })
  assert.deepEqual(rep.baseline.queries.find((q) => q.query === POS[1]).outcomes, ['triggered', 'not-triggered'])
  assert.deepEqual(rep.candidate.queries.find((q) => q.query === POS[1]).outcomes, ['triggered', 'triggered'])
  assert.equal(rep.baseline.totals.executed, 8)
  assert.equal(rep.candidate.totals.executed, 8)
  assert.notEqual(rep.baseline.description.sha256, rep.candidate.description.sha256)
  assert.equal(rep.candidate.description.overridden, true)
})

// Twenty queries × two runs = 40 per side: one query lost on one side is 2 of 40, inside
// the 10% share, and still no verdict — for that side and for the comparison.
const twenty = (dir) => {
  const items = Array.from({ length: 20 }, (_, i) => ({ query: `query number ${i}`, should_trigger: i < 10 }))
  const evals = join(dir, 'twenty.json')
  writeFileSync(evals, JSON.stringify(items))
  return { items, evals }
}

test('a query lost on one side only is no verdict, for that side and for the comparison', async () => {
  const s = scratch()
  try {
    const { items, evals } = twenty(s.dir)
    const base = Object.fromEntries(items.map((it) => [it.query, it.should_trigger ? 'trigger' : 'miss']))
    const r = await run(byText({ ...base, 'query number 3': 'hang' }, base), [...paired, '--timeout', '1'], { evals })
    assert.equal(r.code, 3, r.out)
    assert.equal(r.report.verdict, 'no-verdict')
    assert.equal(r.report.baseline.verdict, 'no-verdict')
    assert.deepEqual(r.report.baseline.lostQueries, ['query number 3'])
    assert.equal(r.report.candidate.verdict, 'ok')
    assert.equal(r.report.aborted, false, '2 of 40 is inside the share: not stopped')
    assert.match(r.out, /no verdict/i)
    assert.match(r.out, /baseline.*query number 3/is)
    assert.match(r.md, /No verdict/)
  } finally {
    s.cleanup()
  }
})

test('more than 10% of one side failing stops the whole run: no comparison is possible', async () => {
  const ok = Object.fromEntries([...POS.map((q) => [q, 'trigger']), ...NEG.map((q) => [q, 'miss'])])
  const r = await run(byText(ok, Object.fromEntries(Object.keys(ok).map((q) => [q, 'api-error']))), [...paired, '--runs', '3'])
  assert.equal(r.code, 3, r.out)
  assert.equal(r.report.aborted, true)
  assert.equal(r.report.candidate.verdict, 'no-verdict')
  assert.equal(r.report.verdict, 'no-verdict')
  assert.ok(runs(r.log).length < 24, `stopped early after ${runs(r.log).length}`)
})

test('the report shows both totals and the per-query deltas, with the ±1-at-two-runs noise label', async () => {
  const r = await run(byText({ [POS[0]]: 'miss', [POS[1]]: ['trigger', 'miss'], [NEG[0]]: 'miss', [NEG[1]]: 'miss' }, { [POS[0]]: 'trigger', [POS[1]]: 'trigger', [NEG[0]]: 'miss', [NEG[1]]: 'miss' }), paired)
  assert.equal(r.code, 0, r.out)
  const c = r.report.comparison
  const row = (q) => c.rows.find((x) => x.query === q)
  assert.deepEqual(row(POS[0]), { query: POS[0], should_trigger: true, baseline: { hits: 0, runs: 2 }, candidate: { hits: 2, runs: 2 }, delta: 2, noise: false })
  assert.equal(row(POS[1]).delta, 1)
  assert.equal(row(POS[1]).noise, true)
  assert.equal(row(NEG[0]).delta, 0)
  assert.deepEqual(c.totals.positives, { baseline: { hits: 1, runs: 4 }, candidate: { hits: 4, runs: 4 }, delta: 3, noise: false })
  assert.deepEqual(c.totals.negatives, { baseline: { hits: 0, runs: 4 }, candidate: { hits: 0, runs: 4 }, delta: 0, noise: false })
  // stdout: both headlines, then the deltas
  assert.match(r.out, /baseline +positives triggered 1\/4 · negatives fired 0\/4/)
  assert.match(r.out, /candidate +positives triggered 4\/4 · negatives fired 0\/4/)
  assert.match(r.out, /positives triggered 1\/4 → 4\/4 \(\+3\)/)
  assert.match(r.out, /\+1 \(noise\)/)
  // Markdown: both totals and a delta column
  assert.match(r.md, /\| Baseline \| .*sha256 /)
  assert.match(r.md, /\| Candidate \| .*sha256 /)
  assert.match(r.md, /\| show me a demo of the thing \| yes \| 0\/2 \| 2\/2 \| \+2 \|/)
  assert.match(r.md, /\| run the demo for the new feature \| yes \| 1\/2 \| 2\/2 \| \+1 \(noise\) \|/)
  assert.match(r.md, /positives triggered 1\/4 → 4\/4 \(\+3\)/)
  // still no description text in either file
  for (const leak of ['OLD-TEXT', 'NEW-TEXT', 'Demonstrates a skill', 'stub-']) {
    assert.ok(!r.reportText.includes(leak), `the report carries ${leak}`)
    assert.ok(!r.md.includes(leak), `the Markdown carries ${leak}`)
  }
})

test('--baseline-description reads a file: plain text, or the description of a SKILL.md', async () => {
  const s = scratch()
  try {
    const txt = join(s.dir, 'old.txt')
    writeFileSync(txt, `${OLD}\n`)
    const md = join(s.dir, 'SKILL.md')
    writeFileSync(md, `---\nname: demo-skill\ndescription: >\n  ${OLD} From a SKILL.md.\n---\n\nbody\n`)
    for (const [file, expect] of [[txt, `  ${OLD}\n---`], [md, `  ${OLD} From a SKILL.md.\n---`]]) {
      const r = await run(healthy, ['--baseline-description', file, '--runs', '1'])
      assert.equal(r.code, 0, r.out)
      const base = runs(r.log).filter((l) => l.stubText.includes(OLD))
      assert.equal(base.length, 4)
      for (const l of base) assert.ok(l.stubText.includes(expect), l.stubText)
      // the candidate is the skill's own text when --description is not given
      assert.equal(runs(r.log).filter((l) => l.stubText.includes('Demonstrates a skill')).length, 4)
    }
  } finally {
    s.cleanup()
  }
})

test('an empty baseline is a usage error before any gate runs', async () => {
  const r = await run(healthy, ['--baseline-description', '  '])
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /--baseline-description is empty/)
  assert.equal(r.log.length, 0)
})

const SINGLE_KEYS = ['tool', 'toolVersion', 'date', 'skill', 'cliVersion', 'model', 'roster', 'runModels', 'environment', 'runsPerQuery', 'timeoutSeconds', 'triggerThreshold', 'noVerdictThreshold', 'conflictAllowed', 'description', 'verdict', 'aborted', 'lostQueries', 'partialQueries', 'totals', 'queries']

test('a run without the flag is unchanged: one description, one report of the single shape', async () => {
  const r = await run(healthy)
  assert.equal(r.code, 0, r.out)
  const rs = runs(r.log)
  assert.equal(rs.length, 8)
  assert.equal(new Set(rs.map((l) => l.stubText.replace(/stub-[0-9a-f]+/, ''))).size, 1, 'every run carried the same text')
  assert.deepEqual(Object.keys(r.report), SINGLE_KEYS)
  assert.ok(!/baseline|candidate/i.test(r.out + r.md))
})

test('compare refuses a paired report, naming why, and still compares single reports', async () => {
  let pairedFile = null
  let single = null
  await run(healthy, [...paired, '--runs', '1'], { keep: (_, f) => (pairedFile = readFileSync(f, 'utf8')) })
  await run(healthy, ['--runs', '1'], { keep: (_, f) => (single = readFileSync(f, 'utf8')) })
  const s = scratch()
  try {
    const p = join(s.dir, 'paired.json')
    const a = join(s.dir, 'a.json')
    writeFileSync(p, pairedFile)
    writeFileSync(a, single)
    const bad = await cli(['compare', a, p], fakeEnv(s.dir))
    assert.equal(bad.code, 1, bad.out)
    assert.match(bad.out, /paired report/)
    const good = await cli(['compare', a, a], fakeEnv(s.dir))
    assert.equal(good.code, 0, good.out)
    assert.match(good.out, /description: identical in both/)
  } finally {
    s.cleanup()
  }
})

test('help names the flag and stops at the exit codes, before the first line of code', async () => {
  const s = scratch()
  try {
    const r = await cli(['help'], fakeEnv(s.dir))
    assert.equal(r.code, 0)
    assert.match(r.out, /--baseline-description <text\|file>/)
    assert.match(r.out.trimEnd(), /3 no verdict\.$/)
    assert.ok(!/import /.test(r.out), r.out)
  } finally {
    s.cleanup()
  }
})
