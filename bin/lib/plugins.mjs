// The shadowing trap: an installed plugin that carries a skill of the same name. The
// model loads the real one, the stub is never invoked, and the rate reads as zero.
//
// Two sources, because neither sees everything:
//   - `claude plugin list --json` names every plugin, whether it is enabled and where
//     it is installed; the skills are read off <installPath>/skills/*/SKILL.md (and
//     commands/*.md). Reading only — nothing under the plugin cache is ever written.
//   - the roster in the `init` event of a stub-less `claude -p`, which lists what the
//     model actually sees: it also catches a user-level skill or a plugin the list
//     printed in a form this parser could not read.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './skill.mjs'

const split = (id) => {
  const at = id.lastIndexOf('@')
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: null }
}

// → the plugins, [] when the output says there are none, or null when it is in no shape
// this parser knows. The two answers are kept apart on purpose: "zero plugins" lets the
// conflict gate pass, "could not read" must not (ST-18).
export function parsePluginList(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return null
  if (text.startsWith('[')) {
    let list
    try {
      list = JSON.parse(text)
    } catch {
      return null
    }
    if (!Array.isArray(list) || !list.every((p) => typeof p?.id === 'string' && p.id)) return null
    return list.map((p) => ({ id: p.id, ...split(p.id), enabled: p.enabled !== false, scope: p.scope ?? null, installPath: p.installPath ?? null }))
  }
  // The human form:   ❯ name@marketplace / Version: / Scope: / Status: ✔ enabled
  const out = []
  let cur = null
  for (const line of text.split('\n')) {
    const head = line.match(/^\s*(?:❯|>|\*|-)?\s*([\w.-]+@[\w.-]+)\s*$/)
    if (head) {
      cur = { id: head[1], ...split(head[1]), enabled: true, scope: null, installPath: null }
      out.push(cur)
      continue
    }
    if (!cur) continue
    const scope = line.match(/^\s*Scope:\s*(\S+)/i)
    if (scope) cur.scope = scope[1]
    const status = line.match(/^\s*Status:\s*(.*)$/i)
    if (status) cur.enabled = !/disabled/i.test(status[1])
  }
  if (out.length) return out
  // A human form that says so: "No plugins installed.", or a heading over "(none)".
  if (/\bno plugins\b/i.test(text) || /^installed plugins:\s*(\(none\))?\s*$/i.test(text.replace(/\s+/g, ' ').trim())) return []
  return null
}

export function pluginSkills(installPath) {
  if (!installPath || !existsSync(installPath)) return []
  const names = new Set()
  const skills = join(installPath, 'skills')
  if (existsSync(skills)) {
    for (const d of readdirSync(skills, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const f = join(skills, d.name, 'SKILL.md')
      if (!existsSync(f)) continue
      let name = d.name
      try {
        name = parseFrontmatter(readFileSync(f, 'utf8'))?.name || d.name
      } catch {}
      names.add(name)
    }
  }
  const commands = join(installPath, 'commands')
  if (existsSync(commands)) for (const f of readdirSync(commands)) if (f.endsWith('.md')) names.add(f.slice(0, -3))
  return [...names].sort()
}

// → [{ id, scope, via }] — id null when the roster shows a same-named skill no plugin
// accounts for (a user or project skill).
export function findConflicts({ plugins, skillName, roster = [] }) {
  const found = new Map()
  for (const p of plugins) {
    if (!p.enabled) continue
    if (pluginSkills(p.installPath).includes(skillName)) found.set(p.id, { id: p.id, scope: p.scope, via: `${p.id} carries a skill named ${skillName}` })
  }
  for (const entry of roster) {
    const e = String(entry).replace(/^\//, '')
    const [prefix, rest] = e.includes(':') ? [e.slice(0, e.lastIndexOf(':')), e.slice(e.lastIndexOf(':') + 1)] : [null, e]
    if (rest !== skillName) continue
    if (prefix) {
      const p = plugins.find((x) => x.enabled && x.name === prefix)
      if (p && !found.has(p.id)) found.set(p.id, { id: p.id, scope: p.scope, via: `roster: ${e}` })
      else if (!p && ![...found.values()].some((f) => f.via === `roster: ${e}`)) found.set(`roster:${e}`, { id: null, scope: null, via: `roster: ${e}` })
    } else if (!found.has(`roster:${e}`)) found.set(`roster:${e}`, { id: null, scope: null, via: `roster: ${e}` })
  }
  return [...found.values()]
}

// The commands are printed, never run: disabling a plugin is the user's decision, and so
// is re-enabling it — bin/lib/toggles.mjs only reminds them of it (ST-21).
export function toggleCommands(conflicts) {
  const withScope = (verb, c) => `claude plugin ${verb} ${c.id}${c.scope ? ` --scope ${c.scope}` : ''}`
  const plugins = conflicts.filter((c) => c.id)
  return { disable: plugins.map((c) => withScope('disable', c)), enable: plugins.map((c) => withScope('enable', c)) }
}
