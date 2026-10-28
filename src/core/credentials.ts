import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { harnessHome } from './settings.js'

// DSH's file-backed credential store is a versioned YAML mapping. Headless
// profiles disable that service, so SkillHone must read the same protected
// store and provide a launch-time environment snapshot instead.
const referenceName = /^[A-Za-z_][A-Za-z0-9_]*$/
const groupOtherBits = 0o077

interface MappingEntry {
  key: string
  value: string
}

interface QuotedScalar {
  value: string
  end: number
}

function hex(text: string): number | undefined {
  return /^[0-9a-fA-F]+$/.test(text) ? Number.parseInt(text, 16) : undefined
}

function escaped(text: string, index: number): { value: string; end: number } | undefined {
  const marker = text[index]
  if (marker === undefined) return undefined
  const simple: Record<string, string> = {
    '0': '\0', a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r',
    e: '\x1b', '"': '"', '\\': '\\', '/': '/', ' ': ' ', N: '\u0085', _: '\u00a0',
    L: '\u2028', P: '\u2029',
  }
  if (Object.hasOwn(simple, marker)) return { value: simple[marker] ?? '', end: index + 1 }
  const width = marker === 'x' ? 2 : marker === 'u' ? 4 : marker === 'U' ? 8 : 0
  if (width === 0) return undefined
  const digits = text.slice(index + 1, index + 1 + width)
  if (digits.length !== width) return undefined
  const codePoint = hex(digits)
  if (codePoint === undefined || codePoint > 0x10ffff) return undefined
  return { value: String.fromCodePoint(codePoint), end: index + 1 + width }
}

function doubleQuoted(text: string, start: number): QuotedScalar | undefined {
  let value = ''
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') return { value, end: index + 1 }
    if (character !== '\\') {
      value += character
      continue
    }
    const decoded = escaped(text, index + 1)
    if (!decoded) return undefined
    value += decoded.value
    index = decoded.end - 1
  }
  return undefined
}

function singleQuoted(text: string, start: number): QuotedScalar | undefined {
  let value = ''
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character !== "'") {
      value += character
      continue
    }
    if (text[index + 1] === "'") {
      value += "'"
      index += 1
      continue
    }
    return { value, end: index + 1 }
  }
  return undefined
}

function quoted(text: string, start: number): QuotedScalar | undefined {
  if (text[start] === '"') return doubleQuoted(text, start)
  if (text[start] === "'") return singleQuoted(text, start)
  return undefined
}

function mappingEntry(line: string): MappingEntry | undefined {
  const text = line.trimStart()
  if (text.startsWith('"') || text.startsWith("'")) {
    const key = quoted(text, 0)
    if (!key) return undefined
    const separator = text.slice(key.end).match(/^[ \t]*:(?:[ \t]+|$)/)
    if (!separator) return undefined
    return { key: key.value, value: text.slice(key.end + separator[0].length) }
  }
  const separator = text.match(/^([^:]+?):(?:[ \t]+|$)/)
  if (!separator) return undefined
  return { key: (separator[1] ?? '').trim(), value: text.slice(separator[0].length) }
}

