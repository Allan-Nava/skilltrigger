// The gates. Each one is a way the measurement used to return a clean-looking zero
// that meant nothing; each returns { id, status, detail, fix } where status is ok,
// warn, fail or skip. Any fail refuses the run.
//
//   cli         claude is on PATH and answers --version (the version is recorded)
//   auth        `claude auth status` says logged in
//   round-trip  `claude -p "Reply with exactly: pong"` answers pong, with the chosen
//               model — catches the expired OAuth that auth status can miss, and the
//               400 an outdated CLI answers for a model it does not know
//   conflict    no enabled plugin (or other visible skill) shadows the stub
//   sleep       the machine cannot sleep mid-run (macOS: caffeinate), else a warning
//   roster      how many slash commands and skills the model sees, from the init event
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execClaude, streamClaude } from './claude.mjs'
import { findConflicts, parsePluginList, toggleCommands } from './plugins.mjs'

export const PONG_PROMPT = 'Reply with exactly: pong'
const g = (id, status, detail, fix) => ({ id, status, detail, ...(fix ? { fix } : {}) })
const firstLine = (s) => String(s ?? '').trim().split('\n')[0].slice(0, 200)
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

async function cliGate(env) {
  const r = await execClaude(['--version'], { env, timeoutMs: 15000 })
  if (r.notFound) return g('cli', 'fail', `claude not found on PATH`, 'install Claude Code (https://code.claude.com/docs) or put `claude` on PATH; SKILLTRIGGER_CLAUDE names another binary')
  const version = r.stdout.trim().split('\n')[0]
  if (r.code !== 0 || !/\d+\.\d+\.\d+/.test(version)) return g('cli', 'fail', `claude --version did not answer a version (exit ${r.code}${r.timedOut ? ', timed out' : ''}): ${firstLine(r.stderr || r.stdout)}`, 'reinstall or update Claude Code: `claude update`')
  return { ...g('cli', 'ok', `claude ${version}`), version }
}

async function authGate(env) {
  const r = await execClaude(['auth', 'status'], { env, timeoutMs: 20000 })
  let loggedIn = null
  try {
    loggedIn = JSON.parse(r.stdout).loggedIn === true
  } catch {
    if (/not logged in|logged out/i.test(r.stdout)) loggedIn = false
    else if (/logged in/i.test(r.stdout)) loggedIn = true
  }
  if (r.code === 0 && loggedIn) return g('auth', 'ok', 'claude auth status: logged in')
  return g('auth', 'fail', `claude auth status: not logged in (exit ${r.code}${r.timedOut ? ', timed out' : ''})`, 'run `claude auth login` (or `/login` in an interactive session), then preflight again')
}

