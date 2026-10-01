// The report: what was measured, against what, and whether it may be read at all.
//
// It carries the eval queries (and any extra fields they came with), the counts and
// the versions — nothing else. No description text (a hash and a length stand in for
// it, so compare can tell two texts apart), no paths, no stub names, no stderr.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const TRIGGER_THRESHOLD = 0.5
export const NO_VERDICT_SHARE = 0.1

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function summarise({ items, outcomes, skillName, description, overridden, facts, runsPerQuery, timeoutSeconds, planned, aborted, toolVersion, date = localDate() }) {
  const queries = items.map((item, i) => {
    const o = outcomes[i] ?? []
    const hits = o.filter((x) => x === 'triggered').length
    const runs = o.filter((x) => x === 'triggered' || x === 'not-triggered').length
    const rate = runs ? hits / runs : null
    const pass = rate === null ? null : item.should_trigger ? rate >= TRIGGER_THRESHOLD : rate < TRIGGER_THRESHOLD
    return { ...item, outcomes: o, hits, runs, timeouts: o.filter((x) => x === 'timeout').length, errors: o.filter((x) => x === 'error').length, pass }
  })
  const sum = (list, k) => list.reduce((a, q) => a + q[k], 0)
  const pos = queries.filter((q) => q.should_trigger)
  const neg = queries.filter((q) => !q.should_trigger)
  const executed = queries.reduce((a, q) => a + q.outcomes.length, 0)
  const timeouts = sum(queries, 'timeouts')
  const errors = sum(queries, 'errors')
  const badShare = executed ? (timeouts + errors) / executed : 1
  const verdict = !aborted && executed > 0 && badShare <= NO_VERDICT_SHARE ? 'ok' : 'no-verdict'
  return {
    tool: 'skilltrigger',
    toolVersion,
    date,
    skill: skillName,
    cliVersion: facts.cliVersion,
    model: facts.model ?? 'default',
    roster: facts.roster,
    runsPerQuery,
    timeoutSeconds,
    triggerThreshold: TRIGGER_THRESHOLD,
    noVerdictThreshold: NO_VERDICT_SHARE,
    conflictAllowed: Boolean(facts.conflictAllowed),
    description: { bytes: Buffer.byteLength(description), sha256: createHash('sha256').update(description).digest('hex'), overridden: Boolean(overridden) },
    verdict,
    aborted: Boolean(aborted),
    totals: {
      planned,
      executed,
      positives: { triggered: sum(pos, 'hits'), runs: sum(pos, 'runs') },
      negatives: { fired: sum(neg, 'hits'), runs: sum(neg, 'runs') },
      timeouts,
      errors,
      passed: queries.filter((q) => q.pass === true).length,
      queries: queries.length,
    },
    queries,
  }
}

const pct = (n) => `${Math.round(n * 100)}%`
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function headline(rep) {
  const t = rep.totals
  if (rep.verdict !== 'ok') {
    return `no verdict: ${t.timeouts} timeout(s) and ${t.errors} error(s) in ${t.executed} run(s)${rep.aborted ? ` (stopped after ${t.executed} of ${t.planned})` : ''} — more than ${pct(rep.noVerdictThreshold)} of the runs did not measure anything`
  }
  return `positives triggered ${t.positives.triggered}/${t.positives.runs} · negatives fired ${t.negatives.fired}/${t.negatives.runs} · ${t.timeouts} timeout(s), ${t.errors} error(s) counted apart`
}

export function toMarkdown(rep) {
  const t = rep.totals
  const roster = rep.roster ? `${rep.roster.slashCommands} slash commands${rep.roster.skills === null ? '' : `, ${rep.roster.skills} skills`}` : 'unknown'
  const out = [
    `# skilltrigger — ${rep.skill}, ${rep.date}`,
    '',
    rep.verdict === 'ok' ? `**${headline(rep)}**` : `**No verdict.** ${headline(rep).replace(/^no verdict: /, '')}. The per-query counts below are not a measurement.`,
    '',
    '| | |',
    '|---|---|',
    `| CLI | ${cell(rep.cliVersion)} |`,
    `| Model | ${cell(rep.model)} |`,
    `| Roster | ${roster} |`,
    `| Runs per query | ${rep.runsPerQuery} |`,
    `| Timeout | ${rep.timeoutSeconds} s |`,
    `| Pass threshold | trigger rate ≥ ${rep.triggerThreshold} for a positive, < ${rep.triggerThreshold} for a negative |`,
    `| No verdict when | timeouts + errors > ${pct(rep.noVerdictThreshold)} of runs |`,
    `| Description | ${rep.description.bytes} bytes, sha256 ${rep.description.sha256.slice(0, 12)}${rep.description.overridden ? ', overridden with --description' : ''} |`,
    ...(rep.conflictAllowed ? ['| Plugin conflict | **allowed with --allow-conflict** — a same-named skill was visible during the runs |'] : []),
    `| Version | skilltrigger ${rep.toolVersion} |`,
    '',
    '| Query | Should trigger | Hits/runs | Timeouts | Errors | Pass |',
    '|---|---|---:|---:|---:|---|',
    ...rep.queries.map((q) => `| ${cell(q.query)} | ${q.should_trigger ? 'yes' : 'no'} | ${q.hits}/${q.runs} | ${q.timeouts} | ${q.errors} | ${q.pass === null ? '—' : q.pass ? 'pass' : 'fail'} |`),
    '',
    `${t.passed} of ${t.queries} queries pass. Two runs per query resolve to ±1 per query: read a difference of one hit as noise.`,
    '',
  ]
  return out.join('\n')
}

// <out>/<date>-<skill>.json and .md; a second report the same day gets -2, -3…
export function writeReport(rep, outDir) {
  mkdirSync(outDir, { recursive: true })
  let base = `${rep.date}-${rep.skill}`
  for (let n = 2; existsSync(join(outDir, `${base}.json`)) || existsSync(join(outDir, `${base}.md`)); n++) base = `${rep.date}-${rep.skill}-${n}`
  const json = join(outDir, `${base}.json`)
  const md = join(outDir, `${base}.md`)
  writeFileSync(json, JSON.stringify(rep, null, 2) + '\n')
  writeFileSync(md, toMarkdown(rep))
  return { json, md }
}
