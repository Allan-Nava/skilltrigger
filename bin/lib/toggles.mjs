// The re-enable reminder. The conflict gate prints `claude plugin disable` and `enable`
// and runs neither; once the user disables the plugin it is no longer a conflict, so
// nothing would mention it again (ST-21). The toggles the gate printed are remembered in
// one small file under the run's --out directory — never under ~/.claude — and the
// enable command is printed by every preflight that sees the plugin still disabled and at
// the end of every run, until a preflight sees it enabled again or no longer installed.
//
// The file holds plugin ids, scopes and the two commands; it is not a report and none of
// it enters one.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { toggleCommands } from './plugins.mjs'

export const TOGGLES_FILE = '.skilltrigger-toggles'

export function readToggles(outDir) {
  try {
    const list = JSON.parse(readFileSync(join(outDir, TOGGLES_FILE), 'utf8'))?.plugins
    return Array.isArray(list) ? list.filter((t) => typeof t?.id === 'string' && typeof t.enable === 'string') : []
  } catch {
    return []
  }
}

export function writeToggles(outDir, list) {
  const file = join(outDir, TOGGLES_FILE)
  if (!list.length) return rmSync(file, { force: true })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(file, JSON.stringify({ plugins: list }, null, 2) + '\n')
}

// remembered: what the file holds; conflicts: what the gate found now (ids may be null);
// plugins: the parsed plugin list, or null when it was not read.
// → { keep, reminders } — reminders are the kept entries whose plugin is disabled now.
export function reconcile({ remembered, conflicts = [], plugins = null, date }) {
  const byId = new Map(remembered.map((t) => [t.id, t]))
  for (const c of conflicts.filter((x) => x.id)) {
    const { disable, enable } = toggleCommands([c])
    byId.set(c.id, { id: c.id, scope: c.scope ?? null, disable: disable[0], enable: enable[0], since: byId.get(c.id)?.since ?? date })
  }
  if (!plugins) return { keep: [...byId.values()], reminders: [] }
  const now = new Map(plugins.map((p) => [p.id, p]))
  const conflicting = new Set(conflicts.map((c) => c.id).filter(Boolean))
  const keep = []
  const reminders = []
  for (const t of byId.values()) {
    const p = now.get(t.id)
    if (!p) continue // uninstalled: nothing to re-enable
    if (p.enabled && !conflicting.has(t.id)) continue // enabled again: done
    keep.push(t)
    if (!p.enabled) reminders.push(t)
  }
  return { keep, reminders }
}

export function formatReminders(reminders, { after = false } = {}) {
  if (!reminders.length) return null
  const head = after
    ? 're-enable what the conflict gate asked you to disable, once the measurements are done:'
    : `reminder: ${reminders.map((t) => t.id).join(', ')} ${reminders.length === 1 ? 'is' : 'are'} disabled, as the conflict gate asked — re-enable after the measurement:`
  return [head, ...reminders.map((t) => `  ${t.enable}`)].join('\n')
}
