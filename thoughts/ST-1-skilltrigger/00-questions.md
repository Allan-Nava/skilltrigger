# 00 · Questions — ST-1 Skill trigger rates you can trust

**Written against:** `56d297b`

The default assumption is what makes this phase non-blocking: work can proceed
without waiting for answers, and the assumptions are on the record.

---

## Ticket

**ID:** ST-1
**Link:** `BACKLOG.md` (item ST-1, milestone v0.1.0 "One honest number"); brief at
`thoughts/ST-1-skilltrigger/00-brief.md`
**Title:** skilltrigger — skill trigger rates you can trust

Measure how often a Claude Code skill's `description` makes the model load it, on
should-trigger prompts and on near-misses, and refuse to report a number that one of six
known traps has emptied of meaning (parallel workers, a shadowing plugin, an outdated
CLI, an expired login, a machine that sleeps, a moving skill roster). Done when:
`preflight` runs six gates and exits 2 on a failure; `run` refuses on a failed gate,
runs serially in a fresh temporary project per run, scores four outcomes and says no
verdict (exit 3) past 10% timeouts and errors; the report carries date, CLI version,
model, roster size, runs per query, timeout, every outcome and the totals, and nothing
else; `compare` warns on a model, CLI or roster difference and calls ±1 per query at two
runs noise; and the first real measurement — qrspi's three skills with its
`evals/trigger/*.json` — is recorded, dated, beside the 2026-09-18 numbers in qrspi's
CONTRIBUTING. That measurement is the gate on 0.1.0.

State at `56d297b`: ST-2 to ST-10 are built as 0.0.1 and ticked `ver=main` in
`BACKLOG.md:41-78`, every behaviour proven only against `test/fake/claude`. Open on the
milestone: ST-11 (the measurement, `BACKLOG.md:79-85`), ST-12 (stream shapes against a
live CLI, `BACKLOG.md:86-92`), ST-13 (first publish, `BACKLOG.md:93-96`). The questions
below are the decisions the code has already taken implicitly and that the first live
run will either confirm or break.

---

## Questions

### Q1 · What happens when the first live run disagrees with the stream shapes the detector assumes — fix before ST-11, or measure and fix on failure?

- **Grounding:** the shapes were read off CLI 2.1.268's `--help` and skill-creator's
  harness, never off a live run (`CLAUDE.md:66-81`). Three load-bearing assumptions:
  the `init` event lists project commands in `slash_commands` by bare name
  (`bin/lib/stream.mjs:50` strips a leading `/` and keeps the part after the last `:`);
  an expired token or API error arrives as an `assistant` message with
  `model: '<synthetic>'` or matching `ERROR_TEXT` (`bin/lib/stream.mjs:20`, `:81`); and
  partial events are `stream_event` wrapping `content_block_start/delta/stop` and
  `message_stop` (`bin/lib/stream.mjs:55-75`). The fake reproduces exactly these
  (`test/fake/claude:75-99`, `:148-157`), so the suite cannot catch a mismatch. The
  local CLI is likely newer than 2.1.268 — the harness ships weekly.
- **Options:** (a) ST-12 as its own step before ST-11: a handful of live runs, one per
  shape (trigger, miss, other tool, ToolSearch-first, a deliberately bad `--model`),
  events captured to a scratch directory outside the repository, each confirmed shape
  turned into a `FAKE_CLAUDE_*` mode or fixture with paths and description stripped,
  then ST-11; (b) run ST-11 directly and repair on the first no-verdict; (c) a
  permanent `skilltrigger probe` subcommand that does (a) on any machine.
- **Risk if unresolved:** a bare-name mismatch turns every run into `error` — loud, a
  no-verdict rather than a wrong number, but the 126 runs of ST-11 are spent for
  nothing; a missed error shape is worse — it scores as `not-triggered`, the very trap
  4 the tool exists for. Option (b) also leaves the confirmed shapes undocumented
  against a version.
- **Default assumption:** (a). `CLAUDE.md:92-95` already says a new CLI behaviour gets a
  fake mode first, then a test, then the code; ST-12 records the CLI version it was
  confirmed on, and the dated facts block in `CLAUDE.md` is updated with it. No raw
  capture is committed — it carries the stub path and the description.
