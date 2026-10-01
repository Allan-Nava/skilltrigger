# Backlog — skilltrigger

Single source of truth for what is planned. Items keep a stable `ST-n` id so commits,
the CHANGELOG, the `thoughts/` artifacts and the issues can reference them. New ideas go
here rather than into scattered TODO comments.

[ROADMAP.md](ROADMAP.md) is a **generated** view of this file, grouped by milestone. Do
not edit it by hand — run `node scripts/backlog.mjs roadmap` after touching this file,
or CI fails. The GitHub issues are another generated view, synced one way on every push
to `main` that changes this file.

## How to write an item

```
## v0.2.0 — Title of the milestone <!-- ms: phase=next -->

- [ ] **ST-99 — Short name**: what it is, why it earns its place, what it needs to
  touch. <!-- st: prio=high size=M labels=runner -->
```

- The **id never changes**; a new item takes the next free number.
- `- [ ]` open, `- [x]` shipped with `ver=x.y.z` (or `ver=main` when merged, unreleased);
  decided against → ticked with `ver=dropped` and the reason in the body.
- Metadata: `prio` (`high|med|low`), `size` (`S|M|L|XL`), `labels` from: `gates`,
  `runner`, `report`, `release`, `docs`, `project`, `tests`, `enhancement`.

## v0.1.0 — One honest number <!-- ms: phase=now -->

The first release: the gates, the serial runner, the verdict rule and the report, as
built in 0.0.1 against a fake `claude`, and then used once for real.

**The measurement is the gate on this milestone.** No `skilltrigger--v0.1.0` before the
maintainer has run skilltrigger on the three skills of the qrspi plugin — `qrspi`,
`handoff`, `token-efficiency`, with their `evals/trigger/*.json` sets — and the result
is recorded, dated, beside the 2026-09-18 numbers in qrspi's CONTRIBUTING, with the CLI
version, the model and the roster size.

- [x] **ST-1 — The brief**: `thoughts/ST-1-skilltrigger/00-brief.md` — what is measured,
  the six traps, what is in and out of scope, the decisions taken and the open risks.
  <!-- st: prio=high size=S labels=project,docs ver=main -->
- [x] **ST-2 — Gates: cli, auth, round trip**: `claude` on PATH with its version
  recorded; `claude auth status` logged in; `claude -p "Reply with exactly: pong"` with
  the chosen model answers pong, which catches the expired token `auth status` can miss
  and the 400 an outdated CLI answers for an unknown model.
  <!-- st: prio=high size=M labels=gates ver=main -->
- [x] **ST-3 — Gate: plugin conflict**: `claude plugin list --json` (the human form as a
  fallback), the skills of each enabled plugin read off its install path, the roster
  cross-checked for a same-named entry; refuses and prints the disable and enable
  commands with their scope, never runs them; `--allow-conflict` records the conflict
  in the report. <!-- st: prio=high size=M labels=gates ver=main -->
- [x] **ST-4 — Gate: sleep**: `caffeinate -i -s -w <pid>` on macOS for the life of the
  process; a warning with the advice elsewhere.
  <!-- st: prio=med size=S labels=gates ver=main -->
- [x] **ST-5 — Gate: roster**: the `init` event of a stub-less `claude -p
  --output-format stream-json --verbose`, run in an empty temporary project, gives the
  slash-command and skill counts recorded in every report.
  <!-- st: prio=high size=S labels=gates ver=main -->
- [x] **ST-6 — The serial runner and the stream detector**: one temporary project and
  one stub per run, removed afterwards; the environment minus `CLAUDECODE`;
  `--no-session-persistence`; detection from the partial events at the first decisive
  message, the process group stopped there; four outcomes, an auth or API error never a
  miss, a run whose `init` event lacks the stub an error.
  <!-- st: prio=high size=L labels=runner ver=main -->
- [x] **ST-7 — The verdict rule and the report**: more than 10% timeouts and errors is
  no verdict, exit 3, the run stopped as soon as the share is passed; JSON and
  Markdown carrying queries, counts and versions only.
  <!-- st: prio=high size=M labels=report ver=main -->
- [x] **ST-8 — compare**: per query and total differences over the shared queries; a
  warning when model, CLI version or roster differ; ±1 per query at two runs is noise.
  <!-- st: prio=med size=S labels=report ver=main -->
- [x] **ST-9 — The fake claude and the tests**: a Node script first on PATH, driven by
  environment variables, answering every gate and producing every run outcome; tests
  for each gate, outcome, the no-verdict rule, compare's warning and the temporary
  directory's removal. <!-- st: prio=high size=M labels=tests ver=main -->
- [x] **ST-10 — The repository**: `skilltrigger check`, CI on Node 18/20/22/24 with
  `pack` and `backlog` jobs, the release workflow over OIDC with the CHANGELOG section
  at the top of the notes, release drift, Pages, CodeQL, the backlog issue sync, the
  site, the mark. <!-- st: prio=med size=M labels=project,release ver=main -->
