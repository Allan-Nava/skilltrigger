// Spawning `claude`. Two shapes: run to completion and collect the output (the
// gates), or stream newline-delimited JSON and stop the process the moment a caller
// has what it needs (the round trip, every run).
//
// Every spawn gets the environment minus CLAUDECODE, which a parent Claude Code
// session sets and which makes a nested `claude -p` refuse to start.
import { spawn } from 'node:child_process'
import { lineSplitter } from './stream.mjs'

export const claudeBin = (env = process.env) => env.SKILLTRIGGER_CLAUDE || 'claude'

export function childEnv(env = process.env) {
  const out = { ...env }
  delete out.CLAUDECODE
  return out
}

// Kill the whole group: the CLI starts helpers (MCP servers, a shell) that would
// otherwise outlive it and hold the temporary directory open.
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  const hard = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {}
    }
  }, 2000)
  hard.unref()
}

function start(args, { cwd, env }) {
  return spawn(claudeBin(env), args, { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
}

// → { code, stdout, stderr, timedOut, notFound }
export function execClaude(args, { cwd = process.cwd(), env = process.env, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = start(args, { cwd, env })
    const finish = (r) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, timeoutMs)
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-65536)))
    child.on('error', (e) => finish({ code: null, stdout, stderr: stderr || e.message, timedOut, notFound: e.code === 'ENOENT' }))
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut, notFound: false }))
  })
}

// onEvent(event) returns a truthy value to stop: the process is killed and that value
// comes back as `stopped`. → { stopped, code, stderr, timedOut, notFound, ms }
export function streamClaude(args, { cwd, env = process.env, timeoutMs, onEvent }) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    let stderr = ''
    let stopped = null
    let timedOut = false
    let settled = false
    const child = start(args, { cwd, env })
    const finish = (r) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ...r, ms: Date.now() - t0 })
    }
    const timer = setTimeout(() => {
      if (stopped) return
      timedOut = true
      killTree(child)
    }, timeoutMs)
    const lines = lineSplitter((ev) => {
      if (stopped || timedOut) return
      const r = onEvent(ev)
      if (r) {
        stopped = r
        killTree(child)
      }
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => lines.push(d))
    child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-65536)))
    child.on('error', (e) => finish({ stopped, code: null, stderr: stderr || e.message, timedOut, notFound: e.code === 'ENOENT' }))
    child.on('close', (code) => {
      lines.end()
      finish({ stopped, code, stderr, timedOut, notFound: false })
    })
  })
}
