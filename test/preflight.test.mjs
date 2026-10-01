// Every gate, through the CLI, against the fake claude: the ok case once, then each
// failure on its own, and that a failure exits 2 with the reason and the fix.
import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { sleepGate } from '../bin/lib/gates.mjs'
import { SKILL, cli, fakeEnv, readLog, scratch } from './helpers.mjs'

async function preflight(env = {}, args = []) {
  const s = scratch()
  try {
    const r = await cli(['preflight', ...args], fakeEnv(s.dir, env))
    return { ...r, log: readLog(s.dir) }
  } finally {
    s.cleanup()
  }
}
const line = (out, gate) => out.split('\n').find((l) => l.includes(`${gate} `) && /^\s*(ok|fail|warn|skip)\b/.test(l)) ?? ''

test('every gate passes against a healthy CLI', async () => {
  const r = await preflight({}, ['--skill', SKILL])
  assert.equal(r.code, 0, r.out)
  for (const g of ['cli', 'auth', 'round-trip', 'conflict', 'roster']) assert.match(line(r.out, g), /^\s*ok\b/, `${g}\n${r.out}`)
  assert.match(line(r.out, 'sleep'), /^\s*(ok|warn)\b/)
  assert.match(r.out, /2\.1\.268/)
  assert.match(r.out, /5 slash commands, 3 skills/)
  assert.ok(r.log.length > 0, 'the fake answered')
})

test('the round trip runs with the chosen model, without CLAUDECODE, without session persistence', async () => {
  const r = await preflight({}, ['--model', 'claude-test-9'])
  assert.equal(r.code, 0, r.out)
  const pong = r.log.find((l) => l.prompt === 'Reply with exactly: pong')
  assert.ok(pong, 'a round trip was made')
  assert.equal(pong.model, 'claude-test-9')
  assert.equal(pong.claudecode, false)
  assert.ok(pong.argv.includes('--no-session-persistence'))
  assert.ok(pong.argv.includes('stream-json'))
  assert.ok(r.log.every((l) => l.claudecode === false), 'CLAUDECODE is never passed on')
})

test('cli: claude not on PATH fails, and the gates that need it are skipped', async () => {
  const r = await preflight({ SKILLTRIGGER_CLAUDE: 'claude-not-installed-here' })
  assert.equal(r.code, 2)
  assert.match(line(r.out, 'cli'), /^\s*fail\b.*not found/)
  assert.match(r.out, /fix: /)
  assert.match(line(r.out, 'auth'), /^\s*skip\b/)
  assert.equal(r.log.length, 0)
})

test('cli: a version that does not answer fails', async () => {
  const r = await preflight({ FAKE_CLAUDE_VERSION: 'fail' })
  assert.equal(r.code, 2)
  assert.match(line(r.out, 'cli'), /^\s*fail\b/)
})

test('auth: logged out fails, with the login command as the fix', async () => {
  const r = await preflight({ FAKE_CLAUDE_AUTH: 'out' })
  assert.equal(r.code, 2)
  assert.match(line(r.out, 'auth'), /^\s*fail\b/)
  assert.match(r.out, /claude auth login|\/login/)
})

test('round-trip: "Failed to authenticate" fails even when auth status said logged in', async () => {
  const r = await preflight({ FAKE_CLAUDE_PONG: 'auth-fail' })
  assert.equal(r.code, 2)
  assert.match(line(r.out, 'auth'), /^\s*ok\b/)
  assert.match(line(r.out, 'round-trip'), /^\s*fail\b.*Failed to authenticate/)
})

test('round-trip: an answer that is not pong fails', async () => {
  const r = await preflight({ FAKE_CLAUDE_PONG: 'wrong' })
  assert.equal(r.code, 2)
  assert.match(line(r.out, 'round-trip'), /^\s*fail\b/)
})