- [ ] **ST-11 — The first real measurement: qrspi's three skills**: the gate on this
  milestone. Run `skilltrigger run` on `qrspi`, `handoff` and `token-efficiency` with
  qrspi's `evals/trigger/*.json`, two runs per query, the plugin disabled as the conflict
  gate instructs; record the three results, dated, with CLI version, model and roster,
  beside the 2026-09-18 table in qrspi's CONTRIBUTING, and the same line in this README's
  status. A difference from the 2026-09-18 numbers is expected if the roster moved — the
  report says by how much. <!-- st: prio=high size=M labels=report,docs -->
- [ ] **ST-12 — Check the stream shapes against a live CLI**: the detector was written
  against the event shapes the old harness reads and the fake reproduces. Confirm on the
  first real run that the `init` event lists project commands in `slash_commands` by bare
  name (or the stub-in-roster check turns every run into an error), that an expired
  token arrives as the synthetic message the detector flags, and that `skills` is
  present; record the CLI version it was confirmed on.
  <!-- st: prio=high size=S labels=runner,tests -->
- [ ] **ST-13 — First publish by hand, then trusted publishing**: npm cannot configure a
  trusted publisher for a package that does not exist, so 0.1.0 goes up by hand
  (`npm publish --access public`), then the publisher is bound to `release.yml`; every
  later version is a tag. <!-- st: prio=med size=S labels=release -->

- [x] **ST-18 — The conflict gate passes when it cannot read the plugin list**: found by
  the ST-1 Questions phase, 2026-10-01. When `claude plugin list --json` exits 0 with output
  `parsePluginList` cannot read, the list is empty and the gate says `ok` with zero plugins
  checked (`bin/lib/gates.mjs`, `bin/lib/plugins.mjs`) — the very false pass the tool exists
  to refuse. An unparseable list must fail the gate, with the raw shape's first line in the
  reason; add the fake-CLI case. Done 2026-10-01: `parsePluginList` answers `null` for a
  shape it does not know and `[]` only for an empty JSON array or a human form saying no
  plugins; the gate fails on `null` with the first line, truncated; four new fake modes.
  <!-- st: prio=high size=S labels=gates,tests ver=main -->
- [x] **ST-19 — A verdict survives losing whole positive queries**: two positive queries can
  lose every run to timeouts or errors and the report still gives a verdict, because the 10%
  rule counts runs, not queries (`bin/lib/report.mjs`). No verdict when any query lost all its
  runs, or say which queries the number leaves out. Done 2026-10-01: both — a query with
  every run lost is no verdict, exit 3, named in the headline and in `lostQueries`; one
  that lost only some runs keeps the verdict and is flagged in `partialQueries`.
  <!-- st: prio=med size=S labels=report ver=main -->
- [ ] **ST-20 — The report records less than compare needs**: `compare` checks the roster by
  its count, so two rosters of the same size with different members look identical; each
  run's model is collected and dropped (`bin/lib/runner.mjs`); the environment every run
  inherits — memory files, hooks, MCP servers — is not recorded at all. Record the roster's
  members (names only), the per-run model, and a summary of what the environment contributed.
  <!-- st: prio=med size=M labels=report -->
- [ ] **ST-21 — Nothing reminds the user to re-enable a plugin**: once a conflicting plugin is
  disabled it is no longer a conflict, so neither `preflight` nor `run` mentions it again.
  Remember the toggle the gate printed and print the re-enable command at the end of a run.
  <!-- st: prio=med size=S labels=gates -->

## v0.2.0 — Same day, same roster <!-- ms: phase=next -->

The drift rule — re-measure the baseline the same day, in the same environment — is
advice in 0.1.0. This milestone makes it the default way to judge a rewrite.

- [ ] **ST-14 — Baseline and rewrite in one invocation**: `run --baseline-description`
  measures the old text and the new one interleaved, run by run, in one preflight, so
  both numbers share the day, the CLI, the model and the roster by construction, and the
  report carries both. <!-- st: prio=high size=M labels=runner,report,enhancement -->
- [ ] **ST-15 — Prompts that presuppose a session**: an eval-set field (`needs_context`)
  for positives that assume material already in context, reported apart, so the known
  limit of `claude -p` is a column rather than a footnote.
  <!-- st: prio=med size=S labels=report,enhancement -->
- [ ] **ST-16 — Sleep inhibition on Linux**: wrap the run in `systemd-inhibit` when it
  is available instead of only warning. <!-- st: prio=low size=S labels=gates,enhancement -->
- [ ] **ST-17 — A pass-threshold option**: `--threshold` for the per-query rate (0.5
  today), recorded in the report as it already is.
  <!-- st: prio=low size=S labels=report,enhancement -->
