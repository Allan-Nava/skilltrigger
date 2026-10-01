// `skilltrigger run` end to end against the fake claude: the outcomes, the verdict
// rule, the report, and what the runner leaves behind (nothing).
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { EVALS, SKILL, cli, fakeEnv, readLog, scratch } from './helpers.mjs'

const POS = ['show me a demo of the thing', 'run the demo for the new feature']
const NEG = ['what is the capital of France', 'write a haiku about tea']

async function run(env = {}, args = [], { evals = EVALS, setup = () => {} } = {}) {
  const s = scratch()
  const out = join(s.dir, 'out')
  try {
    setup(s.dir)
    const r = await cli(['run', '--skill', SKILL, '--eval', evals, '--out', out, '--timeout', '5', ...args], fakeEnv(s.dir, env))
    const files = existsSync(out) ? readdirSync(out) : []
    const jsonFile = files.find((f) => f.endsWith('.json'))
    const report = jsonFile ? JSON.parse(readFileSync(join(out, jsonFile), 'utf8')) : null
    const md = files.find((f) => f.endsWith('.md'))
    return { ...r, log: readLog(s.dir), files, report, reportText: jsonFile ? readFileSync(join(out, jsonFile), 'utf8') : '', md: md ? readFileSync(join(out, md), 'utf8') : '' }
  } finally {
    s.cleanup()
  }
}
const queries = (map) => ({ FAKE_CLAUDE_QUERIES: JSON.stringify(map) })
const healthy = queries(Object.fromEntries([...POS.map((q) => [q, 'trigger']), ...NEG.map((q) => [q, 'miss'])]))
const runs = (log) => log.filter((l) => l.prompt && l.prompt !== 'Reply with exactly: pong')

test('a clean measurement: positives triggered, negatives quiet, a verdict, exit 0', async () => {
  const r = await run(healthy)
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.verdict, 'ok')
  assert.deepEqual(r.report.totals.positives, { triggered: 4, runs: 4 })
  assert.deepEqual(r.report.totals.negatives, { fired: 0, runs: 4 })
  assert.match(r.out, /positives triggered 4\/4/)
  assert.match(r.out, /negatives fired 0\/4/)
  assert.equal(runs(r.log).length, 8, 'four queries, two runs each, by default')
})

