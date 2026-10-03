// The runner. Strictly serial — there is no workers option, on purpose: with N
// parallel runs the model sees N stubs with the same description, invokes whichever
// it likes, and only the run whose stub was picked counts the hit, so the measured
// rate is about 1/N of the true one. skill-creator's default of ten workers measured
// a tenth of the truth.
//
// One run: a fresh temporary project holding one stub command whose frontmatter
// description is the text under test, a `claude -p` in it, the stream read until the
// first decisive message, the process killed, the directory removed.
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { streamClaude } from './claude.mjs'
import { createDetector } from './stream.mjs'

export const OUTCOMES = ['triggered', 'not-triggered', 'timeout', 'error']

// A YAML block scalar, so quotes and colons in the description cannot break it.
export function stubText(skillName, description) {
  const body = String(description).split('\n').map((l) => (l ? `  ${l}` : '')).join('\n')
  return `---\ndescription: |\n${body}\n---\n\n# ${skillName}\n\nThis command stands in for the ${skillName} skill while its description is measured.\n`
}

export function makeProject(skillName, description) {
  const dir = mkdtempSync(join(tmpdir(), 'skilltrigger-run-'))
  const stubName = `${skillName}-stub-${randomBytes(4).toString('hex')}`
  const commands = join(dir, '.claude', 'commands')
  mkdirSync(commands, { recursive: true })
  const stubPath = join(commands, `${stubName}.md`)
  writeFileSync(stubPath, stubText(skillName, description))
  return { dir, stubName, stubPath, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

// → { outcome, reason, ms, model }
export async function runOnce({ query, skillName, description, model, timeoutMs, env }) {
  const project = makeProject(skillName, description)
  try {
    const detector = createDetector({ stubName: project.stubName, stubPath: project.stubPath })
    const args = ['-p', query, '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--no-session-persistence', ...(model ? ['--model', model] : [])]
    const r = await streamClaude(args, { cwd: project.dir, env, timeoutMs, onEvent: (ev) => detector.feed(ev) })
    const used = detector.init?.model ?? null
    if (r.stopped) return { ...r.stopped, ms: r.ms, model: used }
    if (r.timedOut) return { outcome: 'timeout', reason: `no decision within ${timeoutMs / 1000} s`, ms: r.ms, model: used }
    if (r.notFound) return { outcome: 'error', reason: 'claude not found on PATH', ms: r.ms, model: used }
    return { ...detector.end({ code: r.code, stderr: r.stderr }), ms: r.ms, model: used }
  } finally {
    project.remove()
  }
}

// Serial, query by query, run by run. Stops as soon as the timeouts and errors pass
// the no-verdict share of the whole plan: from there no verdict is possible, and every
// further run is spent on a number that will not be reported.
//
// With a baseline (ST-14) each query is run once with each text, back to back, and the
// order inside the pair flips every pass — baseline first on odd passes, candidate first
// on even ones — so a drift over the hour (a model update, a roster change, a machine
// slowing down) lands on both texts equally. The share is kept per side: one text past it
// is no verdict for that side, so none for the comparison, and the run stops there.
export async function runAll({ items, runs, skillName, description, baseline = null, model, timeoutMs, env, noVerdictShare, onRun = () => {}, runOnceFn = runOnce }) {
  const sides = baseline === null ? [{ side: null, description }] : [{ side: 'baseline', description: baseline }, { side: 'candidate', description }]
  const perSide = items.length * runs
  const planned = perSide * sides.length
  const state = sides.map(() => ({ outcomes: items.map(() => []), models: items.map(() => []), bad: 0 }))
  let done = 0
  let aborted = false
  outer: for (let r = 0; r < runs; r++) {
    const order = r % 2 === 0 ? sides.map((_, k) => k) : sides.map((_, k) => k).reverse()
    for (const [i, item] of items.entries()) {
      for (const k of order) {
        const st = state[k]
        const res = await runOnceFn({ query: item.query, skillName, description: sides[k].description, model, timeoutMs, env })
        st.outcomes[i].push(res.outcome)
        // The model each run's init event reported, beside its outcome: an alias can
        // resolve to a different model than the preflight saw (ST-20).
        st.models[i].push(res.model ?? null)
        done++
        if (res.outcome === 'timeout' || res.outcome === 'error') st.bad++
        onRun({ item, run: r + 1, done, planned, side: sides[k].side, ...res })
        if (st.bad > noVerdictShare * perSide) {
          aborted = done < planned
          break outer
        }
      }
    }
  }
  if (baseline === null) return { outcomes: state[0].outcomes, models: state[0].models, planned, done, aborted }
  const out = (k) => ({ outcomes: state[k].outcomes, models: state[k].models, planned: perSide, done: state[k].outcomes.reduce((a, o) => a + o.length, 0) })
  return { baseline: out(0), candidate: out(1), planned, done, aborted }
}
