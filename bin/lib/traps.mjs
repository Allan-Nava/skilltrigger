// The six ways the old measurement returned a clean-looking zero that meant nothing,
// each with the phrase the README must use for it (`check` holds it to that) and what
// skilltrigger does about it. The first five were hit in practice between 2026-09-09
// and 2026-09-18; the sixth is the drift note — the roster changing the number.
export const TRAPS = [
  { id: 'parallel', phrase: 'Parallel workers', handled: 'strictly serial runner; no workers option' },
  { id: 'shadowing', phrase: 'An installed plugin shadowing the stub', handled: 'conflict gate: refuses, prints disable/enable commands' },
  { id: 'outdated', phrase: 'An outdated CLI', handled: 'round-trip gate with the chosen model; version recorded' },
  { id: 'login', phrase: 'An expired login', handled: 'auth gate, round-trip gate, auth errors are errors' },
  { id: 'sleep', phrase: 'A machine that sleeps', handled: 'sleep gate: caffeinate on macOS, warning elsewhere; timeouts counted apart' },
  { id: 'roster', phrase: 'The skill roster', handled: 'roster gate records it; compare warns when it differs' },
]
