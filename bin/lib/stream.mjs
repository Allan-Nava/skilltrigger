// Reading one run's stream. `claude -p --output-format stream-json --verbose
// --include-partial-messages` prints one JSON event per line: a `system`/`init` event
// with the roster, `stream_event`s wrapping the API's own streaming events, complete
// `assistant` and `user` messages, and a final `result`.
//
// The definition of a trigger, which the README states in the same words: the stub is
// loaded when the model's FIRST decisive message carries a tool call that names it —
// `Skill` or `SlashCommand` with the stub's name in its input, or `Read` of the stub
// file. A first message that only fetches tool schemas (`ToolSearch`) is not decisive;
// the next one is. Anything else in the first decisive message — a text answer,
// another tool, another skill — is `not-triggered`. That is skill-creator's rule too,
// minus its one shortcut: it stopped at the first tool of any other kind, so a Bash
// call listed before the Skill call in the same message counted as a miss.
//
// An authentication failure or an API error is an `error`, never `not-triggered`:
// that confusion is how an expired login used to read as a clean 0/40.

const LOADERS = new Set(['Skill', 'SlashCommand', 'Read'])
const NEUTRAL = new Set(['ToolSearch'])
const ERROR_TEXT = /^\s*(?:Failed to authenticate|API Error\b|Invalid API key|OAuth token has expired|Please run \/login|Credit balance is too low)/i

export function createDetector({ stubName, stubPath }) {
  const names = (tool, input) => {
    if (!LOADERS.has(tool)) return false
    const s = typeof input === 'string' ? input : JSON.stringify(input ?? {})
    if (tool === 'Read') return s.includes(stubPath) || s.includes(`${stubName}.md`)
    return s.includes(stubName)
  }
  const state = {
    init: null,
    // Per message: the tool calls seen so far, and whether any of them was decisive.
    blocks: new Map(),
    decisive: false,
    resultSeen: false,
  }
  const done = (outcome, reason) => ({ outcome, reason })

  const endOfMessage = () => {
    // Only a message that did something decides: neutral tools alone keep listening.
    const decisive = state.decisive
    state.blocks.clear()
    state.decisive = false
    return decisive ? done('not-triggered', 'the first decisive message did not load the stub') : null
  }

  function feed(ev) {
    if (!ev || typeof ev !== 'object') return null
    if (ev.type === 'system' && ev.subtype === 'init') {
      state.init = ev
      if (Array.isArray(ev.slash_commands) && !ev.slash_commands.some((c) => String(c).replace(/^\//, '').split(':').pop() === stubName)) {
        return done('error', `the stub ${stubName} is not in the roster the init event lists — the model never saw it`)
      }
      return null
    }
    if (ev.type === 'stream_event') {
      const se = ev.event ?? {}
      if (se.type === 'content_block_start') {
        const cb = se.content_block ?? {}
        if (cb.type === 'tool_use') {
          state.blocks.set(se.index ?? 0, { tool: cb.name, json: '' })
          if (!NEUTRAL.has(cb.name)) state.decisive = true
        } else if (cb.type === 'text') state.decisive = true
      } else if (se.type === 'content_block_delta') {
        const b = state.blocks.get(se.index ?? 0)
        if (b && se.delta?.type === 'input_json_delta') {
          b.json += se.delta.partial_json ?? ''
          if (names(b.tool, b.json)) return done('triggered', `${b.tool} named the stub`)
        }
      } else if (se.type === 'content_block_stop') {
        const b = state.blocks.get(se.index ?? 0)
        if (b && names(b.tool, b.json)) return done('triggered', `${b.tool} named the stub`)
      } else if (se.type === 'message_stop') {
        return endOfMessage()
      }
      return null
    }
    if (ev.type === 'assistant') {
      const msg = ev.message ?? {}
      const content = Array.isArray(msg.content) ? msg.content : []
      const text = content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
      if (ev.error || msg.model === '<synthetic>' || ERROR_TEXT.test(text)) return done('error', firstLine(text) || `assistant error: ${ev.error}`)
      for (const c of content) {
        if (c.type !== 'tool_use') continue
        if (names(c.name, c.input)) return done('triggered', `${c.name} named the stub`)
        if (!NEUTRAL.has(c.name)) state.decisive = true
      }
      if (text) state.decisive = true
      return null
    }
    if (ev.type === 'user') {
      // A tool result means the message that asked for it is over, whether or not a
      // message_stop was streamed for it.
      return endOfMessage()
    }
    if (ev.type === 'result') {
      state.resultSeen = true
      const text = typeof ev.result === 'string' ? ev.result : ''
      if (ev.is_error || (ev.subtype && ev.subtype !== 'success') || ERROR_TEXT.test(text)) return done('error', firstLine(text) || `result: ${ev.subtype}`)
      return done('not-triggered', 'the session ended without loading the stub')
    }
    return null
  }

  function end({ code, stderr = '' } = {}) {
    const why = firstLine(stderr)
    return done('error', `the stream ended without a decision (exit ${code ?? '?'})${why ? `: ${why}` : ''}`)
  }

  return {
    feed,
    end,
    get init() {
      return state.init
    },
  }
}

const firstLine = (s) => String(s ?? '').trim().split('\n')[0].slice(0, 200)

// Newline-delimited JSON from a byte stream: chunks arrive split anywhere, and a line
// that is not JSON (a warning the CLI prints to stdout) is skipped, not fatal.
export function lineSplitter(onEvent) {
  let buf = ''
  const emit = (line) => {
    const t = line.trim()
    if (!t) return
    let ev
    try {
      ev = JSON.parse(t)
    } catch {
      return
    }
    onEvent(ev)
  }
  return {
    push(chunk) {
      buf += chunk
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        emit(line)
      }
    },
    end() {
      if (buf) emit(buf)
      buf = ''
    },
  }
}
