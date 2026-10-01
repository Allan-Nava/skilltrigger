// Two reports side by side. The number is a property of the description AND of the
// environment it was measured in — the model, the CLI, and above all the roster: the
// stub competes with every other description the model can see, and one synced
// folder of 24 skills moved a byte-identical description from 18/18 to 10/18. So a
// difference in any of the three is printed as a warning before any delta is.
//
// Two runs per query resolve to ±1 per query; a difference of one hit at two runs is
// labelled noise, and so is a total difference of up to two hits.

const rosterSize = (r) => (r?.roster ? r.roster.slashCommands : null)
const fmtRoster = (r) => (r?.roster ? `${r.roster.slashCommands} slash commands${r.roster.skills == null ? '' : `, ${r.roster.skills} skills`}` : 'unknown')

export function compare(a, b) {
  const warnings = []
  if (a.model !== b.model) warnings.push(`model differs: ${a.model} vs ${b.model}`)
  if (a.cliVersion !== b.cliVersion) warnings.push(`CLI version differs: ${a.cliVersion} vs ${b.cliVersion}`)
  if (rosterSize(a) !== rosterSize(b) || a.roster?.skills !== b.roster?.skills) warnings.push(`roster differs: ${fmtRoster(a)} vs ${fmtRoster(b)} — the number is a property of the text and the roster; re-measure the baseline in the same environment before judging a rewrite`)
  for (const [k, r] of [['a', a], ['b', b]]) if (r.verdict !== 'ok') warnings.push(`report ${k} (${r.date}) has no verdict — its counts are not a measurement`)
  if (a.conflictAllowed || b.conflictAllowed) warnings.push('a report was measured with --allow-conflict — a same-named skill was visible')

  const noiseAt = Math.min(a.runsPerQuery ?? 2, b.runsPerQuery ?? 2) <= 2
  const byQuery = new Map(b.queries.map((q) => [q.query, q]))
  const seen = new Set()
  const rows = []
  for (const qa of a.queries) {
    const qb = byQuery.get(qa.query)
    seen.add(qa.query)
    if (!qb) {
      rows.push({ query: qa.query, should_trigger: qa.should_trigger, a: qa, b: null, only: 'a' })
      continue
    }
    const delta = qb.hits - qa.hits
    rows.push({ query: qa.query, should_trigger: qa.should_trigger, a: qa, b: qb, delta, noise: delta !== 0 && Math.abs(delta) <= 1 && noiseAt })
  }
  for (const qb of b.queries) if (!seen.has(qb.query)) rows.push({ query: qb.query, should_trigger: qb.should_trigger, a: null, b: qb, only: 'b' })

  // Totals over the queries both reports share, so a query added on one side does not
  // pass for a change in the description.
  const shared = rows.filter((r) => !r.only)
  const total = (pred) => {
    const pick = (side) => shared.filter((r) => pred(r.should_trigger)).reduce((acc, r) => ({ hits: acc.hits + r[side].hits, runs: acc.runs + r[side].runs }), { hits: 0, runs: 0 })
    const ta = pick('a')
    const tb = pick('b')
    return { a: ta, b: tb, delta: tb.hits - ta.hits }
  }
  const totals = { positives: total((s) => s), negatives: total((s) => !s) }

  const lines = [`skilltrigger compare — ${a.skill} ${a.date} (a) vs ${b.skill} ${b.date} (b)`, '']
  for (const w of warnings) lines.push(`warning: ${w}`)
  if (warnings.length) lines.push('')
  if (a.description?.sha256 && b.description?.sha256) lines.push(a.description.sha256 === b.description.sha256 ? 'description: identical in both' : `description changed: ${a.description.bytes} → ${b.description.bytes} bytes`, '')
  const sign = (n) => (n > 0 ? `+${n}` : String(n))
  for (const r of rows) {
    const tag = r.should_trigger ? 'pos' : 'neg'
    if (r.only) lines.push(`  ${tag}  only in ${r.only}: ${r[r.only].hits}/${r[r.only].runs}  ${r.query}`)
    else lines.push(`  ${tag}  ${r.a.hits}/${r.a.runs} → ${r.b.hits}/${r.b.runs}  ${r.delta === 0 ? ' 0' : sign(r.delta)}${r.noise ? ' (noise)' : ''}  ${r.query}`)
  }
  lines.push('')
  const totalNoise = (d) => (d !== 0 && Math.abs(d) <= 2 && noiseAt ? ' (within noise)' : '')
  lines.push(`positives triggered ${totals.positives.a.hits}/${totals.positives.a.runs} → ${totals.positives.b.hits}/${totals.positives.b.runs} (${sign(totals.positives.delta)})${totalNoise(totals.positives.delta)}`)
  lines.push(`negatives fired ${totals.negatives.a.hits}/${totals.negatives.a.runs} → ${totals.negatives.b.hits}/${totals.negatives.b.runs} (${sign(totals.negatives.delta)})${totalNoise(totals.negatives.delta)}`)
  return { warnings, rows, totals, text: lines.join('\n') }
}
