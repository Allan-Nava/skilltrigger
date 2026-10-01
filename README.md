<p align="center"><img src="https://raw.githubusercontent.com/Allan-Nava/skilltrigger/main/assets/logo.svg" width="72" height="72" alt=""></p>

# skilltrigger — skill trigger rates you can trust

**skilltrigger measures how often a Claude Code skill's `description` makes the model load it** — on prompts that should trigger it and on near-misses that should not — and refuses to report a number it cannot trust. Six things have been seen to turn that measurement into a clean-looking zero that means nothing; each one is a gate it must pass first or a field recorded beside the result.

**Status:** 0.0.1, not released. The gate on 0.1.0 is one real measurement: the maintainer runs skilltrigger on the three skills of the [qrspi](https://github.com/Allan-Nava/qrspi) plugin, with their `evals/trigger/*.json` sets, and the result is recorded, dated, beside the 2026-09-18 numbers in qrspi's CONTRIBUTING. Until then every number skilltrigger has produced came from the fake `claude` its tests use.

## What it measures

A skill's description sits in the model's context permanently; the model reads it and decides whether to load the skill. Whether a rewrite helps is an empirical question, and the answer is a pair of rates:

- **positives triggered** — of the runs on prompts that should load the skill, how many did;
- **negatives fired** — of the runs on near-misses that should not, how many loaded it anyway.

Each run is one `claude -p` in a fresh temporary project that holds a single stub command whose frontmatter `description` is the text under test. The stub is **loaded** when the model's first decisive message carries a tool call that names it — `Skill` or `SlashCommand` with the stub's name in its input, or a `Read` of the stub file. A first message that only fetches tool schemas (`ToolSearch`) does not decide; the next one does. Anything else first — a text answer, another tool, another skill — is a run that did **not** trigger. Detection happens on the partial stream events, and the process is stopped at the decision.

Each run ends in one of four outcomes: `triggered`, `not-triggered`, `timeout`, `error`. Only the first two are measurements. A timeout or an error is never counted as "did not trigger", and when more than 10% of the runs are either, there is **no verdict**: the report says so and the command exits 3.

## The six traps

Each was hit in practice, with skill-creator's harness, between 2026-09-09 and 2026-09-18. Each produced a number that looked like a result.

1. **Parallel workers.** The old harness injects one stub per worker, all with the same description and names that differ only by a hash. The model invokes whichever stub it likes, and only the worker whose stub was picked counts the hit — so ten workers, the default, measure about a tenth of the true rate. *skilltrigger is strictly serial and has no workers option*; `--workers` is rejected as an unknown option rather than ignored. A detected run ends in seconds; serial is fast enough.
2. **An installed plugin shadowing the stub.** If a plugin that carries a skill of the same name is enabled, the model loads the real skill and the stub is never seen: the rate reads zero. *The conflict gate* reads `claude plugin list --json`, looks for the skill's `name` among each enabled plugin's skills, and cross-checks the roster the model actually sees for a same-named entry. On a hit it refuses and prints the exact `claude plugin disable …` and `claude plugin enable …` commands, scope included — and runs neither. A list it cannot read is not an empty list: output in a shape it does not know — not a JSON array, not the human form an older CLI prints, not a line saying no plugins are installed — fails the gate with the first line of what it got, because "which plugins are enabled" is then unknown. `--allow-conflict` measures anyway and records in the report that it did. Independently, every run checks that the stub is in the roster its `init` event lists; a run where it is not is an `error`.
3. **An outdated CLI.** An old `claude` answers 400 for a model it does not know, and the old harness scored that as "did not trigger". *The round-trip gate* runs `claude -p "Reply with exactly: pong"` with the chosen `--model` and requires the answer `pong`; the CLI version is recorded in the report, and in every run an API error line is an `error`.
4. **An expired login.** An expired OAuth session makes every `claude -p` answer "Failed to authenticate", and a harness that discards stderr scores all forty runs as misses: 0/18 positives and 0/22 negatives, which is not a measurement. *The auth gate* requires `claude auth status` to say logged in, and the round trip catches the expired token that `auth status` can miss. In a run, an authentication failure is an `error`, never a miss.
5. **A machine that sleeps.** Each run has a timeout, and a laptop that sleeps mid-eval turns runs into timeouts — once 5/18 for a description measured 17/18 a week earlier. *The sleep gate* starts `caffeinate -i -s -w <pid>` on macOS, which holds off idle and system sleep until skilltrigger exits; elsewhere it prints a warning and the advice. Timeouts are counted apart, and they count towards the no-verdict rule.
6. **The skill roster changing the number.** The stub competes with every other description the model can see. A byte-identical description measured 17/18 one week and 10/18 the next because a synced folder had added 24 skills to the machine, from 59 to 83. *The roster gate* reads the `init` event of a stub-less `claude -p --output-format stream-json --verbose` and records how many slash commands and skills the model sees, and `compare` warns when two reports differ in roster, model or CLI version.

## Install

skilltrigger needs Node 18 or later and a logged-in [Claude Code](https://code.claude.com/docs) CLI on `PATH`. It has no runtime dependencies.

Not yet on npm. From a checkout:

```bash
git clone https://github.com/Allan-Nava/skilltrigger && cd skilltrigger
node bin/skilltrigger.mjs preflight
```

Once 0.1.0 is published: `npx skilltrigger preflight`, or `npm install -g skilltrigger`.

## Usage

```bash
skilltrigger preflight [--model M] [--skill <dir>] [--allow-conflict]
skilltrigger run --skill <dir> --eval <file> [--runs 2] [--model M] [--timeout 30] \
                 [--description "<override>"] [--out <dir>] [--allow-conflict]
skilltrigger compare <a.json> <b.json>
skilltrigger check
```

`preflight` runs every gate and prints each as `ok`, `warn`, `fail` or `skip`, with the reason and, for anything not ok, the fix. It exits 2 on any failure. Without `--skill` it has no name to look for, so the conflict gate only lists the enabled plugins.

`run` runs the preflight first and refuses on a failure, then runs every query `--runs` times (default 2), round-robin, serially, with a `--timeout` in seconds per run (default 30). `--description` measures an override instead of the text in `SKILL.md`, so a rewrite can be tried without editing the skill. Reports go to `--out` (default `./skilltrigger-results`). Exit codes: 0 a verdict, 1 a usage or input error, 2 a failed gate, 3 no verdict.

The eval set is skill-creator's format — a JSON array of `{ "query": string, "should_trigger": boolean }` — and any other field, a `note` for instance, is carried through to the report:

```json
[
  { "query": "summarise this session into HANDOFF.md before I clear it", "should_trigger": true },
  { "query": "why is cache_read_input_tokens 0 on every call", "should_trigger": false, "note": "the neighbouring skill's territory" }
]
```

`compare` sets two reports side by side: per query and in total, over the queries both share. It warns first when the model, the CLI version or the roster size differ, because the number is a property of the text *and* the roster. Two runs per query resolve to ±1 per query, so a difference of one hit at two runs is labelled noise, and so is a total difference of up to two.

To judge a rewrite, measure the baseline the same day, in the same environment, then the rewrite with `--description`, and compare the two.

## The report

Each run writes `<out>/<date>-<skill>.json` and a Markdown rendering beside it (a second report the same day gets `-2`). It holds the date, the skilltrigger and CLI versions, the model, the roster size, runs per query, the timeout, the pass threshold (a trigger rate of 0.5) and the no-verdict threshold (10%), each query with every outcome and its hits/runs, and the totals — positives triggered, negatives fired, timeouts and errors counted apart.

Nothing else is in it: no description text (a byte count and a SHA-256 stand in for it, so `compare` can tell two texts apart), no paths, no stub names, no stderr. A report can be committed or pasted into an issue as it is.

## What it never does

- **It never touches `~/.claude`.** Every run happens in its own temporary directory, removed afterwards; nothing is written under the user's configuration, and every `claude -p` gets `--no-session-persistence`, so the runs are not saved as sessions either. The conflict gate reads a plugin's install directory and writes nothing there.
- **It never runs in parallel.** See the first trap.
- **It never reports a number through a failed gate.** A failed gate refuses the run; more than 10% of runs timing out or failing is no verdict, and the run stops as soon as that share is passed, because every further run would be spent on a number that will not be reported.
- **It never disables a plugin itself.** It prints the commands.
- It never sends anything anywhere but through the `claude` CLI it is measuring with.

## Design notes

**Why the first decisive message.** A skill is useful when the model loads it before doing the work. A model that goes exploring first and loads the skill three tool calls later has, for the purpose of a description, missed — and an open-ended wait would turn every such run into a timeout. skill-creator stops at the first tool call of any other kind; skilltrigger reads the whole first message, so a `Bash` call listed before the `Skill` call in the same message still counts as a load.

**A known limit of the method.** `claude -p` starts from nothing, so a positive that presupposes session history — "dump the state of this refactor" — measures whether the model loads the skill *before* going to look for the material. In a real session the material is already in context. Annotate such prompts in the eval set rather than dropping them, so the number stays honest about what it covers.

**Why exit 3 is not a failure of the description.** No verdict means the environment broke, not that the text is bad. The report is still written, so the outcomes can be read, and it says at the top that they are not a measurement.

## Prior art

The mechanism — a stub command carrying the description, `claude -p --output-format stream-json --include-partial-messages`, and early detection from the stream events — comes from `scripts/run_eval.py` in the `skill-creator` skill of [Anthropic's skills repository](https://github.com/anthropics/skills), Apache-2.0. skilltrigger is a separate implementation that copies no code from it, reads the same eval-set format, and adds the gates, the four outcomes and the no-verdict rule. The six traps are documented, with the numbers above, in [qrspi's CONTRIBUTING](https://github.com/Allan-Nava/qrspi/blob/main/CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
