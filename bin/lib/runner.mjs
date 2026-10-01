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
export async function runAll({ items, runs, skillName, description, model, timeoutMs, env, noVerdictShare, onRun = () => {}, runOnceFn = runOnce }) {
  const planned = items.length * runs
  const outcomes = items.map(() => [])
  let bad = 0
  let done = 0
  let aborted = false
  outer: for (let r = 0; r < runs; r++) {
    for (const [i, item] of items.entries()) {
      const res = await runOnceFn({ query: item.query, skillName, description, model, timeoutMs, env })
      outcomes[i].push(res.outcome)
      done++
      if (res.outcome === 'timeout' || res.outcome === 'error') bad++
      onRun({ item, run: r + 1, done, planned, ...res })
      if (bad > noVerdictShare * planned) {
        aborted = done < planned
        break outer
      }
    }
  }
  return { outcomes, planned, done, aborted }
}
