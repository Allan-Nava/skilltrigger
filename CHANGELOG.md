# Changelog

All notable changes to skilltrigger. The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [SemVer](https://semver.org/). Items reference their `ST-n` backlog id.

## [Unreleased]

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
