// `skilltrigger check` — the repository's own invariants, run by `npm test`.
//
//   - package.json and CHANGELOG.md agree on the version; [Unreleased] exists; a
//     Breaking entry leads its heading; release.yml builds its notes from the CHANGELOG
//   - zero runtime dependencies, and package.json#files ships what the CLI needs
//   - the README names each of the six traps by its phrase (bin/lib/traps.mjs)
//   - no tracked file carries a home-directory path or an email address
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { breakingOutOfPlace } from './changelog.mjs'
import { TRAPS } from './traps.mjs'

// skilltrigger:allow-private-shapes — this file defines the patterns it forbids.
// A home path: /Users/<name> or /home/<name>, the name a real one (a placeholder in
// angle brackets does not match). An email: any address but git's SSH user.
const SHAPES = [
  [/(?:^|[\s"'`(=:])\/(?:Users|home)\/[A-Za-z0-9._-]+/m, 'a home directory path'],
  [/\b(?!git@)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/, 'an email address'],
]
export const ALLOW_SHAPES = 'skilltrigger:allow-private-shapes'

// → ["path:line looks like <kind> …"] — the finding names the file and the kind, never
// the match: an error message is printed, logged by CI and pasted into issues.
export function privateFindings(files) {
  const out = []
  for (const { path, text } of files) {
    if (text.includes(ALLOW_SHAPES)) continue
    for (const [re, what] of SHAPES) {
      const m = text.match(re)
      if (!m) continue
      const line = text.slice(0, m.index + (m[0].startsWith('/') ? 0 : 1)).split('\n').length
      out.push(`${path}:${line} looks like ${what} — this repository is public`)
      break
    }
  }
  return out
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist'])
const BINARY = /\.(png|jpe?g|gif|ico|webp|woff2?|tgz|gz|zip|pdf)$/i

function* walk(root, dir = root) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* walk(root, p)
    else yield relative(root, p)
  }
}

// Tracked files plus untracked ones git would add (so a check before the first commit
// sees the tree); outside a git checkout, the tree walked.
function trackedFiles(root) {
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (relative(top, root) === '') return out.split('\n').filter(Boolean)
  } catch {}
  return [...walk(root)]
}

export function checkRepo(root) {
  const errors = []
  const fail = (m) => errors.push(m)
  const read = (f) => readFileSync(join(root, f), 'utf8')
  const has = (f) => existsSync(join(root, f))

  let pkg = {}
  try {
    pkg = JSON.parse(read('package.json'))
  } catch (e) {
    fail(`package.json: ${e.message}`)
  }
  if (pkg.name !== 'skilltrigger') fail('package.json#name must be skilltrigger')
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version ?? '')) fail(`package.json#version is not x.y.z: ${pkg.version}`)
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) fail('no runtime dependencies — package.json#dependencies must be empty')
  for (const f of ['bin', 'README.md', 'CHANGELOG.md', 'LICENSE']) if (!pkg.files?.includes(f)) fail(`package.json#files is missing ${f}`)
  if (!/^(?:git\+)?https:\/\/github\.com\/Allan-Nava\/skilltrigger(?:\.git)?$/.test(pkg.repository?.url ?? pkg.repository ?? '')) fail('package.json#repository must be the GitHub repository URL')

  if (!has('CHANGELOG.md')) fail('CHANGELOG.md is missing')
  else {
    const log = read('CHANGELOG.md')
    if (!/^## \[Unreleased\]/m.test(log)) fail('CHANGELOG.md needs an [Unreleased] section')
    if (pkg.version && !log.includes(`## [${pkg.version}]`)) fail(`CHANGELOG.md has no section for ${pkg.version}, the version in package.json`)
    for (const b of breakingOutOfPlace(log)) fail(`CHANGELOG.md [${b.section}] ### ${b.heading}: a **Breaking** entry must be the first under its heading`)
  }
  if (has('.github/workflows/release.yml') && !read('.github/workflows/release.yml').includes('scripts/release-notes.mjs')) fail('release.yml must build the notes from the CHANGELOG with scripts/release-notes.mjs')

  if (!has('README.md')) fail('README.md is missing')
  else {
    const readme = read('README.md').toLowerCase()
    for (const t of TRAPS) if (!readme.includes(t.phrase.toLowerCase())) fail(`README.md must name the trap "${t.phrase}" (bin/lib/traps.mjs)`)
  }

  const files = []
  for (const f of trackedFiles(root)) {
    if (BINARY.test(f) || !existsSync(join(root, f))) continue
    const st = statSync(join(root, f))
    if (!st.isFile() || st.size > 4 * 1024 * 1024) continue
    files.push({ path: f, text: read(f) })
  }
  errors.push(...privateFindings(files))
  return errors
}
