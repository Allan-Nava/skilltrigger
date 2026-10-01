// ST-20: what the inherited environment contributes, counted — never read into the report.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { countHooks, environmentSummary, memoryFiles } from '../bin/lib/environment.mjs'
import { scratch } from './helpers.mjs'

const write = (f, text) => {
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, text)
}

test('memory files: the project and its ancestors, and the user configuration directory', () => {
  const s = scratch()
  try {
    const project = join(s.dir, 'outer', 'project')
    const config = join(s.dir, 'home', '.claude')
    mkdirSync(project, { recursive: true })
    const before = memoryFiles({ projectDir: project, configDir: config })
    assert.equal(before.user, 0)
    write(join(s.dir, 'outer', 'CLAUDE.md'), 'an ancestor')
    write(join(project, 'CLAUDE.local.md'), 'local')
    write(join(project, '.claude', 'CLAUDE.md'), 'nested')
    write(join(config, 'CLAUDE.md'), 'user')
    write(join(config, 'rules', 'style.md'), 'a rule')
    write(join(config, 'rules', 'deep', 'more.md'), 'another')
    write(join(config, 'rules', 'notes.txt'), 'not a rule')
    const after = memoryFiles({ projectDir: project, configDir: config })
    assert.equal(after.project - before.project, 3)
    assert.equal(after.user, 3)
  } finally {
    s.cleanup()
  }
})

test('hooks: each configured hook command counts once, in settings and in enabled plugins', () => {
  const s = scratch()
  try {
    const config = join(s.dir, 'home', '.claude')
    write(join(config, 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] }], Stop: [{ hooks: [{ type: 'command', command: 'c' }] }] } }))
    const plugin = join(s.dir, 'plugin')
    write(join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'd' }] }] } }))
    assert.equal(countHooks({ configDir: config, plugins: [] }), 3)
    assert.equal(countHooks({ configDir: config, plugins: [{ enabled: true, installPath: plugin }] }), 4)
    assert.equal(countHooks({ configDir: config, plugins: [{ enabled: false, installPath: plugin }] }), 3)
    assert.equal(countHooks({ configDir: join(s.dir, 'nowhere'), plugins: [] }), 0)
  } finally {
    s.cleanup()
  }
})

test('the summary: counts only, MCP servers from the init event, null when it lists none', () => {
  const s = scratch()
  try {
    const env = { HOME: join(s.dir, 'home') }
    const sum = environmentSummary({ env, projectDir: s.dir, plugins: [], init: { mcp_servers: [{ name: 'private-server', status: 'connected' }] } })
    assert.deepEqual(Object.keys(sum).sort(), ['hooks', 'mcpServers', 'memoryFiles'])
    assert.equal(sum.mcpServers, 1)
    assert.ok(!JSON.stringify(sum).includes('private-server'), 'no names')
    assert.equal(environmentSummary({ env, projectDir: s.dir, plugins: [], init: {} }).mcpServers, null)
    // CLAUDE_CONFIG_DIR, when set, is the user configuration directory.
    write(join(s.dir, 'cfg', 'CLAUDE.md'), 'x')
    assert.equal(environmentSummary({ env: { ...env, CLAUDE_CONFIG_DIR: join(s.dir, 'cfg') }, projectDir: s.dir, plugins: [], init: null }).memoryFiles.user, 1)
  } finally {
    s.cleanup()
  }
})
