// Two reports side by side. The number is a property of the description AND of the
// environment it was measured in — the model, the CLI, and above all the roster: the
// stub competes with every other description the model can see, and one synced
// folder of 24 skills moved a byte-identical description from 18/18 to 10/18. So a
// difference in any of the three is printed as a warning before any delta is — the
// roster by its members as well as its counts, since two rosters of one size can differ
// (ST-20), and so is a difference in the models the runs reported or in what the
// inherited environment contributed.
//
// Two runs per query resolve to ±1 per query; a difference of one hit at two runs is
// labelled noise, and so is a total difference of up to two hits.

const rosterSize = (r) => (r?.roster ? r.roster.slashCommands : null)
const fmtRoster = (r) => (r?.roster ? `${r.roster.slashCommands} slash commands${r.roster.skills == null ? '' : `, ${r.roster.skills} skills`}` : 'unknown')

// Added and removed members, per kind, by hash — the report carries no names. Skipped
// when either report predates the hashes.
function memberDiff(a, b) {
  const parts = []
  for (const [key, label] of [['commandHashes', 'slash commands'], ['skillHashes', 'skills']]) {
    const na = a.roster?.[key]
    const nb = b.roster?.[key]
    if (!Array.isArray(na) || !Array.isArray(nb)) continue
    const sa = new Set(na)
    const sb = new Set(nb)
    const added = nb.filter((n) => !sa.has(n))
    const removed = na.filter((n) => !sb.has(n))
    if (added.length || removed.length) parts.push(`${label}: ${[added.length ? `${added.length} added (${added.join(', ')})` : '', removed.length ? `${removed.length} removed (${removed.join(', ')})` : ''].filter(Boolean).join('; ')}`)
  }
  return parts
}

const sameKeys = (x, y) => JSON.stringify(Object.keys(x).sort()) === JSON.stringify(Object.keys(y).sort())

function environmentDiff(ea, eb) {
  if (!ea || !eb) return []
  const out = []
  const mem = (e) => `${e.memoryFiles?.project}+${e.memoryFiles?.user}`
  if (mem(ea) !== mem(eb)) out.push(`memory files (project+user) ${mem(ea)} vs ${mem(eb)}`)
  if (ea.hooks !== eb.hooks) out.push(`hooks ${ea.hooks} vs ${eb.hooks}`)
  if (ea.mcpServers !== eb.mcpServers) out.push(`MCP servers ${ea.mcpServers} vs ${eb.mcpServers}`)
  return out
}

export const totalIsNoise = (d, noiseAt) => d !== 0 && Math.abs(d) <= 2 && noiseAt

// The arithmetic both `compare` and a paired run (ST-14) report: a row per query, its
// delta and its noise label, and totals over the queries both sides share, so a query
// added on one side does not pass for a change in the description.
export function deltas(a, b) {
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

  const shared = rows.filter((r) => !r.only)
  const total = (pred) => {
    const pick = (side) => shared.filter((r) => pred(r.should_trigger)).reduce((acc, r) => ({ hits: acc.hits + r[side].hits, runs: acc.runs + r[side].runs }), { hits: 0, runs: 0 })
    const ta = pick('a')
    const tb = pick('b')
    return { a: ta, b: tb, delta: tb.hits - ta.hits }
  }
  return { rows, totals: { positives: total((s) => s), negatives: total((s) => !s) }, noiseAt }
}

export function compare(a, b) {
  const warnings = []
  if (a.model !== b.model) warnings.push(`model differs: ${a.model} vs ${b.model}`)
  if (a.runModels && b.runModels && Object.keys(a.runModels).length && Object.keys(b.runModels).length && !sameKeys(a.runModels, b.runModels)) {
    warnings.push(`the models the runs reported differ: ${Object.keys(a.runModels).sort().join(', ')} vs ${Object.keys(b.runModels).sort().join(', ')}`)
  }
  if (a.cliVersion !== b.cliVersion) warnings.push(`CLI version differs: ${a.cliVersion} vs ${b.cliVersion}`)
  if (rosterSize(a) !== rosterSize(b) || a.roster?.skills !== b.roster?.skills) warnings.push(`roster differs: ${fmtRoster(a)} vs ${fmtRoster(b)} — the number is a property of the text and the roster; re-measure the baseline in the same environment before judging a rewrite`)
  const members = memberDiff(a, b)
  if (members.length) warnings.push(`roster members differ (a → b) — ${members.join(' · ')}`)
  const env = environmentDiff(a.environment, b.environment)
  if (env.length) warnings.push(`inherited environment differs: ${env.join(', ')} — memory files, hooks and MCP servers reach the model too`)
  for (const [k, r] of [['a', a], ['b', b]]) if (r.verdict !== 'ok') warnings.push(`report ${k} (${r.date}) has no verdict — its counts are not a measurement`)
  if (a.conflictAllowed || b.conflictAllowed) warnings.push('a report was measured with --allow-conflict — a same-named skill was visible')

  const { rows, totals, noiseAt } = deltas(a, b)

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
  const totalNoise = (d) => (totalIsNoise(d, noiseAt) ? ' (within noise)' : '')
  lines.push(`positives triggered ${totals.positives.a.hits}/${totals.positives.a.runs} → ${totals.positives.b.hits}/${totals.positives.b.runs} (${sign(totals.positives.delta)})${totalNoise(totals.positives.delta)}`)
  lines.push(`negatives fired ${totals.negatives.a.hits}/${totals.negatives.a.runs} → ${totals.negatives.b.hits}/${totals.negatives.b.runs} (${sign(totals.negatives.delta)})${totalNoise(totals.negatives.delta)}`)
  return { warnings, rows, totals, text: lines.join('\n') }
}
