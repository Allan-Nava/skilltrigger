# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

`skilltrigger` is a **command-line tool**, not a plugin: it measures how often a Claude
Code skill's `description` makes the model load it, behind gates that refuse to report
a number they cannot trust. It spawns the `claude` CLI; it is not loaded by it. There
are no plugin manifests and no hooks here, on purpose.

Zero runtime dependencies, Node 18+, ESM. `marked` is a devDependency used only by the
site build.

## Layout

```
bin/
  skilltrigger.mjs     the CLI: preflight, run, compare, check; exit codes 0/1/2/3
  lib/args.mjs         argument parser (util.parseArgs is 18.3+, the floor is 18.0)
  lib/claude.mjs       spawning claude: env minus CLAUDECODE, process-group kill
  lib/gates.mjs        the six gates and their formatting
  lib/plugins.mjs      plugin list parsing, a plugin's skills, conflicts, the fix text
  lib/environment.mjs  memory files, hooks and MCP servers the runs inherit, counted
  lib/toggles.mjs      the re-enable reminder: the gate's toggles, kept under --out
  lib/stream.mjs       the detector: one run's events → an outcome
  lib/runner.mjs       the serial runner: temp project, stub, one claude -p per run
  lib/report.mjs       summary, verdict rule, JSON + Markdown
  lib/compare.mjs      two reports, drift warnings, noise labels
  lib/check.mjs        the repository's own invariants (npm test)
  lib/traps.mjs        the six traps and the README phrase for each
  lib/changelog.mjs    the CHANGELOG, read (release notes, Breaking-first rule)
test/
  fake/claude          the fake CLI, driven by FAKE_CLAUDE_* variables
  helpers.mjs          the fake environment and the CLI runner
  fixtures/            a skill, a plugin carrying the same skill, an eval set
  *.test.mjs           node --test
scripts/
  backlog.mjs          BACKLOG.md → ROADMAP.md, issue sync (backlog_test.mjs, fixtures/)
  release-notes.mjs    the CHANGELOG section a release's notes open with
  social.mjs           renders assets/social-preview.png with headless Chrome
site/build.mjs         site/dist/index.html from README.md (gitignored output)
assets/                logo.svg (the single source of the mark), social card
thoughts/ST-1-…/       the task brief
```

## The rules the code encodes

Do not weaken these; they are the tool's whole reason to exist.

1. **Serial, always.** No workers option. Parallel runs divide the measured rate by
   the number of workers (README, first trap).
2. **A failed gate refuses the run.** `run` calls the preflight and exits 2 before
   sending a single query.
3. **A timeout or an error is never a miss.** Four outcomes; only `triggered` and
   `not-triggered` count towards a rate. An authentication failure or API error line is
   `error`. A run whose `init` event does not list the stub is `error`.
4. **More than 10% timeouts and errors is no verdict**, exit 3, and the run stops as
   soon as that share of the plan is passed. **So is a query that lost every run** — the
   share counts runs, not queries, and must not hide a whole query (ST-19).
5. **Nothing under `~/.claude` is written.** Runs live in `mkdtemp` directories that
   are removed; every `claude -p` gets `--no-session-persistence`. Plugin install
   directories are read, never written.
6. **Fixes are printed, never run.** The conflict gate prints `claude plugin disable`
   and `enable`; it does not call them. It remembers them in `<out>/.skilltrigger-toggles`
   — never under `~/.claude` — and prints the enable command while the plugin stays
   disabled (ST-21).
7. **The report carries queries, counts and versions only** — plus the roster's member
   names and the model each run reported (ST-20); no description text, no paths, no stub
   names, no stderr. The inherited environment is counted, never quoted.

## Facts the code depends on (dated — re-verify against a live CLI)

Read off CLI 2.1.268 on 2026-10-01 without a model call (`--help` output and
`plugin list`), and from skill-creator's `run_eval.py`; **not yet confirmed on a live
run** — that is ST-12.

- `claude plugin list --json` prints `[{ id, version, scope, enabled, installPath, … }]`;
  `claude plugin disable|enable <id> --scope <scope>` exist.
- `claude auth status` prints JSON by default with `loggedIn`.
- `--no-session-persistence` and `--include-partial-messages` exist and work with `-p`.
- The `init` event carries `slash_commands` (and `skills`, `model`, `mcp_servers` — the last
  unverified, read as a count and `null` when absent); project commands
  appear there by bare name. If the stub never appears, every run is an `error` — loud,
  not wrong.
- Partial events: `stream_event` wrapping `content_block_start` (tool_use with `name`),
  `content_block_delta` (`input_json_delta.partial_json`), `content_block_stop`,
  `message_stop`.

## Verifying a change

```bash
npm test               # check + node --test, against the fake claude
npm run backlog        # BACKLOG.md lints, ROADMAP.md is in step
npm run build:site     # site/dist/index.html from README.md
npm pack --dry-run     # bin/, README, CHANGELOG, LICENSE — nothing else
```

**Never run the real `claude` against a model from the tests.** The helpers put
`test/fake` first on a PATH that holds only it, node's directory and the system bins.
A new behaviour of the CLI gets a new `FAKE_CLAUDE_*` mode first, then a test, then the
code.

## Conventions

- `check` enforces what this file states: version/CHANGELOG agreement, `[Unreleased]`,
  Breaking-first, release notes from the CHANGELOG, no runtime dependency, the README
  naming each trap by the phrase in `bin/lib/traps.mjs`, and no tracked file carrying a
  home-directory path or an email address. A file that must contain those shapes says
  `skilltrigger:allow-private-shapes` on a line of its own.
- Backlog items are `ST-n` in `BACKLOG.md`; regenerate `ROADMAP.md` in the same commit.
  Shipped and unreleased is `ver=main`.
- The site has no prose of its own: edit the README and rebuild.
- English, British-leaning spelling, em-dashes, no marketing filler, no decorative emoji.
- Never publish a private name, path, host or address — in files, commit messages or
  generated reports.
