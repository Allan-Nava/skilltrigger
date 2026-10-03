#!/usr/bin/env node
// skilltrigger — how often a Claude Code skill's description makes the model load it,
// measured behind gates that refuse to report a number they cannot trust.
//
//   skilltrigger preflight [--model M] [--skill <dir>] [--out <dir>] [--allow-conflict]
//   skilltrigger run --skill <dir> --eval <file> [--runs 2] [--model M] [--timeout 30]
//                    [--description "<override>"] [--baseline-description <text|file>]
//                    [--out <dir>] [--allow-conflict]
//   skilltrigger compare <a.json> <b.json>
//   skilltrigger check
//
// Exit codes: 0 done · 1 usage or input error · 2 a gate failed · 3 no verdict.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UsageError, number, parseArgs } from './lib/args.mjs'
import { checkRepo } from './lib/check.mjs'
import { compare } from './lib/compare.mjs'
import { formatGates, preflight } from './lib/gates.mjs'
import { NO_VERDICT_SHARE, headline, localDate, pairedLines, partialLine, summarise, summarisePaired, writeReport } from './lib/report.mjs'
import { runAll } from './lib/runner.mjs'
import { loadEvalSet, loadSkill, parseFrontmatter } from './lib/skill.mjs'
import { formatReminders, readToggles, reconcile, writeToggles } from './lib/toggles.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// The comment block under the shebang, up to the first line of code.
const HELP = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  .split('\n')
  .slice(1)
  .reduce((acc, l) => (acc.done || !l.startsWith('//') ? { ...acc, done: true } : { ...acc, lines: [...acc.lines, l.replace(/^\/\/ ?/, '')] }), { lines: [], done: false })
  .lines.join('\n')

const DEFAULT_OUT = 'skilltrigger-results'

// --baseline-description takes the text itself or a file: a SKILL.md gives the description
// in its frontmatter (the old version of the skill, checked out beside the new), any other
// file its whole content.
// One read, no exists-then-read: a value that names no readable file is the text itself.
const NOT_A_FILE = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'ENAMETOOLONG', 'EINVAL', 'ERR_INVALID_ARG_VALUE', 'ERR_INVALID_ARG_TYPE'])
function baselineText(value) {
  let text
  try {
    text = readFileSync(value, 'utf8')
  } catch (e) {
    if (NOT_A_FILE.has(e.code)) return value
    throw new UsageError(`--baseline-description: ${value} could not be read (${e.code ?? e.message})`)
  }
  const fm = parseFrontmatter(text)
  if (fm) {
    if (!fm.description) throw new UsageError(`--baseline-description: ${value} has frontmatter but no description in it`)
    return fm.description
  }
  return text.trim()
}

// The gates, then the re-enable reminder: the toggles the conflict gate printed are kept
// under --out, and any of those plugins still disabled is named with its enable command.
async function gates({ model, skillName, allowConflict, outDir }) {
  console.log(`skilltrigger ${pkg.version} — preflight`)
  const pf = await preflight({ model, skillName, allowConflict })
  console.log(formatGates(pf.gates))
  const conflict = pf.gates.find((x) => x.id === 'conflict')
  const { keep, reminders } = reconcile({ remembered: readToggles(outDir), conflicts: conflict?.conflicts ?? [], plugins: conflict?.plugins ?? null, date: localDate() })
  writeToggles(outDir, keep)
  const note = formatReminders(reminders)
  if (note) console.log(`\n${note}`)
  return { ...pf, reminders }
}

async function cmdPreflight(argv) {
  const { opts, positional } = parseArgs(argv, { model: 'string', skill: 'string', out: 'string', 'allow-conflict': 'boolean' })
  if (positional.length) throw new UsageError(`unexpected argument: ${positional[0]}`)
  const skillName = opts.skill ? loadSkill(opts.skill).name : null
  const pf = await gates({ model: opts.model ?? null, skillName, allowConflict: Boolean(opts['allow-conflict']), outDir: resolve(opts.out ?? DEFAULT_OUT) })
  if (!pf.ok) {
    console.log('\npreflight failed — a run now would measure the failure, not the description')
    return 2
  }
  console.log('\npreflight ok')
  return 0
}

