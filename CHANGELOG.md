# Changelog

All notable changes to skilltrigger. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Items reference their `ST-n` backlog id.

## [Unreleased]

### Added
- `run --threshold <rate>`: the per-query pass threshold, 0.5 by default — a positive
  passes at a trigger rate of at least that, a negative under it. It must lie strictly
  between 0 and 1, and is recorded in the report's `triggerThreshold` as before. It
  decides pass and fail per query only; the totals, the verdict and the exit code do not
  read it. A paired run judges both sides at the one threshold, and `compare` warns when
  two reports were judged at different ones (ST-17).
- The sleep gate holds the machine awake on Linux: it runs a watcher of skilltrigger's
  process under `systemd-inhibit --what=idle:sleep --mode=block --no-ask-password`, so
  the lock is held for the run and released when skilltrigger exits, as `caffeinate -w`
  does on macOS. Without systemd-inhibit, or when logind refuses the lock, the gate warns
  with the reason, as before. Tested against a fake; not yet run on a live Linux host
  (ST-16).
- An eval-set field, `needs_context: true`, for a positive that presupposes material
  already in a session. Such a prompt is run like any other and counted apart: out of
  the positives total and the pass count, into its own group — `totals.needsContext` in
  the JSON, `needs_context positives triggered` in the summary, a section of its own in
  the Markdown, a `ctx` row and its own total in `compare` and in a paired report — so the
  known limit of `claude -p` is a number rather than a footnote. Its runs still count
  towards the no-verdict rule. The field marks positives only; `compare` warns when two
  reports mark a shared query differently. An eval set without it gives the report it
  always did (ST-15).

## [0.0.3] — 2026-10-03

0.0.3 adds `--baseline-description` (ST-14) and still has not been run against a live
CLI; 0.1.0 waits on ST-11 and ST-12.

### Added
- `run --baseline-description <text|file>`: the old description and the new one measured
  in one invocation, under one preflight, interleaved run by run — each query once with
  each text, back to back, the order inside the pair flipping every pass — so both numbers
  share the day, the CLI, the model and the roster by construction, and a drift during the
  run lands on both alike. A file is read whole, or for its frontmatter `description` when
  it is a `SKILL.md`. The paired report carries both sides as complete reports and the
  comparison: per-query deltas and the two totals, with `compare`'s noise labels. The
  no-verdict rule holds per side, and either side without a verdict is no verdict, exit 3.
  A run without the flag, and its report, are unchanged; `compare` still takes single
  reports and refuses a paired one (ST-14).

### Fixed
- `skilltrigger help` no longer prints the first `import` line under the usage.

### Changed
- backlogsync is pinned to its 0.1.0 release instead of a commit: the CI `backlog` job,
  `backlog-issues.yml` and `release-drift.yml` at `@backlogsync--v0.1.0`, `npm run backlog`
  and `npm run roadmap` on `npx backlogsync@0.1.0`; `repository.url` takes the form npm
  normalises it to, so `npm publish` no longer rewrites it (ST-23).

## [0.0.2] — 2026-10-01

Tested only against the fake `claude` the tests use, never against a live CLI — the
first live run is the gate on 0.1.0 (ST-11, ST-12). The first version on npm, published
by hand so that trusted publishing can be configured (ST-13); it carries 0.0.1, which was
never released, and the entries below.

### Added
- The report records what `compare` needs to tell two environments apart: the roster's
  members beside its counts, each as the first 12 hex digits of its name's SHA-256 — a
  roster names private skills, and a report is meant to be shared; the model each run's `init` event
  reported, per run and counted in `runModels`; and a count of what the inherited
  environment contributed — memory files for the temporary project and for the user,
  hooks configured, MCP servers in the `init` event — never their contents, paths or
  names (ST-20).