- **Answer:** _(to be filled — human)_

### Q2 · What must the v0.1.0 measurement show to pass the gate — any honest verdict, or agreement with the 2026-09-18 numbers?

- **Grounding:** the gate is ST-11 (`BACKLOG.md:32-36`, `:79-85`). The 2026-09-18 table
  in qrspi's CONTRIBUTING was taken with skill-creator's harness at one worker, model
  `claude-fable-5-1`, CLI 2.1.268, 83 visible skills, two runs per query, 18 positive
  and 22 negative runs per skill. Today qrspi's sets hold 20, 22 and 21 queries
  (`handoff`, `qrspi`, `token-efficiency`), nine positives each — so the positives are
  comparable in count and the negatives are not. skilltrigger's trigger rule also
  differs from skill-creator's by "its one shortcut" (`bin/lib/stream.mjs:11-13`), and
  with no `--model` the report records whatever the CLI defaults to now
  (`bin/lib/gates.mjs:149`).
- **Options:** (a) the gate is three verdicts (`ok`, exit 0) recorded with date, CLI,
  model and roster — any numbers; (b) (a) and agreement with 2026-09-18 within noise
  (±2 hits per total) on the positives, or a written explanation for each difference;
  (c) (a) plus a same-day skill-creator run at one worker on one skill as a
  cross-check, so a difference is attributed to the tool or to the environment; and,
  independently, the model: pinned to `claude-fable-5-1` for comparability, or the CLI
  default, recorded.
- **Risk if unresolved:** the release can be argued either way after the fact. A gate
  that demands agreement may never pass because the roster has moved since
  2026-09-18 (`BACKLOG.md:84-85` expects a difference); a gate that demands nothing
  proves only that the tool ran.
- **Default assumption:** (a), with `--model claude-fable-5-1` if the CLI still serves
  it (else the default, and the change of model stated beside the numbers), and the
  positives set beside the 2026-09-18 column with the roster sizes of both days. (c) is
  worth one skill's cost if the numbers diverge by more than noise, not by default.
- **Answer:** _(to be filled — human)_

### Q3 · When the conflict gate cannot read `claude plugin list`, does it fail, warn, or trust the roster cross-check?

- **Grounding:** `bin/lib/gates.mjs:91-97` falls back to the human form only when
  `--json` exits non-zero *and* parsed nothing. `parsePluginList` reads JSON only when
  the text starts with `[` (`bin/lib/plugins.mjs:22`); an envelope such as
  `{ "plugins": [...] }` exiting 0 drops into the human parser, which wants a
  `name@marketplace` line (`bin/lib/plugins.mjs:31`), yields `[]`, and the gate reports
  `ok … (0 enabled plugin(s) checked)` (`bin/lib/gates.mjs:101`). A missing `enabled`
  field reads as enabled (`bin/lib/plugins.mjs:24`) — the safe side. Matching is by
  exact name only (`bin/lib/plugins.mjs:73`, `:78`); the roster cross-check
  (`bin/lib/plugins.mjs:75-84`) is the backstop, and it depends on the Q1 shapes.