async function cmdRun(argv) {
  const { opts, positional } = parseArgs(argv, {
    skill: 'string',
    eval: 'string',
    runs: 'string',
    model: 'string',
    timeout: 'string',
    description: 'string',
    'baseline-description': 'string',
    out: 'string',
    'allow-conflict': 'boolean',
  })
  if (positional.length) throw new UsageError(`unexpected argument: ${positional[0]}`)
  if (!opts.skill) throw new UsageError('run needs --skill <dir>')
  if (!opts.eval) throw new UsageError('run needs --eval <file>')
  const runs = number(opts, 'runs', { fallback: 2, min: 1, integer: true })
  const timeout = number(opts, 'timeout', { fallback: 30, min: 0.1 })
  const skill = loadSkill(opts.skill)
  const items = loadEvalSet(opts.eval)
  const overridden = opts.description !== undefined
  const description = overridden ? opts.description : skill.description
  if (!description.trim()) throw new UsageError('--description is empty')
  const baseline = opts['baseline-description'] === undefined ? null : baselineText(opts['baseline-description'])
  if (baseline !== null && !baseline.trim()) throw new UsageError('--baseline-description is empty')
  const outDir = resolve(opts.out ?? DEFAULT_OUT)
  const model = opts.model ?? null

  const pf = await gates({ model, skillName: skill.name, allowConflict: Boolean(opts['allow-conflict']), outDir })
  if (!pf.ok) {
    console.log('\nrefusing to run: a failed gate makes the number meaningless. Fix it and run again.')
    return 2
  }

  const sides = baseline === null ? 1 : 2
  const planned = items.length * runs * sides
  console.log(`\n${skill.name}: ${items.length} queries × ${runs} runs${baseline === null ? '' : ' × 2 descriptions (baseline and candidate, interleaved)'} = ${planned}, serial, ${timeout} s timeout each`)
  if (baseline !== null && baseline === description) console.log('  the two descriptions are identical: every delta below is noise, which is what an A/A run is for')
  const width = String(planned).length
  const mark = { triggered: '+', 'not-triggered': '.', timeout: 'T', error: 'E' }
  const tag = { baseline: 'base ', candidate: 'cand ' }
  const res = await runAll({
    items,
    runs,
    skillName: skill.name,
    description,
    baseline,
    model,
    timeoutMs: timeout * 1000,
    env: process.env,
    noVerdictShare: NO_VERDICT_SHARE,
    onRun: ({ item, side, done, outcome, reason, ms }) => {
      const q = item.query.length > 70 ? `${item.query.slice(0, 69)}…` : item.query
      const why = outcome === 'timeout' || outcome === 'error' ? `  — ${reason}` : ''
      console.log(`  [${String(done).padStart(width)}/${planned}] ${side ? tag[side] : ''}${mark[outcome]} ${outcome.padEnd(13)} ${(ms / 1000).toFixed(1).padStart(5)} s  ${item.should_trigger ? 'pos' : 'neg'}  ${q}${why}`)
    },
  })
  if (res.aborted) console.log(`  stopped: more than ${NO_VERDICT_SHARE * 100}% of the planned runs${baseline === null ? '' : ' of one description'} timed out or failed — no verdict is possible`)

  const common = { items, skillName: skill.name, facts: pf.facts, runsPerQuery: runs, timeoutSeconds: timeout, aborted: res.aborted, toolVersion: pkg.version }
  const rep =
    baseline === null
      ? summarise({ ...common, outcomes: res.outcomes, models: res.models, description, overridden, planned })
      : summarisePaired({ ...common, baseline: res.baseline, candidate: res.candidate, baselineDescription: baseline, description, overridden })
  const files = writeReport(rep, outDir)
  if (rep.paired) console.log(`\n${pairedLines(rep).join('\n')}`)
  else {
    console.log(`\n${headline(rep)}`)
    if (partialLine(rep)) console.log(partialLine(rep))
    if (rep.verdict === 'ok') console.log(`per query: ${rep.totals.passed}/${rep.totals.queries} pass at a trigger rate threshold of ${rep.triggerThreshold}; no-verdict threshold ${rep.noVerdictThreshold * 100}% of runs`)
  }
  console.log(`report: ${files.json}\n        ${files.md}`)
  const after = formatReminders(pf.reminders, { after: true })
  if (after) console.log(`\n${after}`)
  return rep.verdict === 'ok' ? 0 : 3
}

function cmdCompare(argv) {
  const { positional } = parseArgs(argv, {})
  if (positional.length !== 2) throw new UsageError('compare needs two report files: compare <a.json> <b.json>')
  const [a, b] = positional.map((f) => {
    let r
    try {
      r = JSON.parse(readFileSync(f, 'utf8'))
    } catch (e) {
      throw new UsageError(`${f}: not a readable report (${e.message})`)
    }
    if (r?.tool === 'skilltrigger' && r.paired) throw new UsageError(`${f}: a paired report (run --baseline-description) — it carries its own comparison of baseline and candidate; compare takes two single reports`)
    if (r?.tool !== 'skilltrigger' || !Array.isArray(r.queries)) throw new UsageError(`${f}: not a skilltrigger report`)
    return r
  })
  console.log(compare(a, b).text)
  return 0
}

function cmdCheck() {
  const errors = checkRepo(ROOT)
  for (const e of errors) console.error(`check: ${e}`)
  if (errors.length) return 1
  console.log(`ok — skilltrigger ${pkg.version}: CHANGELOG, README traps, no dependencies, no private strings`)
  return 0
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  try {
    switch (cmd) {
      case 'preflight':
        return await cmdPreflight(rest)
      case 'run':
        return await cmdRun(rest)
      case 'compare':
        return cmdCompare(rest)
      case 'check':
        return cmdCheck()
      case '--version':
      case '-v':
        console.log(pkg.version)
        return 0
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP)
        return 0
      default:
        throw new UsageError(`unknown command: ${cmd}`)
    }
  } catch (e) {
    // A bad skill directory or eval file is the user's input, not a crash: one line.
    console.error(`skilltrigger: ${e.message}`)
    if (e instanceof UsageError) console.error('run `skilltrigger help` for usage')
    if (process.env.SKILLTRIGGER_DEBUG) console.error(e.stack)
    return 1
  }
}

process.exitCode = await main()
