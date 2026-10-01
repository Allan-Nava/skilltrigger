import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findConflicts, parsePluginList, pluginSkills, toggleCommands } from '../bin/lib/plugins.mjs'
import { PLUGIN } from './helpers.mjs'

const JSON_LIST = JSON.stringify([
  { id: 'demo@market', version: '0.1.0', scope: 'user', enabled: true, installPath: PLUGIN },
  { id: 'off@market', version: '1.0.0', scope: 'user', enabled: false, installPath: PLUGIN },
])
const TEXT_LIST = `Installed plugins:

  ❯ demo@market
    Version: 0.1.0
    Scope: user
    Status: ✔ enabled

  ❯ off@market
    Version: 1.0.0
    Scope: project
    Status: ✘ disabled
`

test('plugin list: the JSON form', () => {
  const list = parsePluginList(JSON_LIST)
  assert.deepEqual(
    list.map((p) => [p.id, p.name, p.enabled, p.installPath === PLUGIN]),
    [
      ['demo@market', 'demo', true, true],
      ['off@market', 'off', false, true],
    ],
  )
})

test('plugin list: the human-readable form', () => {
  const list = parsePluginList(TEXT_LIST)
  assert.deepEqual(
    list.map((p) => [p.id, p.enabled, p.scope, p.installPath]),
    [
      ['demo@market', true, 'user', null],
      ['off@market', false, 'project', null],
    ],
  )
  assert.deepEqual(parsePluginList('No plugins installed.'), [])
})

// ST-18: "parsed, zero plugins" and "could not parse" are different answers. The first
// lets the gate pass; the second must not, or a list in a new shape reads as no plugins.
test('plugin list: an empty JSON array and a human "no plugins" line are zero plugins', () => {
  assert.deepEqual(parsePluginList('[]'), [])
  assert.deepEqual(parsePluginList('  [ ]\n'), [])
  assert.deepEqual(parsePluginList('No plugins installed.'), [])
  assert.deepEqual(parsePluginList('Installed plugins:\n\n  (none)\n'), [])
})

test('plugin list: output in no shape the parser knows is unreadable, not empty', () => {
  for (const text of ['', '   \n', 'Plugin listing is temporarily unavailable', '{"plugins":[{"id":"demo@market"}]}', '[{"name":"no-id"}]', '[not json']) {
    assert.equal(parsePluginList(text), null, JSON.stringify(text))
  }
})

test("a plugin's skills are read off its install path", () => {
  assert.deepEqual(pluginSkills(PLUGIN), ['demo-skill'])
  assert.deepEqual(pluginSkills('/nonexistent/path'), [])
})

test('an enabled plugin carrying the skill is a conflict; a disabled one is not', () => {
  const c = findConflicts({ plugins: parsePluginList(JSON_LIST), skillName: 'demo-skill' })
  assert.deepEqual(c.map((x) => x.id), ['demo@market'])
  assert.deepEqual(findConflicts({ plugins: parsePluginList(JSON_LIST), skillName: 'other' }), [])
})

test('the roster catches what the plugin list cannot show', () => {
  const plugins = parsePluginList(TEXT_LIST)
  const c = findConflicts({ plugins, skillName: 'demo-skill', roster: ['cmd', 'demo:demo-skill'] })
  assert.deepEqual(c.map((x) => [x.id, x.via]), [['demo@market', 'roster: demo:demo-skill']])
  const user = findConflicts({ plugins: [], skillName: 'demo-skill', roster: ['demo-skill'] })
  assert.deepEqual(user.map((x) => [x.id, x.via]), [[null, 'roster: demo-skill']])
})

test('the fix is printed, in both directions, scope included', () => {
  const c = findConflicts({ plugins: parsePluginList(JSON_LIST), skillName: 'demo-skill' })
  assert.deepEqual(toggleCommands(c), {
    disable: ['claude plugin disable demo@market --scope user'],
    enable: ['claude plugin enable demo@market --scope user'],
  })
})