test('conflict: an enabled plugin carrying the skill refuses, printing the commands and running neither', async () => {
  const r = await preflight({ FAKE_CLAUDE_PLUGINS: 'conflict' }, ['--skill', SKILL])
  assert.equal(r.code, 2, r.out)
  assert.match(line(r.out, 'conflict'), /^\s*fail\b.*demo@market/)
  assert.match(r.out, /claude plugin disable demo@market --scope user/)
  assert.match(r.out, /claude plugin enable demo@market --scope user/)
  assert.ok(!r.log.some((l) => l.argv[0] === 'plugin' && l.argv[1] !== 'list'), 'never disables anything itself')
})

test('conflict: --allow-conflict turns the refusal into a recorded warning', async () => {
  const r = await preflight({ FAKE_CLAUDE_PLUGINS: 'conflict' }, ['--skill', SKILL, '--allow-conflict'])
  assert.equal(r.code, 0, r.out)
  assert.match(line(r.out, 'conflict'), /^\s*warn\b/)
})

test('conflict: a disabled plugin is no conflict', async () => {
  const r = await preflight({ FAKE_CLAUDE_PLUGINS: 'disabled' }, ['--skill', SKILL])
  assert.equal(r.code, 0, r.out)
})

test('conflict: the roster catches a shadowing skill the plain-text plugin list cannot show', async () => {
  const r = await preflight({ FAKE_CLAUDE_PLUGINS: 'text-conflict', FAKE_CLAUDE_ROSTER_EXTRA: 'demo:demo-skill' }, ['--skill', SKILL])
  assert.equal(r.code, 2, r.out)
  assert.match(line(r.out, 'conflict'), /^\s*fail\b/)
  assert.match(r.out, /claude plugin disable demo@market/)
})

test('conflict: without --skill there is nothing to compare, and it says so', async () => {
  const r = await preflight({ FAKE_CLAUDE_PLUGINS: 'conflict' })
  assert.equal(r.code, 0, r.out)
  assert.match(line(r.out, 'conflict'), /^\s*warn\b.*--skill/)
})

test('roster: no init event fails — a number without its roster cannot be compared', async () => {
  const r = await preflight({ FAKE_CLAUDE_PONG: 'no-init' })
  assert.equal(r.code, 2)
  assert.match(line(r.out, 'roster'), /^\s*fail\b/)
})

test('roster: an init event without slash_commands fails', async () => {
  const r = await preflight({ FAKE_CLAUDE_PONG: 'no-roster' })
  assert.equal(r.code, 2)
  assert.match(line(r.out, 'roster'), /^\s*fail\b.*slash_commands/)
})

test('roster: the counts are what the init event lists', async () => {
  const r = await preflight({ FAKE_CLAUDE_COMMANDS: '83', FAKE_CLAUDE_SKILLS: '59' })
  assert.match(line(r.out, 'roster'), /83 slash commands, 59 skills/)
})

test('sleep: elsewhere than macOS, a warning and the advice', async () => {
  const g = await sleepGate({ platform: 'linux' })
  assert.equal(g.status, 'warn')
  assert.match(g.fix, /systemd-inhibit|sleep/)
})

test('sleep: on macOS caffeinate is started against this process', async () => {
  const { dir, cleanup } = scratch()
  try {
    const bin = join(dir, 'caffeinate')
    const log = join(dir, 'caffeinate.args')
    writeFileSync(bin, `#!/bin/sh\necho "$@" > "${log}"\n`)
    chmodSync(bin, 0o755)
    const g = await sleepGate({ platform: 'darwin', caffeinate: bin, pid: 4242 })
    assert.equal(g.status, 'ok', g.detail)
    // The script writes its arguments when it gets scheduled; poll rather than guess.
    for (let i = 0; i < 100 && !existsSync(log); i++) await new Promise((r) => setTimeout(r, 50))
    assert.equal(readFileSync(log, 'utf8').trim(), '-i -s -w 4242')
  } finally {
    cleanup()
  }
})

test('sleep: on macOS without caffeinate, a failure', async () => {
  const g = await sleepGate({ platform: 'darwin', caffeinate: '/nonexistent/caffeinate' })
  assert.equal(g.status, 'fail')
})
