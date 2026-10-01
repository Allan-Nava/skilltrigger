# Contributing

## Local loop

Nothing to build. Node 18 or later; `npm install` only for the site build.

```bash
npm test              # skilltrigger check, then node --test against the fake claude
npm run backlog       # BACKLOG.md lints, ROADMAP.md is in step
npm run build:site    # site/dist/index.html from README.md
```

The tests never reach a model. `test/fake/claude` is a Node script the helpers put
first on `PATH`; environment variables decide what it answers — `FAKE_CLAUDE_AUTH`,
`FAKE_CLAUDE_PLUGINS`, `FAKE_CLAUDE_PONG`, `FAKE_CLAUDE_QUERIES` and the rest, listed at
the top of the script. To try the CLI by hand against it:

```bash
export PATH="$PWD/test/fake:$PATH" FAKE_CLAUDE_PLUGIN_DIR="$PWD/test/fixtures/plugin"
node bin/skilltrigger.mjs preflight --skill test/fixtures/skills/demo-skill
FAKE_CLAUDE_QUERIES='{"show me a demo of the thing":"trigger"}' \
  node bin/skilltrigger.mjs run --skill test/fixtures/skills/demo-skill \
  --eval test/fixtures/evals/demo.json --out /tmp/st-out
FAKE_CLAUDE_PLUGINS=conflict node bin/skilltrigger.mjs preflight --skill test/fixtures/skills/demo-skill
```

A change in how the real CLI behaves goes in the fake first, as a new mode, then in a
test, then in the code.

## A real measurement

Only the maintainer runs these, by hand, with a logged-in CLI; they cost model calls.

```bash
skilltrigger preflight --skill <skill dir> --model <model>
skilltrigger run --skill <skill dir> --eval <eval set> --model <model>
```

Read the report's roster, CLI and model lines before the rate, and compare a rewrite
only against a baseline measured the same day (`skilltrigger compare`). Results worth
keeping are copied, dated, into the documentation they are about; `skilltrigger-results/`
is gitignored.

## What must not be published

This repository is public. Never commit a private repository, host or service name, a
client name, an absolute path under a home directory, a work email address or anything
that looks like a key. `npm test` refuses a home-directory path and an email address in
any tracked file. Reports are built to carry the queries, counts and versions only — an
eval set's queries are public text, so write them that way.

## The social card

`assets/social-preview.png` is rendered from `assets/social-preview.html` by
`node scripts/social.mjs` (headless Chrome, found rather than installed). Regenerate it
when the card's text goes stale; the card references `logo.svg` by a relative path.

## Backlog, roadmap, issues

`BACKLOG.md` is the single source of truth, ids `ST-n`. After editing it run
`npm run roadmap` and commit `ROADMAP.md` in the same commit. The issues follow on push
to `main` (`backlog-issues.yml`), one way only. All three — the check, the roadmap and the
sync — are [backlogsync](https://github.com/Allan-Nava/backlogsync), pinned by commit in
`package.json` and the workflows; bump the three pins together.

## Pull requests

One concern per pull request; `npm test` green; a CHANGELOG entry under
`[Unreleased]` with the `ST-n` id; the backlog ticked with `ver=main` when an item ships.

## Releasing

Releases run from GitHub Actions; pushing the tag is the manual step, and
`release-drift.yml` fails when `main` carries a version with no tag for two hours —
unless the CHANGELOG heading for that version says `not released`, as 0.0.1's does.

**The first publish is by hand.** npm cannot configure a trusted publisher for a package
that does not exist, so the first version (0.1.0, after the measurement gate ST-11) is
published from a clean checkout of the tagged commit:

```bash
npm test && npm pack --dry-run
npm publish --access public
```

Then on npmjs.com → package → Settings → Trusted Publisher → GitHub Actions: user
`Allan-Nava`, repository `skilltrigger` (the name, not the URL), workflow `release.yml`,
environment empty. Push the tag afterwards: `release.yml` sees the version already on
the registry, skips the publish, and still cuts the release and closes the milestone.
Never give `actions/setup-node` a `registry-url`; never rename `release.yml`.

**Every later release:**

```bash
# 1. bump package.json's version (and the lockfile: npm install --package-lock-only)
#    rename CHANGELOG's [Unreleased] to [x.y.z] — date, open a new empty [Unreleased]
#    turn every ver=main in BACKLOG.md into ver=x.y.z, regenerate the roadmap
npm test
# 2. land the bump on main through a pull request, then tag that merge commit
git checkout main && git pull
git tag skilltrigger--v{version} && git push origin skilltrigger--v{version}
```

The tag triggers `release.yml`: version check, tests, publish over OIDC, wait for the
registry, GitHub release, close the milestone whose title starts with `v{version}`.
Re-run with `gh workflow run Release -f tag=skilltrigger--v{version}`; every step is
idempotent. The notes open with the version's CHANGELOG section
(`scripts/release-notes.mjs`); a **Breaking** entry goes first under its heading, and
`npm test` fails when it does not.
