import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ManagedHarnessDependencyPolicy {
  package: string
  overrides: Readonly<Record<string, string>>
}

// This is the single source of truth for the managed DSH dependency policy.
// The installer and the CI audit both consume it. Override selectors are
// deliberately limited to the affected major/patch ranges so unrelated
// consumers (notably zod v3) are never replaced.
export const managedHarnessDependencyPolicy: ManagedHarnessDependencyPolicy = {
  package: '@deepseek-ai/dsh@0.2.1-rc.2',
  overrides: {
    'zod@>=4.0.0 <4.6.6': '4.6.6',
    'undici@>=8.0.0 <8.12.2': '8.12.2',
    'fflate@>=0.8.0 <0.8.3': '0.8.3',
    '@modelcontextprotocol/client@>=2.0.0 <2.3.0': '2.3.0',
  },
}

function existingText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function mergedOverrides(value: unknown): Record<string, string> {
  if (value === undefined) return { ...managedHarnessDependencyPolicy.overrides }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('managed Harness package.json overrides must be an object; refusing to replace it')
  }
  return {
    ...(value as Record<string, unknown>),
    ...managedHarnessDependencyPolicy.overrides,
  } as Record<string, string>
}

export function managedHarnessPackageJson(existing?: string): string {
  let value: Record<string, unknown> = {}
  if (existing?.trim()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(existing)
    } catch {
      throw new Error('managed Harness package.json is not valid JSON; refusing to replace it')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('managed Harness package.json must contain an object; refusing to replace it')
    }
    value = parsed as Record<string, unknown>
  }
  value.overrides = mergedOverrides(value.overrides)
  return `${JSON.stringify(value, null, 2)}\n`
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

function overrideLine(key: string, version: string): string {
  return `  ${quoted(key)}: ${quoted(version)}`
}

function skipSpaces(line: string, start: number): number {
  let cursor = start
  while (cursor < line.length && (line[cursor] === ' ' || line[cursor] === '\t')) cursor += 1
  return cursor
}

function existingOverrideKey(line: string): string | undefined {
  if (line[0] !== ' ' || line[1] !== ' ' || line[2] === undefined) return undefined
  let cursor = 2
  if (line[cursor] === ' ' || line[cursor] === '\t') return undefined
  let key: string
  if (line[cursor] === '"') {
    const start = cursor
    cursor += 1
    while (cursor < line.length) {
      if (line[cursor] === '\\') cursor += 2
      else if (line[cursor] === '"') break
      else cursor += 1
    }
    if (line[cursor] !== '"') return undefined
    const raw = line.slice(start, cursor + 1)
    cursor += 1
    try {
      key = String(JSON.parse(raw))
    } catch {
      return undefined
    }
  } else if (line[cursor] === "'") {
    cursor += 1
    let value = ''
    while (cursor < line.length) {
      if (line[cursor] === "'") {
        if (line[cursor + 1] === "'") {
          value += "'"
          cursor += 2
          continue
        }
        cursor += 1
        break
      }
      value += line[cursor]
      cursor += 1
    }
    if (line[cursor - 1] !== "'") return undefined
    key = value
  } else {
    const start = cursor
    while (cursor < line.length && line[cursor] !== ':' && line[cursor] !== '#') cursor += 1
    if (line[cursor] !== ':') return undefined
    key = line.slice(start, cursor).trimEnd()
    if (!key) return undefined
  }
  cursor = skipSpaces(line, cursor)
  return line[cursor] === ':' ? key : undefined
}

function flowOverrides(tail: string): Record<string, unknown> | undefined {
  if (!tail.startsWith('{') || !tail.endsWith('}')) return undefined
  try {
    const value = JSON.parse(tail) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function overridesField(line: string): string | undefined {
  if (!line.startsWith('overrides')) return undefined
  let cursor = skipSpaces(line, 'overrides'.length)
  if (line[cursor] !== ':') return undefined
  return line.slice(skipSpaces(line, cursor + 1))
}

export function managedHarnessPnpmWorkspace(existing?: string): string {
  const overrides = managedHarnessDependencyPolicy.overrides
  const lines = (existing ?? '').split(/\r\n|[\r\n\u2028\u2029]/)
  let start = -1
  let inline: Record<string, unknown> = {}
  for (let index = 0; index < lines.length; index += 1) {
    const raw = overridesField(lines[index] ?? '')
    if (raw === undefined) continue
    const tail = raw.trim()
    if (tail && !tail.startsWith('#')) {
      const parsed = flowOverrides(tail)
      if (!parsed) {
        throw new Error('managed Harness pnpm-workspace.yaml has unsupported inline overrides; refusing to replace unrelated configuration')
      }
      inline = parsed
    }
    start = index
    break
  }
  if (start < 0) {
    const body = Object.entries(overrides).map(([key, version]) => overrideLine(key, version))
    const prefix = existing?.trim() ? `${existing.trimEnd()}\n\n` : ''
    return `${prefix}overrides:\n${body.join('\n')}\n`
  }
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trimStart()
    if (trimmed && !trimmed.startsWith('#') && !/^\s/.test(line)) {
      end = index
      break
    }
  }
  const found = new Set<string>()
  const block: string[] = []
  for (const [key, value] of Object.entries(inline)) {
    if (typeof value !== 'string') {
      throw new Error('managed Harness pnpm-workspace.yaml has non-string inline overrides; refusing to replace unrelated configuration')
    }
    if (Object.hasOwn(overrides, key)) {
      found.add(key)
      block.push(overrideLine(key, overrides[key]!))
    } else {
      block.push(overrideLine(key, value))
    }
  }
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? ''
    const key = existingOverrideKey(line)
    if (key !== undefined && Object.hasOwn(overrides, key)) {
      found.add(key)
      block.push(overrideLine(key, overrides[key]!))
    } else {
      block.push(line)
    }
  }
  for (const [key, version] of Object.entries(overrides)) {
    if (!found.has(key)) block.push(overrideLine(key, version))
  }
  const merged = [...lines.slice(0, start), 'overrides:', ...block, ...lines.slice(end)]
  return `${merged.join('\n').trimEnd()}\n`
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
}

export function applyManagedHarnessDependencyPolicy(root: string): void {
  const packagePath = join(root, 'package.json')
  const workspacePath = join(root, 'pnpm-workspace.yaml')
  writeAtomic(packagePath, managedHarnessPackageJson(existingText(packagePath)))
  writeAtomic(workspacePath, managedHarnessPnpmWorkspace(existingText(workspacePath)))
}
