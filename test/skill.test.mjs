import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadEvalSet, loadSkill, parseFrontmatter, parseEvalSet } from '../bin/lib/skill.mjs'
import { SKILL, EVALS, scratch } from './helpers.mjs'

test('frontmatter: plain, quoted, folded and literal scalars', () => {
  assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: plain words: with a colon\n---\nbody'), { name: 'a', description: 'plain words: with a colon' })
  assert.equal(parseFrontmatter('---\ndescription: "say \\"hi\\""\n---\n').description, 'say "hi"')
  assert.equal(parseFrontmatter("---\ndescription: 'it''s'\n---\n").description, "it's")
  assert.equal(parseFrontmatter('---\ndescription: >\n  one\n  two\n\n  three\n---\n').description, 'one two\nthree')
  assert.equal(parseFrontmatter('---\ndescription: |\n  one\n  two\n---\n').description, 'one\ntwo')
  assert.equal(parseFrontmatter('no frontmatter'), null)
})

test('loadSkill reads name and description from SKILL.md', () => {
  const s = loadSkill(SKILL)
  assert.equal(s.name, 'demo-skill')
  assert.match(s.description, /^Demonstrates a skill for the tests: "quoted words", a colon: here, and a second folded line\. Use when/)
})

test('loadSkill accepts the SKILL.md path itself, and refuses a directory without one', () => {
  assert.equal(loadSkill(join(SKILL, 'SKILL.md')).name, 'demo-skill')
  const { dir, cleanup } = scratch()
  try {
    assert.throws(() => loadSkill(dir), /no SKILL\.md/)
    mkdirSync(join(dir, 'x'))
    writeFileSync(join(dir, 'x', 'SKILL.md'), '---\nname: x\n---\n')
    assert.throws(() => loadSkill(join(dir, 'x')), /no description/)
  } finally {
    cleanup()
  }
})

test('the eval set: skill-creator format, extra fields carried through', () => {
  const items = loadEvalSet(EVALS)
  assert.equal(items.length, 4)
  assert.equal(items[1].note, 'carried through to the report')
  assert.equal(items.filter((i) => i.should_trigger).length, 2)
})

test('the eval set is validated before anything runs', () => {
  assert.throws(() => parseEvalSet('{}'), /JSON array/)
  assert.throws(() => parseEvalSet('not json'), /not valid JSON/)
  assert.throws(() => parseEvalSet('[]'), /empty/)
  assert.throws(() => parseEvalSet('[{"should_trigger":true}]'), /item 0: query/)
  assert.throws(() => parseEvalSet('[{"query":"a","should_trigger":"yes"}]'), /item 0: should_trigger/)
  assert.throws(() => parseEvalSet('[{"query":"a","should_trigger":true},{"query":"a","should_trigger":false}]'), /item 1: duplicate query/)
})
