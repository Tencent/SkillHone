import { extname } from 'node:path'

const sensitiveName = '(?:api[_-]?key|token|secret|password|authorization)'
const assignment = new RegExp(`\\b([A-Za-z_$][\\w$.-]*${sensitiveName}|${sensitiveName})["']?[ \\t]*(?::|=(?!=|>))[ \\t]*`, 'gi')
const signature = /(?:^|[^A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})/
const codeFile = /\.(?:[cm]?[jt]sx?|py)$/i

function placeholder(value: string): boolean {
  return /^(?:<[^<>\n]+>|\[[A-Z_][A-Z0-9_-]*\]|\{[A-Za-z_][A-Za-z0-9_]*\})$/.test(value)
    || /^(?:your|example|placeholder|redacted|dummy|changeme|fake|test)(?:[_ -](?:api|key|token|secret|password|credential|credentials|value|here|only|123))*$/i.test(value)
    || /^(?:YOUR|EXAMPLE|PLACEHOLDER|REDACTED|DUMMY|FAKE|TEST)_[A-Z][A-Z0-9_]*$/.test(value)
    || /^(?:your|example|placeholder|dummy|fake|test)(?:[_-][a-z]+)*[_-](?:token|key|secret|password|here)$/i.test(value)
    || /^\{\.[A-Za-z_][A-Za-z0-9_.$\[\]*-]*\}$/.test(value)
    || /^(?:[A-Za-z][A-Za-z0-9_-]*[_-])?(?:x{3,}|\.\.\.|\*)$/i.test(value)
}

// Quotes in regular-expression literals must not change the surrounding string context.
function enclosingQuote(text: string, start: number): string {
  const prefix = text.slice(text.lastIndexOf('\n', start - 1) + 1, start)
  let quote = '', escaped = false, regex = false, characterClass = false, previous = ''
  for (let index = 0; index < prefix.length; index++) {
    const char = prefix[index]!
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (regex) {
      if (char === '[') characterClass = true
      else if (char === ']') characterClass = false
      else if (char === '/' && !characterClass) { regex = false; previous = '/' }
    } else if (quote) {
      if (char === quote) { quote = ''; previous = char }
    } else if (char === '/' && prefix[index + 1] === '/') return '\0'
    else if (char === '/' && (/[=([{,:;!?&|>]/.test(previous) || /(?:return|throw|yield|case)\s*$/.test(prefix.slice(Math.max(0, index - 10), index)))) regex = true
    else if (char === '"' || char === "'" || char === '`') quote = char
    else if (!/\s/.test(char)) previous = char
  }
  return quote
}

function expression(text: string, start: number): string {
  const enclosing = enclosingQuote(text, start)
  let quote = '', escaped = false
  const stack: string[] = []
  let end = start
  for (; end < text.length; end++) {
    const char = text[end]!
    if (!quote && enclosing && char === enclosing) break
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '(' || char === '[' || char === '{') stack.push(char)
    else if (char === ')' || char === ']' || char === '}') {
      if (!stack.length) break
      stack.pop()
    } else if (!stack.length && (char === ',' || char === ';' || char === '\n' || char === '\r')) break
  }
  return text.slice(start, end).trim()
}

function shellReferences(value: string): { rest: string; secretDefault: boolean } {
  let result = '', secretDefault = false
  for (let i = 0; i < value.length;) {
    if (value.slice(i, i + 2) === '${') {
      let depth = 1, end = i + 2
      for (; end < value.length && depth; end++) {
        if (value.slice(end, end + 2) === '${') { depth++; end++ }
        else if (value[end] === '}') depth--
      }
      if (depth) { result += value.slice(i); break }
      const body = value.slice(i + 2, end - 1)
      const match = body.match(/^[A-Za-z_][A-Za-z0-9_]*(?:(:?[-=?+])(.*))?$/s)
      if (!match) secretDefault ||= valueContainsCredential(body, true)
      else if (match[1] && !match[1].endsWith('?')) {
        const nested = shellReferences(match[2] ?? '')
        secretDefault ||= nested.secretDefault || literal(nested.rest)
      }
      i = end
    } else {
      const variable = value.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*/)
      if (variable) i += variable[0].length
      else result += value[i++]
    }
  }
  return { rest: result, secretDefault }
}

function literal(raw: string): boolean {
  let value = raw.trim().replace(/\\n$/, '')
  if (!value || placeholder(value)) return false
  if (/^(?:process\.env|os\.environ)(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]]+\])$/.test(value)) return false
  if (/^(?:~\/|\.{1,2}\/|\/(?!\/))/.test(value)) return false
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.password && !placeholder(decodeURIComponent(url.password))) return true
      if (url.username && literal(decodeURIComponent(url.username))) return true
      for (const [key, candidate] of url.searchParams) if (new RegExp(sensitiveName, 'i').test(key) && literal(candidate)) return true
      return false
    } catch { /* malformed URLs receive the ordinary literal check */ }
  }
  if (/^Bearer\s+/i.test(value)) value = value.replace(/^Bearer\s+/i, '')
  if (!value || placeholder(value)) return false
  return /^[\x21-\x7e]{12,}$/.test(value)
}