// One stream-json round trip serves two gates: the answer is the round trip, the
// init event is the roster. It runs in an empty temporary project so the roster is
// what every run will see, minus the stub.
async function roundTrip({ env, model }) {
  const dir = mkdtempSync(join(tmpdir(), 'skilltrigger-preflight-'))
  try {
    let init = null
    let text = ''
    let result = null
    const args = ['-p', PONG_PROMPT, '--output-format', 'stream-json', '--verbose', '--no-session-persistence', ...(model ? ['--model', model] : [])]
    const r = await streamClaude(args, {
      cwd: dir,
      env,
      timeoutMs: 120000,
      onEvent: (ev) => {
        if (ev.type === 'system' && ev.subtype === 'init') init = ev
        if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) if (c.type === 'text') text += c.text ?? ''
        if (ev.type === 'result') {
          result = ev
          return true
        }
        return false
      },
    })
    const answer = (typeof result?.result === 'string' ? result.result : text).trim()
    let gate
    if (r.timedOut) gate = g('round-trip', 'fail', 'claude -p did not answer within 120 s', 'check the network and the CLI by hand: `claude -p "Reply with exactly: pong"`')
    else if (result?.is_error || /Failed to authenticate|API Error|Invalid API key|OAuth token has expired/i.test(answer)) {
      gate = g('round-trip', 'fail', `claude -p answered an error: ${firstLine(answer)}`, /authenticat|oauth|api key|401/i.test(answer) ? 'log in again: `claude auth login` — auth status can say logged in while the token is expired' : 'update the CLI (`claude update`) or pass a --model this CLI knows')
    } else if (!/^\W*pong\W*$/i.test(answer)) gate = g('round-trip', 'fail', `claude -p answered "${firstLine(answer || r.stderr) || '(nothing)'}", not pong (exit ${r.code})`, 'run `claude -p "Reply with exactly: pong"` by hand and fix what it prints')
    else gate = g('round-trip', 'ok', `claude -p answered pong${model ? ` (model ${model})` : ''}`)
    return { gate, init }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function rosterGate(init) {
  if (!init) return g('roster', 'fail', 'no init event in the stream — the roster cannot be recorded', 'update the CLI: `claude update`; the init event of `claude -p --output-format stream-json --verbose` lists the roster')
  if (!Array.isArray(init.slash_commands)) return g('roster', 'fail', 'the init event lists no slash_commands — the roster cannot be recorded', 'update the CLI: `claude update`')
  const roster = { slashCommands: init.slash_commands.length, skills: Array.isArray(init.skills) ? init.skills.length : null }
  const skills = roster.skills === null ? '' : `, ${roster.skills} skills`
  return { ...g('roster', 'ok', `${roster.slashCommands} slash commands${skills} visible to the model`), roster, model: init.model ?? null, entries: [...init.slash_commands, ...(Array.isArray(init.skills) ? init.skills.map((s) => (typeof s === 'string' ? s : s?.name)) : [])].filter(Boolean) }
}

async function conflictGate({ env, skillName, allowConflict, rosterEntries }) {
  const r = await execClaude(['plugin', 'list', '--json'], { env, timeoutMs: 30000 })
  let plugins = parsePluginList(r.stdout)
  let asked = { cmd: 'claude plugin list --json', r }
  if (r.code !== 0 && !plugins?.length) {
    // An older CLI without --json: the human form.
    const plain = await execClaude(['plugin', 'list'], { env, timeoutMs: 30000 })
    plugins = parsePluginList(plain.stdout)
    asked = { cmd: 'claude plugin list', r: plain }
  }
  if (plugins === null) {
    // Unreadable is not empty: a list in a new shape would otherwise read as "no plugins"
    // and the gate would pass with nothing checked (ST-18).
    const got = truncate(firstLine(asked.r.stdout || asked.r.stderr), 80) || '(nothing)'
    const detail = `cannot read the plugin list: \`${asked.cmd}\` exited ${asked.r.code}${asked.r.timedOut ? ' (timed out)' : ''} and printed "${got}" — which plugins are enabled is unknown`
    const fix = ['run `claude plugin list --json` by hand; if the CLI changed its output, update skilltrigger or report the shape', '--allow-conflict measures anyway and records that it did']
    return { ...g('conflict', allowConflict ? 'warn' : 'fail', allowConflict ? `${detail} (allowed by --allow-conflict, recorded in the report)` : detail, fix.join('\n')), unreadable: true }
  }
  const enabled = plugins.filter((p) => p.enabled)
  if (!skillName) return g('conflict', 'warn', `no --skill given, so nothing to compare against ${enabled.length} enabled plugin(s)${enabled.length ? `: ${enabled.map((p) => p.id).join(', ')}` : ''}`, 'pass --skill <dir> to check this gate')
  const conflicts = findConflicts({ plugins, skillName, roster: rosterEntries })
  if (!conflicts.length) return g('conflict', 'ok', `no enabled plugin or visible skill named ${skillName} (${enabled.length} enabled plugin(s) checked)`)
  const { disable, enable } = toggleCommands(conflicts)
  const unaccounted = conflicts.filter((c) => !c.id).map((c) => c.via)
  const lines = [
    ...(disable.length ? ['disable before the run:', ...disable.map((c) => `  ${c}`), 'and re-enable after it:', ...enable.map((c) => `  ${c}`)] : []),
    ...(unaccounted.length ? [`move aside the skill the roster shows (${unaccounted.join(', ')}) — a user or project skill of the same name`] : []),
    'skilltrigger runs none of these itself; --allow-conflict measures anyway and records that it did',
  ]
  const detail = `${conflicts.map((c) => c.via).join('; ')} — the model would load it, not the stub`
  return { ...g('conflict', allowConflict ? 'warn' : 'fail', allowConflict ? `${detail} (allowed by --allow-conflict, recorded in the report)` : detail, lines.join('\n')), conflicts }
}

// macOS: `caffeinate -i -s -w <pid>` holds off idle and system sleep for as long as
// this process lives and exits with it. Elsewhere there is no one portable switch.
export function sleepGate({ platform = process.platform, caffeinate = '/usr/bin/caffeinate', pid = process.pid } = {}) {
  if (platform !== 'darwin') {
    return Promise.resolve(g('sleep', 'warn', `cannot hold the machine awake on ${platform}: a sleep mid-run turns runs into timeouts`, 'keep the machine awake for the run, e.g. `systemd-inhibit --what=idle:sleep skilltrigger run …` on Linux'))
  }
  return new Promise((resolve) => {
    const child = spawn(caffeinate, ['-i', '-s', '-w', String(pid)], { stdio: 'ignore', detached: false })
    child.on('error', (e) => resolve(g('sleep', 'fail', `could not start caffeinate: ${e.code ?? e.message}`, 'run under `caffeinate -i -s skilltrigger run …` by hand')))
    child.on('spawn', () => {
      child.unref()
      resolve(g('sleep', 'ok', `caffeinate -i -s -w ${pid} holds the machine awake until this process exits`))
    })
  })
}

// → { gates, ok, facts: { cliVersion, model, roster, conflictAllowed } }
export async function preflight({ env = process.env, model = null, skillName = null, allowConflict = false, platform = process.platform } = {}) {
  const gates = []
  const cli = await cliGate(env)
  gates.push(cli)
  const facts = { cliVersion: cli.version ?? null, model, roster: null, conflictAllowed: false }
  if (cli.status !== 'ok') {
    for (const id of ['auth', 'round-trip', 'conflict']) gates.push(g(id, 'skip', 'not run: the cli gate failed'))
    gates.push(await sleepGate({ platform }))
    gates.push(g('roster', 'skip', 'not run: the cli gate failed'))
  } else {
    gates.push(await authGate(env))
    const { gate, init } = await roundTrip({ env, model })
    gates.push(gate)
    const roster = rosterGate(init)
    const conflict = await conflictGate({ env, skillName, allowConflict, rosterEntries: roster.entries ?? [] })
    gates.push(conflict)
    gates.push(await sleepGate({ platform }))
    gates.push(roster)
    facts.roster = roster.roster ?? null
    facts.model = model ?? roster.model ?? null
    facts.conflictAllowed = conflict.status === 'warn' && Boolean(conflict.conflicts?.length || conflict.unreadable)
  }
  return { gates, ok: !gates.some((x) => x.status === 'fail'), facts }
}

export function formatGates(gates) {
  const out = []
  for (const x of gates) {
    out.push(`  ${x.status.padEnd(5)} ${x.id.padEnd(11)} ${x.detail}`)
    if (x.fix && x.status !== 'ok') for (const [i, l] of x.fix.split('\n').entries()) out.push(`${' '.repeat(20)}${i === 0 ? 'fix: ' : '     '}${l}`)
  }
  return out.join('\n')
}