test('the stub: a fresh project per run, the description in its frontmatter, removed afterwards', async () => {
  const r = await run(healthy)
  const rs = runs(r.log)
  const cwds = new Set(rs.map((l) => l.cwd))
  assert.equal(cwds.size, rs.length, 'every run had its own directory')
  for (const l of rs) {
    assert.equal(l.stubs.length, 1)
    assert.match(l.stubs[0], /^demo-skill-stub-[0-9a-f]{8,}\.md$/)
    assert.match(l.stubText, /^---\ndescription: \|\n {2}Demonstrates a skill for the tests: "quoted words", a colon: here/)
    assert.equal(existsSync(l.cwd), false, `${l.cwd} was removed`)
    assert.equal(l.claudecode, false)
    for (const flag of ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence']) assert.ok(l.argv.includes(flag), flag)
  }
})

test('--description overrides the skill text, and --model reaches every run', async () => {
  const r = await run(healthy, ['--description', 'An override: tested here.', '--model', 'claude-test-9', '--runs', '1'])
  assert.equal(r.code, 0, r.out)
  for (const l of runs(r.log)) {
    assert.match(l.stubText, /An override: tested here\./)
    assert.equal(l.model, 'claude-test-9')
  }
  assert.equal(r.report.model, 'claude-test-9')
  assert.equal(r.report.description.overridden, true)
  assert.equal(runs(r.log).length, 4)
})

test('each way of loading counts as a trigger; each way of not loading as a miss', async () => {
  const r = await run(
    queries({
      [POS[0]]: ['slash', 'read'],
      [POS[1]]: ['assistant-only', 'toolsearch-then-trigger'],
      [NEG[0]]: ['other-tool', 'other-skill'],
      [NEG[1]]: 'miss',
    }),
  )
  assert.equal(r.code, 0, r.out)
  const by = Object.fromEntries(r.report.queries.map((q) => [q.query, q.outcomes]))
  assert.deepEqual(by[POS[0]], ['triggered', 'triggered'])
  assert.deepEqual(by[POS[1]], ['triggered', 'triggered'])
  assert.deepEqual(by[NEG[0]], ['not-triggered', 'not-triggered'])
  assert.deepEqual(by[NEG[1]], ['not-triggered', 'not-triggered'])
})

test('detection is early: a run that hangs after the trigger ends at the trigger, not the timeout', async () => {
  const t0 = Date.now()
  const r = await run(queries({ [POS[0]]: 'trigger', [POS[1]]: 'trigger', [NEG[0]]: 'other-tool', [NEG[1]]: 'miss' }), ['--timeout', '20'])
  assert.equal(r.code, 0, r.out)
  assert.equal(r.report.totals.timeouts, 0)
  assert.ok(Date.now() - t0 < 15000, 'six hanging runs would have taken two minutes')
})

test('a hang is a timeout, not a miss; over 10% of runs means no verdict and exit 3', async () => {
  const r = await run(queries({ [POS[0]]: 'hang', [POS[1]]: 'trigger', [NEG[0]]: 'miss', [NEG[1]]: 'miss' }), ['--timeout', '1'])
  assert.equal(r.code, 3, r.out)
  assert.equal(r.report.verdict, 'no-verdict')
  assert.ok(r.report.totals.timeouts >= 1)
  assert.match(r.out, /no verdict/i)
  assert.match(r.md, /No verdict/)
  const q = r.report.queries.find((x) => x.query === POS[0])
  assert.equal(q.hits, 0)
  assert.equal(q.runs, 0, 'a timeout is not a run that did not trigger')
})

test('an authentication error is an error, never a miss', async () => {
  const r = await run({ FAKE_CLAUDE_DEFAULT: 'auth-error' })
  assert.equal(r.code, 3, r.out)
  assert.equal(r.report.verdict, 'no-verdict')
  assert.ok(r.report.totals.errors >= 1)
  assert.equal(r.report.totals.negatives.runs, 0, 'nothing scored as did-not-trigger')
  assert.match(r.out, /Failed to authenticate/)
})

test('a run whose roster does not list the stub is an error', async () => {
  const r = await run({ FAKE_CLAUDE_DEFAULT: 'hide-stub' })
  assert.equal(r.code, 3, r.out)
  assert.match(r.out, /not in the roster/)
})

test('once the errors pass 10% of the plan the run stops: no verdict is possible any more', async () => {
  const r = await run({ FAKE_CLAUDE_DEFAULT: 'api-error' }, ['--runs', '3'])
  assert.equal(r.code, 3)
  assert.equal(r.report.aborted, true)
  assert.ok(runs(r.log).length < 12, `stopped early after ${runs(r.log).length}`)
  assert.ok(runs(r.log).length >= 2)
})

test('at or under 10% the verdict stands, and the error is counted apart', async () => {
  const s = scratch()
  try {
    const items = Array.from({ length: 10 }, (_, i) => ({ query: `query number ${i}`, should_trigger: i < 5 }))
    const evals = join(s.dir, 'ten.json')
    writeFileSync(evals, JSON.stringify(items))
    const map = Object.fromEntries(items.map((it) => [it.query, it.should_trigger ? 'trigger' : 'miss']))
    map['query number 0'] = ['crash', 'trigger']
    const r = await run(queries(map), [], { evals })
    assert.equal(r.code, 0, r.out)
    assert.equal(r.report.verdict, 'ok')
    assert.equal(r.report.totals.errors, 1)
    assert.deepEqual(r.report.totals.positives, { triggered: 9, runs: 9 })
    assert.equal(r.report.queries[0].errors, 1)
    assert.equal(r.report.queries[0].runs, 1)
  } finally {
    s.cleanup()
  }
})

// ST-19: the 10% rule counts runs, so two positives can lose every run and the verdict
// stand on a positives denominator quietly shrunk. A query with nothing measured is no
// verdict; a query that lost only some runs keeps the verdict and is flagged.
const twenty = (s, modes) => {
  const items = Array.from({ length: 20 }, (_, i) => ({ query: `query number ${i}`, should_trigger: i < 10 }))
  const evals = join(s.dir, 'twenty.json')
  writeFileSync(evals, JSON.stringify(items))
  const map = Object.fromEntries(items.map((it) => [it.query, it.should_trigger ? 'trigger' : 'miss']))
  return { evals, map: { ...map, ...modes } }
}

test('two positive queries losing every run is no verdict, though the share stays at 10%', async () => {
  const s = scratch()
  try {
    const { evals, map } = twenty(s, { 'query number 3': 'hang', 'query number 7': 'hang' })
    const r = await run(queries(map), ['--timeout', '1'], { evals })
    assert.equal(r.report.totals.timeouts, 4)
    assert.equal(r.report.totals.executed, 40, 'not stopped: 4 of 40 is not more than 10%')
    assert.equal(r.code, 3, r.out)
    assert.equal(r.report.verdict, 'no-verdict')
    assert.deepEqual(r.report.lostQueries, ['query number 3', 'query number 7'])
    assert.match(r.out, /no verdict/i)
    assert.match(r.out, /query number 3/)
    assert.match(r.out, /lost every run/)
    assert.match(r.md, /No verdict/)
    assert.match(r.md, /query number 7/)
  } finally {
    s.cleanup()
  }
})

test('a query that lost some but not all of its runs keeps the verdict and is flagged', async () => {
  const s = scratch()
  try {
    const { evals, map } = twenty(s, { 'query number 3': ['hang', 'trigger'] })
    const r = await run(queries(map), ['--timeout', '1'], { evals })
    assert.equal(r.code, 0, r.out)
    assert.equal(r.report.verdict, 'ok')
    assert.deepEqual(r.report.lostQueries, [])
    assert.deepEqual(r.report.partialQueries, ['query number 3'])
    assert.equal(r.report.queries[3].partial, true)
    assert.equal(r.report.queries[4].partial, false)
    assert.match(r.out, /measured on fewer runs than planned.*1 query/i)
    assert.match(r.md, /\| query number 3 \| yes \| 1\/1 \| 1 \| 0 \| pass \(1 of 2 runs\) \|/)
  } finally {
    s.cleanup()
  }
})

test('a failed gate refuses the run: no query is ever sent', async () => {
  const r = await run({ ...healthy, FAKE_CLAUDE_AUTH: 'out' })
  assert.equal(r.code, 2)
  assert.equal(runs(r.log).length, 0)
  assert.equal(r.files.length, 0, 'no report for a measurement that was not made')
})

test('a plugin conflict refuses the run unless allowed, and an allowed one is recorded', async () => {
  const refused = await run({ ...healthy, FAKE_CLAUDE_PLUGINS: 'conflict' })
  assert.equal(refused.code, 2)
  assert.equal(runs(refused.log).length, 0)
  const allowed = await run({ ...healthy, FAKE_CLAUDE_PLUGINS: 'conflict' }, ['--allow-conflict', '--runs', '1'])
  assert.equal(allowed.code, 0, allowed.out)
  assert.equal(allowed.report.conflictAllowed, true)
  assert.match(allowed.md, /conflict/i)
})

test('the report: date, versions, roster, settings, every outcome — and nothing else', async () => {
  const r = await run({ ...healthy, FAKE_CLAUDE_COMMANDS: '83' })
  const rep = r.report
  assert.match(rep.date, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(r.files.includes(`${rep.date}-demo-skill.json`))
  assert.ok(r.files.includes(`${rep.date}-demo-skill.md`))
  assert.equal(rep.skill, 'demo-skill')
  assert.equal(rep.cliVersion, '2.1.268 (Claude Code)')
  assert.equal(rep.model, 'fake-model-1')
  assert.equal(rep.roster.slashCommands, 83)
  assert.equal(rep.roster.skills, 3)
  assert.equal(rep.runsPerQuery, 2)
  assert.equal(rep.timeoutSeconds, 5)
  assert.equal(rep.triggerThreshold, 0.5)
  assert.equal(rep.noVerdictThreshold, 0.1)
  assert.equal(rep.queries[1].note, 'carried through to the report')
  assert.deepEqual(rep.queries[0].outcomes, ['triggered', 'triggered'])
  assert.equal(rep.queries[0].pass, true)
  assert.match(rep.description.sha256, /^[0-9a-f]{64}$/)
  // Nothing but the queries, the counts and the versions: no description text, no paths.
  assert.ok(!r.reportText.includes('Demonstrates a skill'), 'the description text is not in the report')
  assert.ok(!r.reportText.includes(SKILL), 'no skill path')
  assert.ok(!r.reportText.includes('stub-'), 'no stub names')
  assert.ok(!r.reportText.includes('fixtures'), 'no eval path')
  assert.match(r.md, /\| show me a demo of the thing \| yes \| 2\/2 \|/)
  assert.match(r.md, /83 slash commands/)
})

// ST-20: the report records what compare needs to tell two environments apart — the
// roster's members, the model each run reported, and what the inherited environment
// contributed, counted — and still no description text, path or stub name.
test('the report: roster members, per-run model, the environment counted — still no text, path or stub', async () => {
  const SECRET = 'private memory text that must not leak'
  const setup = (dir) => {
    const config = join(dir, 'home', '.claude')
    mkdirSync(join(config, 'rules'), { recursive: true })
    writeFileSync(join(config, 'CLAUDE.md'), SECRET)
    writeFileSync(join(config, 'rules', 'one.md'), SECRET)
    writeFileSync(join(config, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `echo ${SECRET}` }, { type: 'command', command: 'true' }] }] } }))
  }
  const r = await run({ ...healthy, FAKE_CLAUDE_COMMANDS: '3', FAKE_CLAUDE_SKILLS: '2', FAKE_CLAUDE_ROSTER_EXTRA: 'zeta-cmd', FAKE_CLAUDE_MCP: '2', FAKE_CLAUDE_RUN_MODEL: 'fake-model-2' }, [], { setup })
  assert.equal(r.code, 0, r.out)
  const rep = r.report
  assert.deepEqual(rep.roster, { slashCommands: 4, skills: 3, commandNames: ['cmd-1', 'cmd-2', 'cmd-3', 'zeta-cmd'], skillNames: ['skill-1', 'skill-2', 'zeta-cmd'] })
  assert.equal(rep.model, 'fake-model-1', 'the preflight model, as before')
  assert.deepEqual(rep.runModels, { 'fake-model-2': 8 })
  assert.deepEqual(rep.queries[0].models, ['fake-model-2', 'fake-model-2'])
  assert.equal(rep.environment.memoryFiles.user, 2)
  assert.equal(typeof rep.environment.memoryFiles.project, 'number')
  assert.equal(rep.environment.hooks, 2)
  assert.equal(rep.environment.mcpServers, 2)
  assert.match(r.md, /fake-model-2/)
  assert.match(r.md, /2 user memory file/)
  assert.match(r.md, /zeta-cmd/)
  for (const leak of [SECRET, 'Demonstrates a skill', SKILL, 'stub-', 'fixtures', 'home', 'CLAUDE.md', 'settings.json', 'skilltrigger-run-', 'skilltrigger-preflight-']) {
    assert.ok(!r.reportText.includes(leak), `the report carries ${leak}`)
    assert.ok(!r.md.includes(leak), `the Markdown carries ${leak}`)
  }
})

test('a second report on the same day does not overwrite the first', async () => {
  const s = scratch()
  try {
    const out = join(s.dir, 'out')
    const args = ['run', '--skill', SKILL, '--eval', EVALS, '--out', out, '--runs', '1']
    assert.equal((await cli(args, fakeEnv(s.dir, healthy))).code, 0)
    assert.equal((await cli(args, fakeEnv(s.dir, healthy))).code, 0)
    assert.equal(readdirSync(out).filter((f) => f.endsWith('.json')).length, 2)
  } finally {
    s.cleanup()
  }
})

test('usage errors exit 1 before any gate runs', async () => {
  const s = scratch()
  try {
    const env = fakeEnv(s.dir)
    for (const args of [['run'], ['run', '--skill', SKILL], ['run', '--skill', SKILL, '--eval', EVALS, '--runs', '0'], ['run', '--skill', SKILL, '--eval', EVALS, '--workers', '4'], ['bogus']]) {
      const r = await cli(args, env)
      assert.equal(r.code, 1, `${args.join(' ')}\n${r.out}`)
    }
    assert.equal(readLog(s.dir).length, 0)
  } finally {
    s.cleanup()
  }
})
