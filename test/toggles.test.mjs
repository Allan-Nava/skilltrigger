// ST-21: which remembered toggles are kept, and which are reminded of.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatReminders, reconcile } from '../bin/lib/toggles.mjs'

const conflict = { id: 'demo@market', scope: 'user', via: 'demo@market carries a skill named demo-skill' }
const listed = (enabled) => [{ id: 'demo@market', enabled }]

test('a conflict is remembered with both commands; no reminder while it is still enabled', () => {
  const { keep, reminders } = reconcile({ remembered: [], conflicts: [conflict], plugins: listed(true), date: '2026-10-01' })
  assert.deepEqual(keep, [{ id: 'demo@market', scope: 'user', disable: 'claude plugin disable demo@market --scope user', enable: 'claude plugin enable demo@market --scope user', since: '2026-10-01' }])
  assert.deepEqual(reminders, [])
})

test('disabled: kept and reminded; enabled again or uninstalled: forgotten; list unread: kept, silent', () => {
  const { keep: remembered } = reconcile({ remembered: [], conflicts: [conflict], plugins: listed(true), date: '2026-10-01' })
  assert.equal(reconcile({ remembered, plugins: listed(false) }).reminders.length, 1)
  assert.deepEqual(reconcile({ remembered, plugins: listed(true) }).keep, [])
  assert.deepEqual(reconcile({ remembered, plugins: [] }).keep, [])
  assert.deepEqual(reconcile({ remembered, plugins: null }), { keep: remembered, reminders: [] })
  assert.match(formatReminders(reconcile({ remembered, plugins: listed(false) }).reminders), /claude plugin enable demo@market --scope user/)
  assert.equal(formatReminders([]), null)
})
