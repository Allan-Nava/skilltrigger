// The two inputs: a skill's SKILL.md (its name and description) and an eval set in
// skill-creator's format — a JSON array of { query, should_trigger }, any other field
// carried through untouched.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Enough YAML for skill frontmatter: top-level `key: value`, single- and double-quoted
// scalars, and `|` / `>` block scalars (with their -/+ chomping indicators accepted).
// Anything nested is skipped — skilltrigger needs two keys.
export function parseFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!m) return null
  const lines = m[1].split(/\r?\n/)
  const out = {}
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv) continue
    const [, key, rest] = kv
    const block = rest.match(/^([|>])[-+]?\s*$/)
    if (block) {
      const body = []
      while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || lines[i + 1] === '')) body.push(lines[++i])
      const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length))
      const stripped = body.map((l) => l.slice(indent))
      out[key] = block[1] === '|' ? stripped.join('\n').trim() : fold(stripped)
      continue
    }
    out[key] = scalar(rest.trim())
  }
  return out
}

// Folded: lines join with a space, a blank line becomes a newline.
function fold(lines) {
  const paras = []
  let cur = []
  for (const l of lines) {
    if (l.trim() === '') {
      if (cur.length) paras.push(cur.join(' '))
      cur = []
    } else cur.push(l.trim())
  }
  if (cur.length) paras.push(cur.join(' '))
  return paras.join('\n')
}

function scalar(s) {
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return JSON.parse(s.replace(/\\'/g, "'"))
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) return s.slice(1, -1).replace(/''/g, "'")
  return s
}

export function loadSkill(path) {
  const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'SKILL.md') : path
  if (!existsSync(file)) throw new Error(`no SKILL.md at ${path}`)
  const fm = parseFrontmatter(readFileSync(file, 'utf8'))
  if (!fm) throw new Error(`${file} has no frontmatter`)
  if (!fm.name) throw new Error(`${file} has no name in its frontmatter`)
  if (!/^[A-Za-z0-9][\w.-]*$/.test(fm.name)) throw new Error(`${file}: the name "${fm.name}" is not a plain skill name`)
  if (!fm.description) throw new Error(`${file} has no description in its frontmatter`)
  return { name: fm.name, description: fm.description }
}

export function parseEvalSet(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`the eval set is not valid JSON: ${e.message}`)
  }
  if (!Array.isArray(data)) throw new Error('the eval set must be a JSON array of { "query": string, "should_trigger": boolean }')
  if (!data.length) throw new Error('the eval set is empty')
  const seen = new Set()
  data.forEach((it, i) => {
    if (!it || typeof it !== 'object') throw new Error(`item ${i}: not an object`)
    if (typeof it.query !== 'string' || !it.query.trim()) throw new Error(`item ${i}: query must be a non-empty string`)
    if (typeof it.should_trigger !== 'boolean') throw new Error(`item ${i}: should_trigger must be true or false`)
    if (seen.has(it.query)) throw new Error(`item ${i}: duplicate query — compare matches reports by query text`)
    seen.add(it.query)
  })
  return data
}

export function loadEvalSet(file) {
  if (!existsSync(file)) throw new Error(`no eval set at ${file}`)
  return parseEvalSet(readFileSync(file, 'utf8'))
}