function valueContainsCredential(value: string, isCode: boolean, enclosed = false): boolean {
  const shell = shellReferences(value)
  if (shell.secretDefault) return true
  value = shell.rest.trim()
  if (!value) return false
  const quoted = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g
  for (const match of value.matchAll(quoted)) {
    const before = value.slice(0, match.index)
    const envKey = /(?:process\.env\[|os\.environ\[|(?:os\.getenv|os\.environ\.get|[A-Za-z_][\w.]*\.get|getpass(?:\.getpass)?|input|prompt)\(\s*)$/.test(before)
    const after = value.slice(match.index! + match[0].length)
    if (/^\s*:/.test(after)) continue
    if (/^\s*\]/.test(after) && /(?:[A-Za-z_$][\w$.]*|\]|\))\[\s*$/.test(before)) continue
    if (/(?:getpass(?:\.getpass)?|input|prompt|re\.compile|(?:new\s+)?RegExp)\(\s*[rub]*$/i.test(before)) continue
    if (envKey && /^[A-Za-z_][A-Za-z0-9_]*$/.test(match[2]!)) continue
    let candidate = match[2]!
    if (/f$/.test(before)) {
      for (const interpolation of candidate.matchAll(/\{([^{}]*)\}/g)) {
        if (valueContainsCredential(interpolation[1]!, true)) return true
      }
      candidate = candidate.replace(/\{[^{}]*\}/g, '')
    }
    if (literal(candidate)) return true
  }
  const unquoted = value.replace(quoted, '').trim()
  if (!unquoted) return false
  if (/^https?:\/\//i.test(unquoted) || /^(?:~\/|\.{1,2}\/|\/)/.test(unquoted)) return literal(unquoted)
  if (/^Bearer\s+/i.test(unquoted)) return literal(unquoted)
  if (isCode && /^(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(unquoted)) return false
  if (isCode && /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])+$/.test(unquoted)) return false
  if (isCode && !enclosed && !/^\d+$/.test(unquoted)) return false
  if (isCode && enclosed && /^\{[^{}]+\}(?:\.\.\.)?$/.test(unquoted)) return false
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(|\[)/.test(unquoted)) return false
  return literal(unquoted.split(/\s/)[0] ?? '')
}

export function containsCredential(text: string, path: string): boolean {
  if (signature.test(text) || /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(text)) return true
  const isCode = codeFile.test(extname(path))
  for (const match of text.matchAll(assignment)) {
    const prefix = text.slice(text.lastIndexOf('\n', match.index!) + 1, match.index)
    if (/[:][ \t]*$/.test(match[0]) && /\b(?:if|elif|while|case)[ \t]*["']?$/.test(prefix)) continue
    const start = match.index! + match[0].length
    if (valueContainsCredential(expression(text, start), isCode, Boolean(enclosingQuote(text, start)))) return true
  }
  return false
}
