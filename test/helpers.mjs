// Shared by the tests: an environment in which `claude` is the fake in test/fake/,
// and a way to run the CLI under it. Nothing here can reach the real CLI — the fake
// directory comes first on PATH, the rest of PATH is only node's own directory and the
// system bins, and every test asserts the fake answered before it trusts a result.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const FAKE_DIR = join(ROOT, 'test', 'fake')
export const FIXTURES = join(ROOT, 'test', 'fixtures')
export const SKILL = join(FIXTURES, 'skills', 'demo-skill')
export const EVALS = join(FIXTURES, 'evals', 'demo.json')
export const PLUGIN = join(FIXTURES, 'plugin')
const CLI = join(ROOT, 'bin', 'skilltrigger.mjs')

// A lost executable bit would make PATH skip a fake and find the real one.
for (const f of ['claude', 'systemd-inhibit']) chmodSync(join(FAKE_DIR, f), 0o755)

export function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'skilltrigger-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function fakeEnv(dir, overrides = {}) {
  const env = {
    PATH: [FAKE_DIR, dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    HOME: join(dir, 'home'),
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    FAKE_CLAUDE_LOG: join(dir, 'claude.log'),
    FAKE_CLAUDE_STATE: join(dir, 'state'),
    FAKE_CLAUDE_PLUGIN_DIR: PLUGIN,
    CLAUDECODE: '1',
    ...overrides,
  }
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k]
  return env
}

export function readLog(dir) {
  const f = join(dir, 'claude.log')
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

export function cli(args, env, { cwd = ROOT } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolvePromise({ code, stdout, stderr, out: stdout + stderr }))
  })
}
