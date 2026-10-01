# ST-1 — Brief: skill trigger rates you can trust

**Repository:** https://github.com/Allan-Nava/skilltrigger · **Ticket:** ST-1 in `BACKLOG.md`
**Date:** 2026-10-01 · **Author:** Allan Nava, with Claude

## Goal

A skill's `description` is the only thing the model reads before deciding to load it,
so a rewrite is judged by a measurement: how often it loads on prompts that should
trigger it, how often on near-misses that should not. The existing harness —
skill-creator's `scripts/run_eval.py` — gives a clean-looking zero that means nothing
in six documented situations: parallel workers dividing the rate, an installed plugin
shadowing the stub, an outdated CLI, an expired login scored as forty misses, a machine
that sleeps, and the skill roster moving a byte-identical description from 18/18 to
10/18. skilltrigger makes each of those a gate or a recorded field, and refuses to
report a number it cannot trust.

## Done when

- `skilltrigger preflight` runs six gates — cli, auth, round trip, conflict, sleep,
  roster — prints each with its reason and fix, exits 2 on any failure.
- `skilltrigger run` refuses on a failed gate, runs strictly serially in a fresh
  temporary project per run, scores four outcomes, and says **no verdict** (exit 3)
  when more than 10% of runs time out or fail.
- The report carries date, CLI version, model, roster size, runs per query, timeout,
  every outcome per query and the totals — and nothing else.
- `skilltrigger compare` warns when model, CLI version or roster differ, and calls ±1
  per query at two runs noise.
- The first real measurement — qrspi's three skills, its `evals/trigger/*.json` — is
  recorded, dated, beside the 2026-09-18 numbers in qrspi's CONTRIBUTING. This is the
  gate on 0.1.0.

## In scope

- The six gates, the serial runner, the stream detector, the verdict rule, the JSON and
  Markdown report, compare, the repository's own check.
- skill-creator's eval-set format, extra fields carried through.
- A fake `claude` that reproduces every gate answer and every run outcome, so the whole
  suite runs with no model.

## Out of scope

- Parallelism of any kind — the first trap is the reason, not an optimisation to add
  later.
- Disabling or re-enabling plugins: printed, never run.
- Rewriting descriptions, or suggesting rewrites: the tool measures; the author writes.
- Any model call outside the `claude` CLI, any telemetry, any shared state.

## Constraints

- Zero runtime dependencies, Node 18+, ESM; `node --test`.
- Nothing written under the user's `~/.claude`; `--no-session-persistence` on every run.
- The tests never reach a model: the fake comes first on a PATH that holds nothing else
  that could be `claude`.

## Decisions taken

- **The first decisive message decides.** A tool call naming the stub (`Skill`,
  `SlashCommand`, a `Read` of the stub file) in it is a trigger; anything else is not.
  `ToolSearch` alone is not decisive. Bounded, and it matches what a description is for.
- **An error is never a miss**, and a run whose `init` event does not list the stub is
  an error — the stub was never seen.
- **Stop at the no-verdict share.** Once timeouts and errors pass 10% of the plan, no
  verdict is possible; further runs are spent for nothing.
- **A hash, not the text.** The report carries the description's SHA-256 and length, so
  compare can tell two texts apart without the report carrying either.

## Assumptions (proceeding this way unless corrected)

- The event shapes the old harness reads, and that CLI 2.1.268's `--help` describes,
  are the ones a live run emits. Confirmed only on the first real run (ST-12).
- Two runs per query is the default, as in the 2026-09-18 measurements; it resolves to
  ±1 per query.
- 0.5 as the per-query pass threshold, as skill-creator uses.

## Open risks

- **The roster check could be too strict.** If a live `init` event names project
  commands differently from what the detector expects, every run becomes an error — no
  verdict, loudly, rather than a wrong number. ST-12 confirms or fixes it.
- **A model that explores before loading** scores as a miss under the first-message
  rule; the eval set should say which positives presuppose session context.
- **The roster is not under skilltrigger's control.** It records it and warns on a
  difference; it cannot make two machines see the same skills.
