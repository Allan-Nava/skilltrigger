// What the inherited environment contributes to every run, counted. Each `claude -p`
// inherits the user's whole configuration minus CLAUDECODE: memory files, hooks and MCP
// servers all reach the model, and a memory file naming the skill moves the rate without
// changing any other recorded field. So the report records how many of each there were
// — counts only: never a file's contents, a path, a hook command or a server name (ST-20).
//
// Reading only. Nothing under the configuration directory is ever written.
//
//   memory files  project: CLAUDE.md, CLAUDE.local.md and .claude/CLAUDE.md in the run's
//                 temporary project and each of its ancestors, plus .claude/rules/**/*.md
//                 in the project itself; user: CLAUDE.md and rules/**/*.md in the
//                 configuration directory ($CLAUDE_CONFIG_DIR, else ~/.claude)
//   hooks         hook commands in the user and project settings files and in each
//                 enabled plugin's hooks/hooks.json (managed settings are not read)
//   mcpServers    the length of the init event's mcp_servers, null when it has none
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const isFile = (f) => {
  try {
    return statSync(f).isFile()
  } catch {
    return false
  }
}

function markdownUnder(dir) {
  if (!existsSync(dir)) return 0
  let n = 0
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (d.isDirectory()) n += markdownUnder(join(dir, d.name))
    else if (d.isFile() && d.name.endsWith('.md')) n++
  }
  return n
}

export const configDirOf = (env = process.env) => env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), '.claude')

export function memoryFiles({ projectDir, configDir }) {
  let project = markdownUnder(join(projectDir, '.claude', 'rules'))
  for (let dir = projectDir; ; dir = dirname(dir)) {
    for (const f of ['CLAUDE.md', 'CLAUDE.local.md', join('.claude', 'CLAUDE.md')]) if (isFile(join(dir, f))) project++
    if (dirname(dir) === dir) break
  }
  const user = (isFile(join(configDir, 'CLAUDE.md')) ? 1 : 0) + markdownUnder(join(configDir, 'rules'))
  return { project, user }
}

function hooksIn(file) {
  if (!isFile(file)) return 0
  let hooks
  try {
    hooks = JSON.parse(readFileSync(file, 'utf8'))?.hooks
  } catch {
    return 0
  }
  if (!hooks || typeof hooks !== 'object') return 0
  let n = 0
  for (const groups of Object.values(hooks)) if (Array.isArray(groups)) for (const grp of groups) n += Array.isArray(grp?.hooks) ? grp.hooks.length : 0
  return n
}

export function countHooks({ configDir, projectDir = null, plugins = [] }) {
  const files = [join(configDir, 'settings.json'), ...(projectDir ? [join(projectDir, '.claude', 'settings.json'), join(projectDir, '.claude', 'settings.local.json')] : [])]
  for (const p of plugins) if (p.enabled && p.installPath) files.push(join(p.installPath, 'hooks', 'hooks.json'))
  return files.reduce((n, f) => n + hooksIn(f), 0)
}

// `memory` is passed when it was counted earlier, from a directory since removed.
export function environmentSummary({ env = process.env, projectDir = null, memory = null, plugins = [], init = null }) {
  const configDir = configDirOf(env)
  return {
    memoryFiles: memory ?? memoryFiles({ projectDir, configDir }),
    hooks: countHooks({ configDir, projectDir, plugins }),
    mcpServers: Array.isArray(init?.mcp_servers) ? init.mcp_servers.length : null,
  }
}
