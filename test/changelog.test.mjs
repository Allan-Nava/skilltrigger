import assert from 'node:assert/strict'
import { test } from 'node:test'
import { breakingOutOfPlace, changelogSection } from '../bin/lib/changelog.mjs'

// The release notes open with the tag's CHANGELOG section, and a Breaking entry is
// always the first under its heading — so it is the first thing an upgrader reads.
const LOG = `# Changelog

## [Unreleased]

### Added
- something new.

## [0.2.0] — 2026-11-01

One line of context.

### Changed
- **Breaking for report files.** The JSON report renames a field.
- The compare output names the roster.

## [0.1.0] — 2026-10-15

First version.
`

test('changelogSection returns the body of one version, without its heading or the next section', () => {
  const s = changelogSection(LOG, '0.2.0')
  assert.ok(s.startsWith('One line of context.'))
  assert.doesNotMatch(s, /0\.1\.0|First version|## \[/)
  assert.equal(changelogSection(LOG, '0.1.0'), 'First version.')
  assert.equal(changelogSection(LOG, '9.9.9'), null)
  assert.equal(changelogSection(LOG, '0.2'), null, 'a prefix of a version is not the version')
})

test('breakingOutOfPlace names a Breaking entry that is not first under its heading', () => {
  assert.deepEqual(breakingOutOfPlace(LOG), [])
  const bad = LOG.replace('- **Breaking for report files.** The JSON report renames a field.\n- The compare output names the roster.', '- The compare output names the roster.\n- **Breaking for report files.** The JSON report renames a field.')
  assert.deepEqual(breakingOutOfPlace(bad), [{ section: '0.2.0', heading: 'Changed' }])
})
