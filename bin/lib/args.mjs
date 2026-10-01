// A small argument parser: `util.parseArgs` arrived in Node 18.3 and the floor is 18.0.
//
// spec: { name: 'string' | 'boolean' }. Unknown options are errors, not ignored — a
// `--workers 4` that was silently dropped would look like it had been honoured.

export class UsageError extends Error {}

export function parseArgs(argv, spec) {
  const opts = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    let [name, inline] = a.slice(2).split(/=(.*)/s)
    const type = spec[name]
    if (!type) throw new UsageError(`unknown option --${name}`)
    if (type === 'boolean') {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`)
      opts[name] = true
      continue
    }
    const value = inline ?? argv[++i]
    if (value === undefined || (inline === undefined && value.startsWith('--'))) throw new UsageError(`--${name} needs a value`)
    opts[name] = value
  }
  return { opts, positional }
}

export function number(opts, name, { fallback, min, integer = false }) {
  if (opts[name] === undefined) return fallback
  const n = Number(opts[name])
  if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) throw new UsageError(`--${name} must be ${integer ? 'an integer' : 'a number'} of at least ${min}, got "${opts[name]}"`)
  return n
}
