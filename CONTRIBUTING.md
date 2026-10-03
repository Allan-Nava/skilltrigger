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

Read the report's roster, CLI and model lines before the rate, and judge a rewrite
against its baseline measured in the same run (`--baseline-description`), or at least
the same day (`skilltrigger compare`). Results worth
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
sync — are [backlogsync](https://github.com/Allan-Nava/backlogsync), pinned to its release in
`package.json` (`backlogsync@0.1.0`) and the workflows (`@backlogsync--v0.1.0`); bump
them together.

## Pull requests

One concern per pull request; `npm test` green; a CHANGELOG entry under
`[Unreleased]` with the `ST-n` id; the backlog ticked with `ver=main` when an item ships.

## Releasing

Releases run from GitHub Actions; pushing the tag is the manual step, and
`release-drift.yml` fails once the version merged on `main` has gone two hours without
its tag — unless the CHANGELOG heading for that version says `not released`, as 0.0.1's
does. 0.0.2's does not, so the drift check goes red two hours after the 0.0.2 merge until
step 3 below is done.

**The first publish is by hand: 0.0.2.** npm cannot configure a trusted publisher for a
package that does not exist, so the first version on npm — 0.0.2, decided 2026-10-01,
ahead of the measurement gate on 0.1.0 (ST-11, ST-12) — goes up by hand, in this order:

1. On a clean checkout of `main` at the merged release commit, log in and publish:

   ```bash
   git checkout main && git pull --ff-only && git status --short   # must print nothing
   npm test && npm pack --dry-run
   npm login
   npm publish --access public
   ```

2. Configure the trusted publisher, either from the command line — `npm trust` needs
   npm 11.15 or later; `npx npm@11.19.0`, the version `release.yml` pins, runs it
   without upgrading the global npm:

   ```bash
   npx npm@11.19.0 trust github skilltrigger --repo Allan-Nava/skilltrigger --file release.yml --allow-publish
   ```

   or on npmjs.com → package → Settings → Trusted Publisher → GitHub Actions: owner
   `Allan-Nava` exactly, repository `skilltrigger` (the name, not the URL), workflow
   `release.yml`, environment empty.

3. Push the tag on that same commit:

   ```bash
   git tag skilltrigger--v0.0.2 && git push origin skilltrigger--v0.0.2
   ```

   `release.yml` sees 0.0.2 already on the registry, skips the publish, and still cuts
   the GitHub release. It closes only a milestone titled `v0.0.2` exactly, or
   `v0.0.2 ` and a subtitle, and there is none — the `v0.1.0` milestone is left as it
   is. Then tick ST-13 with `ver=0.0.2`.

From 0.0.3 on, every version is published by `release.yml` over OIDC, on a tag. Never
give `actions/setup-node` a `registry-url`; never rename `release.yml`.

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
registry, GitHub release, close the milestone titled `v{version}` — alone or followed by
a space and a subtitle, so `v0.1.1` never closes `v0.1.10 — …`.
Re-run with `gh workflow run Release -f tag=skilltrigger--v{version}`; every step is
idempotent. The notes open with the version's CHANGELOG section
(`scripts/release-notes.mjs`); a **Breaking** entry goes first under its heading, and
`npm test` fails when it does not.
