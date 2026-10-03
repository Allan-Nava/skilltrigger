// The report: what was measured, against what, and whether it may be read at all.
//
// It carries the eval queries (and any extra fields they came with), the counts, the
// versions, the roster's member hashes and the model each run reported — nothing else.
// No description text (a hash and a length stand in for it, so compare can tell two
// texts apart), no paths, no stub names, no stderr; what the inherited environment
// contributed is counted, never quoted.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deltas, totalIsNoise } from './compare.mjs'

export const TRIGGER_THRESHOLD = 0.5
export const NO_VERDICT_SHARE = 0.1

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// The default per-query pass threshold; `run --threshold` moves it (ST-17). It decides pass
// and fail per query and nothing else — not the totals, not the verdict.
export function summarise({ items, outcomes, models = [], skillName, description, overridden, facts, runsPerQuery, timeoutSeconds, threshold = TRIGGER_THRESHOLD, planned, aborted, toolVersion, date = localDate() }) {
  const queries = items.map((item, i) => {
    const o = outcomes[i] ?? []
    const hits = o.filter((x) => x === 'triggered').length
    const runs = o.filter((x) => x === 'triggered' || x === 'not-triggered').length
    const rate = runs ? hits / runs : null
    const pass = rate === null ? null : item.should_trigger ? rate >= threshold : rate < threshold
    // partial: some of its executed runs measured nothing, but not all of them.
    return { ...item, outcomes: o, models: models[i] ?? [], hits, runs, timeouts: o.filter((x) => x === 'timeout').length, errors: o.filter((x) => x === 'error').length, pass, partial: runs > 0 && runs < o.length }
  })
  const sum = (list, k) => list.reduce((a, q) => a + q[k], 0)
  const pos = queries.filter((q) => q.should_trigger)
  const neg = queries.filter((q) => !q.should_trigger)
  const executed = queries.reduce((a, q) => a + q.outcomes.length, 0)
  const timeouts = sum(queries, 'timeouts')
  const errors = sum(queries, 'errors')
  const badShare = executed ? (timeouts + errors) / executed : 1
  // The share counts runs, not queries: two positives can lose every run inside 10% and
  // leave a positives total that silently omits them. A query that was run and measured
  // nothing makes the verdict impossible to read query by query, so it is no verdict (ST-19).
  const lostQueries = queries.filter((q) => q.outcomes.length > 0 && q.runs === 0).map((q) => q.query)
  const partialQueries = queries.filter((q) => q.partial).map((q) => q.query)
  const runModels = {}
  for (const q of queries) for (const m of q.models) if (m) runModels[m] = (runModels[m] ?? 0) + 1
  const verdict = !aborted && executed > 0 && badShare <= NO_VERDICT_SHARE && !lostQueries.length ? 'ok' : 'no-verdict'
  return {
    tool: 'skilltrigger',
    toolVersion,
    date,
    skill: skillName,
    cliVersion: facts.cliVersion,
    model: facts.model ?? 'default',
    roster: facts.roster,
    runModels,
    environment: facts.environment ?? null,
    runsPerQuery,
    timeoutSeconds,
    triggerThreshold: threshold,
    noVerdictThreshold: NO_VERDICT_SHARE,
    conflictAllowed: Boolean(facts.conflictAllowed),
    description: { bytes: Buffer.byteLength(description), sha256: createHash('sha256').update(description).digest('hex'), overridden: Boolean(overridden) },
    verdict,
    aborted: Boolean(aborted),
    lostQueries,
    partialQueries,
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
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function formatEnvironment(e) {
  if (!e) return 'unknown'
  const mem = e.memoryFiles ? `${plural(e.memoryFiles.project, 'project memory file')}, ${plural(e.memoryFiles.user, 'user memory file')}` : 'memory files unknown'
  return `${mem} · ${plural(e.hooks ?? 0, 'hook')} · ${e.mcpServers === null || e.mcpServers === undefined ? 'MCP servers not listed' : plural(e.mcpServers, 'MCP server')}`
}
export const formatRunModels = (m) => (m && Object.keys(m).length ? Object.entries(m).map(([k, v]) => `${k} ×${v}`).join(', ') : 'none reported')
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

const quoted = (list) => list.map((q) => `"${q.length > 60 ? `${q.slice(0, 59)}…` : q}"`).join(', ')
const queriesWord = (n) => `${n} ${n === 1 ? 'query' : 'queries'}`

export function headline(rep) {
  const t = rep.totals
  if (rep.verdict !== 'ok') {
    const share = (t.timeouts + t.errors) / (t.executed || 1) > rep.noVerdictThreshold || !t.executed || rep.aborted
    const lost = rep.lostQueries ?? []
    const parts = []
    if (share) parts.push(`${t.timeouts} timeout(s) and ${t.errors} error(s) in ${t.executed} run(s)${rep.aborted ? ` (stopped after ${t.executed} of ${t.planned})` : ''} — more than ${pct(rep.noVerdictThreshold)} of the runs did not measure anything`)
    if (lost.length) parts.push(`${queriesWord(lost.length)} lost every run to timeouts or errors — ${quoted(lost)} — and the totals would leave ${lost.length === 1 ? 'it' : 'them'} out`)
    if (!parts.length) parts.push(`${t.timeouts} timeout(s) and ${t.errors} error(s) in ${t.executed} run(s)`)
    return `no verdict: ${parts.join('; ')}`
  }
  return `positives triggered ${t.positives.triggered}/${t.positives.runs} · negatives fired ${t.negatives.fired}/${t.negatives.runs} · ${t.timeouts} timeout(s), ${t.errors} error(s) counted apart`
}

// A line naming the queries that kept the verdict on fewer measured runs than planned.
export function partialLine(rep) {
  const p = rep.partialQueries ?? []
  return p.length ? `measured on fewer runs than planned: ${queriesWord(p.length)} — ${quoted(p)}` : null
}

const rosterCell = (rep) => (rep.roster ? `${rep.roster.slashCommands} slash commands${rep.roster.skills === null ? '' : `, ${rep.roster.skills} skills`}` : 'unknown')
const descriptionCell = (d, note = '') => `${d.bytes} bytes, sha256 ${d.sha256.slice(0, 12)}${note}`
const passCell = (q) => `${q.pass === null ? (q.outcomes.length ? 'lost every run' : '—') : q.pass ? 'pass' : 'fail'}${q.partial ? ` (${q.runs} of ${q.outcomes.length} runs)` : ''}`

// The rows that say where a number was measured: the same in a single and a paired report.
function environmentRows(rep, { runs, noVerdict, descriptions }) {
  return [
    '| | |',
    '|---|---|',
    `| CLI | ${cell(rep.cliVersion)} |`,
    `| Model | ${cell(rep.model)} |`,
    `| Models the runs reported | ${cell(formatRunModels(rep.runModels))} |`,
    `| Roster | ${rosterCell(rep)} |`,
    `| Inherited environment | ${formatEnvironment(rep.environment)} |`,
    `| Runs per query | ${runs} |`,
    `| Timeout | ${rep.timeoutSeconds} s |`,
    `| Pass threshold | trigger rate ≥ ${rep.triggerThreshold} for a positive, < ${rep.triggerThreshold} for a negative |`,
    `| No verdict when | ${noVerdict} |`,
    ...descriptions,
    ...(rep.conflictAllowed ? ['| Plugin conflict | **allowed with --allow-conflict** — a same-named skill was visible during the runs |'] : []),
    `| Version | skilltrigger ${rep.toolVersion} |`,
  ]
}

export function toMarkdown(rep) {
  if (rep.paired) return pairedMarkdown(rep)
  const t = rep.totals
  const out = [
    `# skilltrigger — ${rep.skill}, ${rep.date}`,
    '',
    rep.verdict === 'ok' ? `**${headline(rep)}**` : `**No verdict.** ${headline(rep).replace(/^no verdict: /, '')}. The per-query counts below are not a measurement.`,
    '',
    ...environmentRows(rep, {
      runs: rep.runsPerQuery,
      noVerdict: `timeouts + errors > ${pct(rep.noVerdictThreshold)} of runs, or any query lost every run`,
      descriptions: [`| Description | ${descriptionCell(rep.description, rep.description.overridden ? ', overridden with --description' : '')} |`],
    }),
    '',
    '| Query | Should trigger | Hits/runs | Timeouts | Errors | Pass |',
    '|---|---|---:|---:|---:|---|',
    ...rep.queries.map((q) => `| ${cell(q.query)} | ${q.should_trigger ? 'yes' : 'no'} | ${q.hits}/${q.runs} | ${q.timeouts} | ${q.errors} | ${passCell(q)} |`),
    '',
    ...(partialLine(rep) ? [`${cell(partialLine(rep).replace(/^m/, 'M'))}.`, ''] : []),
    `${t.passed} of ${t.queries} queries pass. Two runs per query resolve to ±1 per query: read a difference of one hit as noise.`,
    '',
  ]
  return out.join('\n')
}

// --- a paired run (ST-14) ------------------------------------------------------------
//
// The baseline and the candidate measured in one invocation, interleaved run by run. Each
// side is a complete single report — the same summarise(), the same verdict rule — and the
// comparison is compare's own arithmetic, per-query deltas and noise labels included. The
// verdict is the comparison's: no verdict on either side is no verdict for both.
export const INTERLEAVING = 'each query once with each description, back to back; the order inside the pair flips every pass'

// What both sides share by construction, lifted to the top of the paired report.
const SHARED = ['tool', 'toolVersion', 'date', 'skill', 'cliVersion', 'model', 'roster', 'environment', 'runsPerQuery', 'timeoutSeconds', 'triggerThreshold', 'noVerdictThreshold', 'conflictAllowed']

export function summarisePaired({ items, skillName, baseline, candidate, baselineDescription, description, overridden, facts, runsPerQuery, timeoutSeconds, threshold = TRIGGER_THRESHOLD, aborted, toolVersion, date = localDate() }) {
  // One threshold for both sides: a pass column judged two ways would not compare (ST-17).
  const common = { items, skillName, facts, runsPerQuery, timeoutSeconds, threshold, planned: items.length * runsPerQuery, aborted, toolVersion, date }
  const base = summarise({ ...common, outcomes: baseline.outcomes, models: baseline.models, description: baselineDescription, overridden: false })
  const cand = summarise({ ...common, outcomes: candidate.outcomes, models: candidate.models, description, overridden })
  const d = deltas(base, cand)
  const hr = (x) => ({ hits: x.hits, runs: x.runs })
  const total = (t) => ({ baseline: hr(t.a), candidate: hr(t.b), delta: t.delta, noise: totalIsNoise(t.delta, d.noiseAt) })
  const runModels = {}
  for (const side of [base, cand]) for (const [m, n] of Object.entries(side.runModels)) runModels[m] = (runModels[m] ?? 0) + n
  return {
    ...Object.fromEntries(SHARED.map((k) => [k, cand[k]])),
    runModels,
    paired: true,
    interleaving: INTERLEAVING,
    verdict: base.verdict === 'ok' && cand.verdict === 'ok' ? 'ok' : 'no-verdict',
    aborted: Boolean(aborted),
    baseline: base,
    candidate: cand,
    comparison: {
      rows: d.rows.map((r) => ({ query: r.query, should_trigger: r.should_trigger, baseline: hr(r.a), candidate: hr(r.b), delta: r.delta, noise: r.noise })),
      totals: { positives: total(d.totals.positives), negatives: total(d.totals.negatives) },
    },
  }
}

const sign = (n) => (n > 0 ? `+${n}` : String(n))
const deltaCell = (r) => `${sign(r.delta)}${r.noise ? ' (noise)' : ''}`
const totalLine = (label, t) => `${label} ${t.baseline.hits}/${t.baseline.runs} → ${t.candidate.hits}/${t.candidate.runs} (${sign(t.delta)})${t.noise ? ' (within noise)' : ''}`

// The lines `run` prints at the end of a paired run: each side's headline, then — when
// there is a verdict — the deltas, per query and in total.
export function pairedLines(rep) {
  const lines = [`baseline   ${headline(rep.baseline)}`, `candidate  ${headline(rep.candidate)}`]
  for (const [k, side] of [['baseline', rep.baseline], ['candidate', rep.candidate]]) if (partialLine(side)) lines.push(`${k}: ${partialLine(side)}`)
  if (rep.verdict !== 'ok') {
    lines.push('no verdict: a side without one leaves nothing to compare — the deltas are not printed')
    return lines
  }
  lines.push('')
  for (const r of rep.comparison.rows) lines.push(`  ${r.should_trigger ? 'pos' : 'neg'}  ${r.baseline.hits}/${r.baseline.runs} → ${r.candidate.hits}/${r.candidate.runs}  ${r.delta === 0 ? ' 0' : deltaCell(r)}  ${r.query}`)
  lines.push('')
  lines.push(totalLine('positives triggered', rep.comparison.totals.positives))
  lines.push(totalLine('negatives fired', rep.comparison.totals.negatives))
  return lines
}

function pairedMarkdown(rep) {
  const { baseline: b, candidate: c, comparison } = rep
  const bq = new Map(b.queries.map((q) => [q.query, q]))
  const cq = new Map(c.queries.map((q) => [q.query, q]))
  const sideVerdict = (k, side) => `${k}: ${side.verdict === 'ok' ? 'a verdict' : headline(side)}`
  const out = [
    `# skilltrigger — ${rep.skill}, ${rep.date}, baseline vs candidate`,
    '',
    rep.verdict === 'ok'
      ? `**${totalLine('positives triggered', comparison.totals.positives)} · ${totalLine('negatives fired', comparison.totals.negatives)}**`
      : `**No verdict.** ${cell([sideVerdict('baseline', b), sideVerdict('candidate', c)].join('; '))}. The per-query counts below are not a measurement.`,
    '',
    ...environmentRows(rep, {
      runs: `${rep.runsPerQuery} per description, interleaved — ${INTERLEAVING}`,
      noVerdict: `on either side, timeouts + errors > ${pct(rep.noVerdictThreshold)} of its runs, or any query lost every run`,
      descriptions: [`| Baseline | ${descriptionCell(b.description, ', from --baseline-description')} |`, `| Candidate | ${descriptionCell(c.description, c.description.overridden ? ', overridden with --description' : ', the text in SKILL.md')} |`],
    }),
    '',
    '| Query | Should trigger | Baseline | Candidate | Delta | Baseline pass | Candidate pass |',
    '|---|---|---:|---:|---:|---|---|',
    ...comparison.rows.map((r) => `| ${cell(r.query)} | ${r.should_trigger ? 'yes' : 'no'} | ${r.baseline.hits}/${r.baseline.runs} | ${r.candidate.hits}/${r.candidate.runs} | ${r.delta === 0 ? '0' : deltaCell(r)} | ${passCell(bq.get(r.query))} | ${passCell(cq.get(r.query))} |`),
    '',
    `- baseline: ${cell(headline(b))}`,
    `- candidate: ${cell(headline(c))}`,
    '',
    totalLine('positives triggered', comparison.totals.positives),
    '',
    totalLine('negatives fired', comparison.totals.negatives),
    '',
    `Baseline: ${b.totals.passed} of ${b.totals.queries} queries pass; candidate: ${c.totals.passed} of ${c.totals.queries}. Two runs per query resolve to ±1 per query: a difference of one hit is labelled noise, and so is a total difference of up to two.`,
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
