// `skilltrigger check` — the repository's own invariants — on the real tree, and each
// rule broken once on a copy of the minimum it reads.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkRepo, privateFindings } from '../bin/lib/check.mjs'
import { TRAPS } from '../bin/lib/traps.mjs'
import { ROOT, scratch } from './helpers.mjs'

test('the repository passes its own check', () => {
  assert.deepEqual(checkRepo(ROOT), [])
})

function tree(mutate = {}) {
  const s = scratch()
  const files = {
    'package.json': JSON.stringify({ name: 'skilltrigger', version: '1.2.3', files: ['bin', 'README.md', 'CHANGELOG.md', 'LICENSE'], repository: { url: 'https://github.com/Allan-Nava/skilltrigger' } }),
    'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] — 2026-10-01\n\n### Added\n- x\n',
    'README.md': `# skilltrigger\n\n${TRAPS.map((t) => `- **${t.phrase}**`).join('\n')}\n`,
    '.github/workflows/release.yml': 'run: node scripts/release-notes.mjs "$VERSION"\n',
    ...mutate,
  }
  for (const [f, text] of Object.entries(files)) {
    if (text === null) continue
    mkdirSync(join(s.dir, f, '..'), { recursive: true })
    writeFileSync(join(s.dir, f), text)
  }
  return s
}
function errorsFor(mutate) {
  const s = tree(mutate)
  try {
    return checkRepo(s.dir)
  } finally {
    s.cleanup()
  }
}

test('a minimal tree passes', () => {
  assert.deepEqual(errorsFor({}), [])
})

test('the version must have its CHANGELOG section, and [Unreleased] must exist', () => {
  assert.match(errorsFor({ 'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n' }).join('\n'), /no section for 1\.2\.3/)
  assert.match(errorsFor({ 'CHANGELOG.md': '# Changelog\n\n## [1.2.3] — 2026-10-01\n' }).join('\n'), /\[Unreleased\]/)
})

test('a Breaking entry leads its heading', () => {
  const log = '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] — 2026-10-01\n\n### Changed\n- a\n- **Breaking**: b\n'
  assert.match(errorsFor({ 'CHANGELOG.md': log }).join('\n'), /Breaking/)
})

test('the README must name every trap', () => {
  const readme = `# skilltrigger\n\n${TRAPS.slice(1).map((t) => `- **${t.phrase}**`).join('\n')}\n`
  assert.match(errorsFor({ 'README.md': readme }).join('\n'), new RegExp(TRAPS[0].phrase))
})

test('no runtime dependency', () => {
  const pkg = JSON.stringify({ name: 'skilltrigger', version: '1.2.3', files: ['bin', 'README.md', 'CHANGELOG.md', 'LICENSE'], repository: { url: 'https://github.com/Allan-Nava/skilltrigger' }, dependencies: { chalk: '1' } })
  assert.match(errorsFor({ 'package.json': pkg }).join('\n'), /runtime dependencies/)
})

test('release.yml must build its notes from the CHANGELOG', () => {
  assert.match(errorsFor({ '.github/workflows/release.yml': 'run: gh release create\n' }).join('\n'), /release-notes/)
})

// The strings are assembled so this file does not itself carry what it tests for.
const HOME = ['', 'Users', 'someone', 'projects', 'x'].join('/')
const LINUX_HOME = ['', 'home', 'someone', '.claude'].join('/')
const MAIL = ['someone', 'example-corp.io'].join('@')

test('a home path or an email address in a file is a finding, naming the file and the kind only', () => {
  for (const [text, kind] of [
    [`see ${HOME}/notes`, /home directory path/],
    [`see ${LINUX_HOME}/skills`, /home directory path/],
    [`mail ${MAIL}`, /email address/],
  ]) {
    const f = privateFindings([{ path: 'docs/x.md', text }])
    assert.equal(f.length, 1, text)
    assert.match(f[0], kind)
    assert.match(f[0], /^docs\/x\.md:1 /)
    assert.ok(!f[0].includes('someone'), 'the finding does not repeat the match')
  }
  assert.deepEqual(privateFindings([{ path: 'a.md', text: 'a tilde path ~/.claude/skills and git@github.com:org/repo is fine' }]), [])
})

test('the tracked-files sweep reaches a file in the tree', () => {
  const s = tree({ 'notes/leak.md': `path ${HOME}\n` })
  try {
    assert.match(checkRepo(s.dir).join('\n'), /notes\/leak\.md:1 .*home directory path/)
  } finally {
    s.cleanup()
  }
})

test('README in this repository names the six traps by their phrases', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').toLowerCase()
  assert.equal(TRAPS.length, 6)
  for (const t of TRAPS) assert.ok(readme.includes(t.phrase.toLowerCase()), t.phrase)
})