- **Options:** (a) non-empty output that parses to zero plugins is a `fail` ("cannot
  tell which plugins are enabled"), with the raw first line in the detail; (b) a
  `warn`, the roster cross-check carrying the gate; (c) as now.
- **Risk if unresolved:** a silent `ok` here is trap 2 exactly — the real `qrspi:handoff`
  loads, the stub is never invoked, and the rate reads zero. The per-run
  stub-in-roster check does not catch this: the stub *is* in the roster, it simply
  loses.
- **Default assumption:** (a). A gate that cannot see its input must not pass; the JSON
  shape is confirmed in ST-12 alongside Q1. Same-name matching stays as it is for
  v0.1.0 — a competitor under another name is the roster's effect (Q7), not a conflict.
- **Answer:** _(to be filled — human)_

### Q4 · How does a run on qrspi's skills get the plugin out of the way and back — printed and done by hand, done by skilltrigger, or overridden per process?

- **Grounding:** the gate prints `claude plugin disable|enable <id> --scope <scope>`
  and runs neither (`bin/lib/gates.mjs:102-108`, `bin/lib/plugins.mjs:88-94`,
  `CLAUDE.md:61-62`); the brief puts running them out of scope. ST-11 says "the plugin
  disabled as the conflict gate instructs" (`BACKLOG.md:82`). Disabling at user scope
  removes the plugin from every session on the machine for the duration of three runs.
  Once disabled, the plugin no longer appears as a conflict (`bin/lib/plugins.mjs:72`
  skips disabled plugins), so nothing in skilltrigger can remind the user to re-enable
  it. A skill installed by copy into the user's skills directory has no command at all
  — the gate says "move aside" (`bin/lib/gates.mjs:106`).
- **Options:** (a) as now — printed, done by hand once before the three runs and undone
  after; (b) a `--disable-conflicts` flag that runs the disable, restores it in a
  `finally` and a SIGINT/SIGTERM handler, and records it — which breaks "nothing under
  `~/.claude` is written" (`CLAUDE.md:58-60`) through the CLI; (c) a per-process
  override that touches no user state — whether a settings override passed to each
  `claude -p` can disable one plugin for that process alone is unverified at 2.1.268
  and would have to be confirmed in ST-12; (d) (a) plus a reminder: a disabled plugin
  that carries the skill is listed by the gate as information, and the run ends by
  printing its `enable` command.
- **Risk if unresolved:** a plugin left disabled after the run is a silent change to the
  maintainer's environment; a crash mid-run under (b) is worse. A run on a measured
  description with the plugin half-restored would also change the roster between the
  three skills.
- **Default assumption:** (a) + (d) for v0.1.0 — the brief's scope and the write rule
  hold, and the reminder costs one line. (c), if ST-12 confirms the mechanism, becomes
  a v0.2.0 item; (b) is refused.
- **Answer:** _(to be filled — human)_

### Q5 · Is the thing measured a skill's description presented as a project command named `{skill}-stub-{8 hex}` — and is that close enough to the real skill?

- **Grounding:** `bin/lib/runner.mjs:25-33` writes the stub to `.claude/commands/` with a
  `description`-only frontmatter (`bin/lib/runner.mjs:20-23`) and the name
  `{skill}-stub-{8 hex}` (`:27`). The real skill is a `SKILL.md` with `name` and
  `description`, listed in the init event under `skills`, and for a plugin under a
  `plugin:skill` name; the roster check and the detector look for the stub in
  `slash_commands` only (`bin/lib/stream.mjs:50`). The hash suffix existed in the old
  harness to separate parallel workers' stubs; skilltrigger is serial, and the conflict
  gate already guarantees no same-named entry unless `--allow-conflict`.
- **Options:** (a) keep a command stub with a suffixed name — parity with the harness
  that produced the 2026-09-18 numbers; (b) a skill stub under `.claude/skills/` with
  the real `name`, the roster check moved to `skills`; (c) measure (a) and (b) once in
  ST-12 on one skill and pick; and, for the name, keep the suffix or use the bare skill
  name when no conflict was allowed.
- **Risk if unresolved:** the model reads the name too. If the CLI presents commands
  and skills differently in the listing, or "stub" and a hash in the name nudge the
  model, every number measures a proxy, and a later change of stub form moves the
  numbers with no field in the report to say so.
- **Default assumption:** (a) for v0.1.0, for comparability with 2026-09-18, with the
  stub form recorded in the report (e.g. `stub: "command"`) so `compare` can warn when
  it changes; (c) run once during ST-12 and its result recorded as a dated fact.
- **Answer:** _(to be filled — human)_

### Q6 · Is "the first decisive message" the right definition of a trigger for models that look around before loading?

- **Grounding:** `bin/lib/stream.mjs:6-13` and `README.md:16`. Any text block or any
  non-`ToolSearch` tool makes a message decisive (`bin/lib/stream.mjs:61-62`, `:85-87`);
  at `message_stop`, or at the first `user` event, a decisive message that loaded
  nothing is `not-triggered` (`:38-44`, `:90-94`). A loader anywhere in that message
  counts, even after a Bash call (`test/stream.test.mjs:77-78`). Thinking blocks are
  neutral by omission. qrspi's CONTRIBUTING already names the case this misses:
  "dump the state of this refactor into HANDOFF.md" — the model goes to look first —
  and ST-15 (`BACKLOG.md:107-110`) defers a `needs_context` field to v0.2.0.
- **Options:** (a) as now; (b) "loaded at any point in the turn, within the timeout" —
  closer to real use, slower and dearer (no early kill on an exploring run); (c) (a)
  as the headline, plus a counted-apart `triggered-late` outcome when a later message
  loads the stub before the timeout.
- **Risk if unresolved:** for a model that explores first, (a) systematically
  under-reports positives, and the same description reads differently across models
  for a reason that is not the description. Changing the rule after 0.1.0 breaks
  comparability with every report already written.
- **Default assumption:** (a) for v0.1.0, as the brief decided, with the rule's name
  recorded in the report (e.g. `rule: "first-decisive-message"`) so a later (c) is
  visible to `compare`. (c) belongs with ST-15.
- **Answer:** _(to be filled — human)_

### Q7 · What of the run's environment is recorded, and what does `compare` treat as "the same environment"?

- **Grounding:** the roster is two counts — `slash_commands.length` and `skills.length`
  from a stub-less preflight in an empty directory (`bin/lib/gates.mjs:46-49`, `:85-87`);
  `compare` warns on the counts only (`bin/lib/compare.mjs:10`, `:17`), so two rosters
  of equal size and different members compare as identical. The model is `--model` as
  typed, else the preflight's `init.model` (`bin/lib/gates.mjs:149`): an alias and a
  resolved ID compare as different, and an alias resolving to a new model compares as
  the same. Each run's own `init.model` is collected (`bin/lib/runner.mjs:42-46`) and
  dropped by `summarise` (`bin/lib/report.mjs:41`). Every run inherits the user's whole
  environment minus `CLAUDECODE` (`bin/lib/claude.mjs:12-16`): user memory files,
  settings, hooks and MCP servers all reach the model, and a user-level memory file
  that names the skill or its trigger phrase changes the rate without changing any
  recorded field. The report may carry "queries, counts and versions only"
  (`README.md:71-77`).
- **Options:** for the roster, (a) counts only; (b) counts plus a SHA-256 of the sorted
  entry names — membership without the names, as the description already is
  (`bin/lib/report.mjs:48`); (c) the names. For the model, (i) as typed; (ii) the
  resolved `init.model`, with a warning if runs report different models. For the rest,
  (x) nothing; (y) a fingerprint from the init event where it carries one (tool count,
  MCP server count — fields unverified, ST-12); (z) an isolated configuration with
  only authentication — measures a machine nobody uses, and may break OAuth.
- **Risk if unresolved:** the 2026-09-18 drift was a membership change that happened to
  move the count; the next one may not. A comparison that says "same environment" when
  it is not is the trap 6 failure with a green light on it.
- **Default assumption:** (b) + (ii) + (y). The number is a property of the environment
  (`bin/lib/compare.mjs:1-5`), so record more of it rather than sanitise it away;
  hashes keep private skill names out of a report that may be pasted into an issue.
- **Answer:** _(to be filled — human)_

### Q8 · Is "more than 10% of all runs" the right no-verdict rule when the bad runs cluster on one side?

- **Grounding:** `bin/lib/report.mjs:11`, `:33-34` judge the share over executed runs;
  `bin/lib/runner.mjs:68-71` stops once bad runs pass 10% of the *plan*. A timed-out or
  failed run leaves the denominator (`bin/lib/report.mjs:22-23`,
  `test/run.test.mjs:101-102`), and a query with no measured run gets `pass: null`
  (`:24`) while the verdict stands. On qrspi's sets, 40 to 44 runs per skill allow four
  bad runs — two whole positive queries can vanish and the report still reads `ok`,
  with the positives' denominator shrunk from 18 to 14.
- **Options:** (a) as now — the denominators in the headline show the loss; (b) 10% per
  class, positives and negatives separately; (c) (a) plus no verdict when any query has
  zero measured runs; (d) count a timeout on a positive as a miss — refused by the
  brief ("an error is never a miss").
- **Risk if unresolved:** errors that are not random — a positive prompt that makes the
  model explore until the timeout — bias the positive rate upwards while passing the
  gate, and the reader sees a clean verdict.
- **Default assumption:** (a) + (c): the 10% share stays as the brief decided, and a
  query with nothing measured makes the verdict impossible to read query by query, so
  it is no verdict. Cheap, and it closes the clustered case without a second threshold.
- **Answer:** _(to be filled — human)_

### Q9 · Does a fixed 0.5 pass threshold mean what the report implies at two runs per query?

- **Grounding:** `bin/lib/report.mjs:10`, `:24`: a positive passes at rate ≥ 0.5, a
  negative at rate < 0.5. At two runs that is "positive passes on one hit of two,
  negative fails on one hit of two" — lenient on positives, strict on negatives. The
  Markdown prints the rule (`bin/lib/report.mjs:91`) and the per-query pass count
  (`:101`); the headline uses the totals, not the passes (`:68-74`). ST-17 defers
  `--threshold` to v0.2.0 (`BACKLOG.md:113-115`).
- **Options:** (a) keep 0.5 as skill-creator does; (b) strict majority on both sides, so
  a positive needs 2/2 at two runs; (c) keep the field but drop "N of M queries pass"
  from the Markdown at two runs, where it says less than the totals.
- **Risk if unresolved:** "9 of 9 positives pass" can describe a description that loads
  half the time, and a reader of the summary line takes it as a strong result.
- **Default assumption:** (a), for parity with the numbers v0.1.0 sits beside, with the
  asymmetry stated in the Markdown line that prints the threshold.
- **Answer:** _(to be filled — human)_

### Q10 · What does one run cost in tokens and time, and should the report or the command say so?

- **Grounding:** each run is a full `claude -p` start — system prompt, roster, user
  memory — killed at the decision (`bin/lib/claude.mjs:89-95`), so the `result` event
  that carries usage is never reached on a trigger; the partial `message_start` that
  carries the first message's usage is not read anywhere (`bin/lib/stream.mjs:55-76`).
  Per-run `ms` is measured (`bin/lib/runner.mjs:43-46`) and only printed
  (`bin/skilltrigger.mjs:98`). Defaults: 30 s per run (`bin/skilltrigger.mjs:67`),
  120 s for the round trip (`bin/lib/gates.mjs:58`). ST-11 is 40 + 44 + 42 = 126 runs
  plus three preflights; worst case at the timeout about 63 minutes. A model that
  thinks before its first block spends that time inside the timeout, since thinking is
  not decisive.
- **Options:** (a) as now — print the planned count; (b) read usage off
  `message_start` and record totals only (input, cache creation, cache read) plus wall
  time and median decision time in the report; (c) print an estimate before the first
  run and ask for `--yes` above a threshold; (d) raise the default timeout for slower
  default models — breaks parity with 2026-09-18's 30 s.
- **Risk if unresolved:** the drift rule says to re-measure the baseline the same day
  (and ST-14 makes it the default), so cost is a decision input that nobody can see; a
  creeping timeout share caused by thinking latency reads as an environment fault.
- **Default assumption:** (b), totals only, so the report stays counts and versions;
  the 30 s default stays for parity, and the median decision time shows when it gets
  close.
- **Answer:** _(to be filled — human)_

---

## Out of scope

Things the ticket might suggest but that we are **not** doing in this task:

- Parallelism of any kind, including a workers option (`bin/lib/runner.mjs:1-5`).
- Rewriting or suggesting descriptions — the tool measures, the author writes.
- Running `claude plugin disable|enable` from skilltrigger (Q4 keeps it printed).
- The first npm publish and trusted publishing (ST-13).
- v0.2.0: interleaved baseline and rewrite (ST-14), `needs_context` (ST-15), Linux sleep
  inhibition (ST-16), `--threshold` (ST-17).
- Any model call outside the `claude` CLI, telemetry or shared state.

---

## Status

- [x] Questions generated
- [ ] Reviewed by a human (<date>, <who>)
- [ ] Answers collected (or assumptions explicitly accepted)

> Next phase: **Research**. The ticket is **not** passed to Research — only the
> questions and their answers.