- A re-enable reminder. The toggles the conflict gate prints are remembered in
  `.skilltrigger-toggles` under the `--out` directory, never under `~/.claude`; every
  `preflight` that sees such a plugin still disabled, and the end of every `run`, prints
  its `claude plugin enable …` command, until a preflight sees it enabled again or
  uninstalled. `preflight` takes `--out` for it, defaulting to `./skilltrigger-results`
  as `run` does. Nothing is enabled or disabled by skilltrigger itself (ST-21).

### Changed
- The backlog check, the roadmap, the issue sync and the release-drift check are
  [backlogsync](https://github.com/Allan-Nava/backlogsync), pinned by commit;
  `scripts/backlog.mjs` and its test are gone, and `npm run roadmap` regenerates
  `ROADMAP.md` (ST-22).
- `compare` warns when roster members differ, counting the members added and removed by hash, not
  only when the counts differ; and when the models the runs reported or the inherited
  environment's counts differ. Reports without the new fields compare as before (ST-20).

### Fixed
- A verdict no longer survives losing whole queries. The 10% rule counts runs, so two
  positive queries could lose every run to timeouts or errors and the report still gave
  a verdict on a smaller positives total. A query that was run and measured nothing is
  now no verdict, exit 3, with the lost queries named in the headline and recorded as
  `lostQueries`; a query that lost some but not all of its runs keeps the verdict and is
  flagged, in `partialQueries`, in its row and under the table (ST-19).
- The conflict gate no longer passes when it cannot read the plugin list. Output from
  `claude plugin list --json` in a shape the parser does not know used to read as zero
  plugins and the gate said `ok` with nothing checked; it now fails, quoting the first
  line of what it got, truncated. A valid empty JSON array, or a human-form list that
  says no plugins are installed, is still zero plugins and passes; the human-form
  fallback for an older CLI without `--json` stays. `--allow-conflict` lets an
  unreadable list through as a recorded warning (ST-18).
- `release.yml` closes only the milestone titled `v<version>`, alone or followed by a
  space and a subtitle. It matched any title starting with `v<version>`, so a 0.0.2 tag
  could have closed a `v0.0.20` milestone, and 0.1.1 one called `v0.1.10` (ST-13).

## [0.0.1] — 2026-10-01 — not released

The first version, in the repository only: the gates, the runner, the report and their
tests against a fake `claude`. Nothing has been measured with a real model yet; the
first version on npm is 0.1.0, after that measurement (ST-11).

### Added
- `skilltrigger preflight`: six gates — `cli` (on PATH, version recorded), `auth`
  (`claude auth status`), `round-trip` (`claude -p "Reply with exactly: pong"` with the
  chosen model), `conflict` (an enabled plugin or visible skill of the same name; the
  disable and enable commands printed, never run; `--allow-conflict` records it),
  `sleep` (`caffeinate -i -s -w <pid>` on macOS, a warning elsewhere) and `roster`
  (slash commands and skills from the `init` event). Exit 2 on any failure (ST-2 to ST-5).
- `skilltrigger run`: strictly serial; one temporary project and one stub command per
  run, removed afterwards; detection from the partial stream events, the process
  stopped at the decision; four outcomes — `triggered`, `not-triggered`, `timeout`,
  `error` — with an authentication or API error never scored as a miss, and a run whose
  `init` event does not list the stub scored as an error (ST-6).
- The verdict rule: more than 10% of runs timing out or failing is no verdict, exit 3,
  and the run stops as soon as that share is passed. Reports in JSON and Markdown that
  carry the queries, the counts and the versions, and no description text, path or stub
  name (ST-7).
- `skilltrigger compare`: per query and total differences over the shared queries, a
  warning when model, CLI version or roster differ, ±1 per query at two runs labelled
  noise (ST-8).
- A fake `claude` driven by environment variables, and tests for every gate, every
  outcome, the no-verdict rule, compare's drift warning and the removal of the
  temporary project (ST-9).
- `skilltrigger check`, CI on Node 18/20/22/24, the release workflow over npm trusted
  publishing, the site, the backlog and its generated roadmap (ST-10).