function scalar(raw: string): string {
  const text = raw.trim()
  if (!text) throw new Error('non-string credential value')
  if (text.startsWith('"') || text.startsWith("'")) {
    const parsed = quoted(text, 0)
    if (!parsed) throw new Error('invalid quoted credential value')
    const rest = text.slice(parsed.end).trim()
    if (rest && !rest.startsWith('#')) throw new Error('invalid credential value')
    if (!parsed.value) throw new Error('empty credential value')
    return parsed.value
  }
  // Plain scalars need an explicit comment boundary. Quoted values above are
  // allowed to contain '#' and ':' literally.
  const comment = text.search(/[ \t]#/)
  const value = (comment >= 0 ? text.slice(0, comment) : text).trimEnd()
  if (!value) throw new Error('non-string credential value')
  if (/^(?:null|~)$/i.test(value)) throw new Error('null credential value')
  if (/^(?:true|false|yes|no|on|off)$/i.test(value)) throw new Error('non-string credential value')
  if (/^[-+]?(?:(?:0|[1-9][0-9_]*)(?:\.[0-9_]*)?(?:[eE][-+]?[0-9]+)?|\.(?:inf|nan))$/i.test(value)) {
    throw new Error('non-string credential value')
  }
  if (/^[!&*|>[{%@`#]/.test(value)) throw new Error('unsupported credential value')
  return value
}

function documentVersion(raw: string): string {
  const text = raw.trim()
  if (text.startsWith('"') || text.startsWith("'")) return scalar(text)
  const comment = text.search(/[ \t]#/)
  return (comment >= 0 ? text.slice(0, comment) : text).trimEnd()
}

function refs(block: string[]): Record<string, string> {
  const entries: Record<string, string> = {}
  let indent: number | undefined
  for (const line of block) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    if (/^[ \t]*\t/.test(line)) throw new Error('tab indentation')
    const spaces = line.match(/^ */)?.[0].length ?? 0
    if (indent === undefined) indent = spaces
    if (spaces === 0 || spaces !== indent) throw new Error('unsupported refs layout')
    const entry = mappingEntry(line.slice(spaces))
    if (!entry || !referenceName.test(entry.key)) throw new Error('invalid reference name')
    if (Object.hasOwn(entries, entry.key)) throw new Error('duplicate reference name')
    entries[entry.key] = scalar(entry.value)
  }
  return entries
}

export function parseCredentialReferences(text: string): Record<string, string> {
  const source = text.replace(/^\uFEFF/, '')
  if (!source.trim()) return {}
  const lines = source.split(/\r?\n/)
  let versionSeen = false
  let version = ''
  let stored: Record<string, string> | undefined
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    index += 1
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || /^---(?:\s+#.*)?$/.test(trimmed) || /^\.\.\.(?:\s+#.*)?$/.test(trimmed)) continue
    if (/^[ \t]/.test(line)) throw new Error('unexpected document indentation')
    const entry = mappingEntry(line)
    if (!entry) throw new Error('invalid credentials document')
    if (entry.key === 'version') {
      if (versionSeen) throw new Error('duplicate version')
      versionSeen = true
      version = documentVersion(entry.value)
      continue
    }
    if (entry.key === 'refs') {
      if (stored !== undefined) throw new Error('duplicate refs section')
      const value = entry.value.trim()
      if (!value || value.startsWith('#')) {
        const block: string[] = []
        while (index < lines.length) {
          const next = lines[index] ?? ''
          if (next.trim() === '' || /^\s*#/.test(next)) {
            block.push(next)
            index += 1
            continue
          }
          if (!/^[ \t]/.test(next)) break
          block.push(next)
          index += 1
        }
        stored = refs(block)
      } else if (/^\{\s*\}$/.test(value) || /^(?:null|~)$/i.test(value)) {
        stored = {}
      } else {
        throw new Error('refs must be a mapping')
      }
      continue
    }
    // A foreign top-level record and its nested body resolve nothing.
    if (!entry.value.trim() || entry.value.trim().startsWith('#')) {
      while (index < lines.length) {
        const next = lines[index] ?? ''
        if (next.trim() === '' || /^\s*#/.test(next)) {
          index += 1
          continue
        }
        if (!/^[ \t]/.test(next)) break
        index += 1
      }
    }
  }
  if (!versionSeen || version !== '1') throw new Error('unsupported credentials document')
  return stored ?? {}
}

export function storedCredentialReferences(home: string): Record<string, string> {
  const path = join(harnessHome(home), '.credentials.yaml')
  try {
    const metadata = statSync(path)
    if (!metadata.isFile()) return {}
    // DSH refuses a credential document readable beyond its owner. Never
    // consume an unprotected store just to make a launch appear configured.
    if (process.platform !== 'win32' && (metadata.mode & groupOtherBits) !== 0) return {}
    return parseCredentialReferences(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}
