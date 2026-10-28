import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { managedHarnessDependencyPolicy } from './harness-dependencies.js'

export type TriggerMode = 'queued' | 'immediate' | 'scheduled'
export type MergeMode = 'review' | 'automatic'
export type AuditMode = 'standard' | 'signed'
export interface Policy { mode: TriggerMode; interval_minutes: number; scope: 'default' | 'skill' }
export interface MergePolicy { mode: MergeMode; scope: 'default' | 'skill' }
export interface AuditPolicy { mode: AuditMode; scope: 'default' | 'skill' }
interface StoredPolicy { mode: TriggerMode; interval_minutes: number }
interface Settings {
  automation: { default: StoredPolicy; skills: Record<string, StoredPolicy> }
  merge: { default: MergeMode; skills: Record<string, MergeMode> }
  audit: { default: AuditMode; skills: Record<string, AuditMode> }
  harness: { package: string }
}

export const testedHarnessPackage = managedHarnessDependencyPolicy.package

const defaults: Settings = {
  automation: { default: { mode: 'queued', interval_minutes: 60 }, skills: {} },
  merge: { default: 'review', skills: {} },
  audit: { default: 'standard', skills: {} },
  harness: { package: testedHarnessPackage },
}

function triggerMode(value: unknown): TriggerMode {
  // Settings written by early V2 builds used `manual` for the persistent queue.
  // It never represented a merge decision, so migrate it without user action.
  if (value === 'manual') return 'queued'
  if (value === 'queued' || value === 'immediate' || value === 'scheduled') return value
  return defaults.automation.default.mode
}

function mergeMode(value: unknown): MergeMode {
  return value === 'automatic' ? 'automatic' : 'review'
}

function auditMode(value: unknown): AuditMode {
  return value === 'signed' ? 'signed' : 'standard'
}

export const resolveHome = (home?: string): string => resolve(home ?? process.env.SKILLHONE_HOME ?? join(homedir(), '.skillhone'))
export const harnessRoot = (home: string): string => join(home, 'harness')
export const harnessHome = (home: string): string => join(harnessRoot(home), 'home')
export const evaluatorPatchPath = (home: string): string => join(harnessHome(home), 'skillhone', 'evaluator.patch.yml')
export const evaluatorHarnessHome = (home: string): string => join(harnessRoot(home), 'roles', 'evaluator')

export type HarnessRole = 'optimizer' | 'evaluator'

export function loadSettings(home: string): Settings {
  const path = join(home, 'settings.json')
  if (!existsSync(path)) return structuredClone(defaults)
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>
  return {
    automation: {
      default: {
        mode: triggerMode(parsed.automation?.default?.mode),
        interval_minutes: parsed.automation?.default?.interval_minutes ?? defaults.automation.default.interval_minutes,
      },
      skills: Object.fromEntries(Object.entries(parsed.automation?.skills ?? {}).map(([key, value]) => [key, {
        mode: triggerMode(value.mode), interval_minutes: value.interval_minutes,
      }])),
    },
    merge: {
      default: mergeMode(parsed.merge?.default),
      skills: Object.fromEntries(Object.entries(parsed.merge?.skills ?? {}).map(([key, value]) => [key, mergeMode(value)])),
    },
    audit: {
      default: auditMode(parsed.audit?.default),
      skills: Object.fromEntries(Object.entries(parsed.audit?.skills ?? {}).map(([key, value]) => [key, auditMode(value)])),
    },
    // Harness is part of the tested repair runtime contract. Older settings
    // may contain a movable `@latest` tag; never let it silently change the
    // installed runtime between homes or installation dates.
    harness: structuredClone(defaults.harness),
  }
}

function atomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  writeFileSync(temporary, text.endsWith('\n') ? text : `${text}\n`, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, path)
}

export function saveSettings(home: string, value: Settings): void {
  atomic(join(home, 'settings.json'), JSON.stringify(value, null, 2))
}

export function policy(home: string, project?: string): Policy {
  const settings = loadSettings(home)
  const selected = project ? settings.automation.skills[project] : undefined
  return { ...(selected ?? settings.automation.default), scope: selected ? 'skill' : 'default' }
}

export function setPolicy(home: string, mode: TriggerMode, interval: number, project?: string): Policy {
  if (!['queued', 'immediate', 'scheduled'].includes(mode)) throw new Error('trigger must be queued, immediate, or scheduled')
  if (!Number.isInteger(interval) || interval < 1 || interval > 10080) throw new Error('interval minutes must be between 1 and 10080')
  const settings = loadSettings(home)
  const next = { mode, interval_minutes: interval }
  if (project) settings.automation.skills[project] = next
  else settings.automation.default = next
  saveSettings(home, settings)
  return policy(home, project)
}

export function mergePolicy(home: string, project?: string): MergePolicy {
  const settings = loadSettings(home)
  const selected = project ? settings.merge.skills[project] : undefined
  return { mode: selected ?? settings.merge.default, scope: selected ? 'skill' : 'default' }
}

export function setMergePolicy(home: string, mode: MergeMode, project?: string): MergePolicy {
  if (!['review', 'automatic'].includes(mode)) throw new Error('merge mode must be review or automatic')
  const settings = loadSettings(home)
  if (project) settings.merge.skills[project] = mode
  else settings.merge.default = mode
  saveSettings(home, settings)
  return mergePolicy(home, project)
}

export function auditPolicy(home: string, project?: string): AuditPolicy {
  const settings = loadSettings(home)
  const selected = project ? settings.audit.skills[project] : undefined
  return { mode: selected ?? settings.audit.default, scope: selected ? 'skill' : 'default' }
}

export function setAuditPolicy(home: string, mode: AuditMode, project?: string): AuditPolicy {
  if (!['standard', 'signed'].includes(mode)) throw new Error('audit mode must be standard or signed')
  const settings = loadSettings(home)
  if (project) settings.audit.skills[project] = mode
  else settings.audit.default = mode
  saveSettings(home, settings)
  // A later opt-in establishes a fresh trusted baseline. Retaining a seal
  // while standard mode permits unsigned host changes would create a false
  // tamper alert when signed mode is enabled again.
  if (mode === 'standard') {
    if (project) rmSync(join(home, 'projects', project, 'audit-integrity.json'), { force: true })
    else {
      const projects = join(home, 'projects')
      if (existsSync(projects)) for (const entry of readdirSync(projects)) {
        rmSync(join(projects, entry, 'audit-integrity.json'), { force: true })
      }
    }
  }
  return auditPolicy(home, project)
}

export function clearAuditPolicy(home: string, project: string): AuditPolicy {
  const settings = loadSettings(home)
  delete settings.audit.skills[project]
  saveSettings(home, settings)
  const selected = auditPolicy(home, project)
  if (selected.mode === 'standard') rmSync(join(home, 'projects', project, 'audit-integrity.json'), { force: true })
  return selected
}

export function clearPolicy(home: string, project: string): Policy {
  const settings = loadSettings(home)
  delete settings.automation.skills[project]
  saveSettings(home, settings)
  return policy(home, project)
}

function quote(value: string): string { return JSON.stringify(value) }
function piProvider(text: string, provider: string, body: string[]): string {
  const lines = text.split(/\r?\n/)
  let top = lines.indexOf('llm-pi-ai:')
  if (top < 0) {
    if (lines.at(-1) !== '') lines.push('')
    lines.push('llm-pi-ai:', '  providers:', `    ${provider}:`, ...body.map(line => `      ${line}`))
    return `${lines.join('\n').trim()}\n`
  }
  let end = lines.length
  for (let i = top + 1; i < lines.length; i += 1) if ((lines[i] ?? '') && !/^[ \t#]/.test(lines[i] ?? '')) { end = i; break }
  let providers = lines.indexOf('  providers:', top + 1)
  if (providers < 0 || providers >= end) {
    lines.splice(top + 1, 0, '  providers:', `    ${provider}:`, ...body.map(line => `      ${line}`))
    return `${lines.join('\n').trim()}\n`
  }
  let providersEnd = end
  for (let i = providers + 1; i < end; i += 1) if ((lines[i] ?? '').trim() && !/^ {4}/.test(lines[i] ?? '')) { providersEnd = i; break }
  const route = lines.indexOf(`    ${provider}:`, providers + 1)
  const block = [`    ${provider}:`, ...body.map(line => `      ${line}`)]
  if (route < 0 || route >= providersEnd) lines.splice(providersEnd, 0, ...block)
  else {
    let routeEnd = providersEnd
    for (let i = route + 1; i < providersEnd; i += 1) if (/^ {4}\S/.test(lines[i] ?? '')) { routeEnd = i; break }
    lines.splice(route, routeEnd - route, ...block)
  }
  return `${lines.join('\n').trim()}\n`
}

function credentialReference(text: string, ref: string, secret: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line !== '')
  const topLevel = new RegExp(`^${ref}:`)
  const nested = new RegExp(`^ {2}${ref}:`)
  const value = `  ${ref}: ${quote(secret)}`
  const cleaned = lines.filter((line) => !topLevel.test(line))
  let refs = cleaned.indexOf('refs:')
  if (refs < 0) {
    const version = cleaned.findIndex((line) => /^version:/.test(line))
    refs = version >= 0 ? version + 1 : 0
    cleaned.splice(refs, 0, 'refs:', value)
    return `${cleaned.join('\n').trim()}\n`
  }
  let end = cleaned.length
  for (let index = refs + 1; index < cleaned.length; index += 1) {
    const line = cleaned[index] ?? ''
    if (line && !/^[ \t#]/.test(line)) { end = index; break }
  }
  const current = cleaned.findIndex((line, index) => index > refs && index < end && nested.test(line))
  if (current >= 0) cleaned[current] = value
  else cleaned.splice(end, 0, value)
  return `${cleaned.join('\n').trim()}\n`
}

function webSearchCredentialPatch(text: string, ref: string): string {
  const block = [
    '- id: web-search-deepseek',
    '  config:',
    `    apiKeyEnv: ${ref}`,
  ]
  if (text.trim() === '[]') return `${block.join('\n')}\n`
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => /^- id:\s*web-search-deepseek\s*$/.test(line))
  if (start < 0) {
    while (lines.at(-1) === '') lines.pop()
    if (lines.length > 0) lines.push('')
    lines.push(...block)
    return `${lines.join('\n').trim()}\n`
  }
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^- id:\s*/.test(lines[index] ?? '')) { end = index; break }
  }
  let config = lines.findIndex((line, index) => index > start && index < end && /^ {2}config:\s*$/.test(line))
  if (config < 0) {
    lines.splice(start + 1, 0, '  config:', `    apiKeyEnv: ${ref}`)
    return `${lines.join('\n').trim()}\n`
  }
  let configEnd = end
  for (let index = config + 1; index < end; index += 1) {
    if (/^ {2}\S/.test(lines[index] ?? '')) { configEnd = index; break }
  }
  const current = lines.findIndex((line, index) => index > config && index < configEnd && /^ {4}apiKeyEnv:\s*/.test(line))
  if (current >= 0) lines[current] = `    apiKeyEnv: ${ref}`
  else lines.splice(configEnd, 0, `    apiKeyEnv: ${ref}`)
  return `${lines.join('\n').trim()}\n`
}

export function profilePatchPath(home: string): string {
  return join(harnessHome(home), 'profiles', 'headless', 'cordis.patch.yml')
}

interface ProfileEntry {
  start: number
  end: number
  id?: string
  insert: boolean
  config?: { start: number; end: number; indent: number; inline: boolean }
}

const lineTerminator = /[\r\n\u2028\u2029]/

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char)
}

function skipWhitespace(line: string, start: number): number {
  let cursor = start
  while (cursor < line.length && isWhitespace(line[cursor])) cursor += 1
  return cursor
}

function indentOf(line: string): number {
  let indent = 0
  while (indent < line.length && isWhitespace(line[indent])) indent += 1
  return indent
}

interface MappingField { indent: number; key: string; value: string }

// Parse a YAML mapping line without overlapping repetitions. `.*` in the old
// patterns could not cross a line terminator, so reject separators left in the
// trimmed value instead of letting a regex engine backtrack over them.
function mappingField(line: string): MappingField | undefined {
  const indent = indentOf(line)
  const colon = line.indexOf(':', indent)
  if (colon <= indent) return undefined
  const key = line.slice(indent, colon)
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) return undefined
  const value = line.slice(skipWhitespace(line, colon + 1)).trimEnd()
  if (lineTerminator.test(value)) return undefined
  return { indent, key, value }
}

function listItem(line: string): { indent: number; content: string } | undefined {
  const indent = indentOf(line)
  if (line[indent] !== '-') return undefined
  const content = line.slice(skipWhitespace(line, indent + 1))
  if (lineTerminator.test(content)) return undefined
  return { indent, content }
}

function unquote(value: string): string | undefined {
  const text = value.trim()
  if (!text || text.startsWith('#')) return undefined
  if (text.startsWith('"') && text.endsWith('"')) {
    try { return String(JSON.parse(text)) } catch { return text.slice(1, -1) }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'")
  return text
}

function mappingValue(lines: string[], key: string): string | undefined {
  for (const line of lines) {
    const field = mappingField(line)
    if (field?.key === key) return unquote(field.value)
  }
  return undefined
}

function profileEntries(lines: string[]): ProfileEntry[] {
  const starts: Array<{ index: number; item: { indent: number; content: string } }> = []
  let base = -1
  for (let index = 0; index < lines.length; index += 1) {
    const item = listItem(lines[index] ?? '')
    if (!item) continue
    if (base < 0) base = item.indent
    if (item.indent === base) starts.push({ index, item })
  }
  return starts.map(({ index: start, item }, count) => {
    const end = starts[count + 1]?.index ?? lines.length
    let contentIndent = item.indent + 2
    if (!item.content.trim()) {
      for (let index = start + 1; index < end; index += 1) {
        const line = lines[index] ?? ''
        if (line.trim() && !/^\s*#/.test(line)) { contentIndent = indentOf(line); break }
      }
    }
    let id: string | undefined
    let insert = false
    let config: ProfileEntry['config']
    for (let index = start; index < end; index += 1) {
      const line = lines[index] ?? ''
      if (index > start && indentOf(line) !== contentIndent) continue
      const field = mappingField(index === start ? item.content : line)
      if (id === undefined && field?.key === 'id') id = unquote(field.value)
      if (field?.key === 'insert') insert = true
      if (config !== undefined || field?.key !== 'config') continue
      const indent = index === start ? contentIndent : field.indent
      const tail = field.value
      if (tail && !tail.startsWith('#')) {
        config = { start: index, end: index + 1, indent, inline: true }
      } else {
        let configEnd = end
        for (let cursor = index + 1; cursor < end; cursor += 1) {
          const next = lines[cursor] ?? ''
          if (next.trim() && !/^\s*#/.test(next) && indentOf(next) <= indent) { configEnd = cursor; break }
        }
        config = { start: index, end: configEnd, indent, inline: false }
      }
    }
    return { start, end, id, insert, config }
  })
}

function entryBody(lines: string[], entry: ProfileEntry): string[] {
  if (!entry.config || entry.config.inline) return []
  const base = entry.config.indent + 2
  return lines.slice(entry.config.start + 1, entry.config.end).map(line => {
    if (!line.trim() || indentOf(line) < base) return line
    return line.slice(base)
  })
}

function profileSelection(text: string): { provider: string; model: string } | undefined {
  const lines = text.split(/\r?\n/)
  for (const entry of profileEntries(lines).reverse()) {
    if (entry.id !== 'agent-default-model' || entry.insert) continue
    const body = entryBody(lines, entry)
    const provider = mappingValue(body, 'provider')
    const model = mappingValue(body, 'model')
    if (provider && model) return { provider, model }
  }
  return undefined
}

function appendProfileEntry(text: string, id: string, body: string[]): string {
  const lines = text.split(/\r?\n/).filter(line => !/^\s*\[\]\s*(?:#.*)?$/.test(line))
  while (lines.length && !lines[0]?.trim()) lines.shift()
  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  if (lines.length) lines.push('')
  lines.push(`- id: ${id}`, '  config:', ...body.map(line => (line ? `    ${line}` : '')))
  return `${lines.join('\n')}\n`
}

export function updateProfileConfig(text: string, id: string, body: string[]): string {
  const lines = (text.trim() ? text : '[]\n').split(/\r?\n/)
  const entries = profileEntries(lines)
  const entry = entries.reverse().find(item => item.id === id && !item.insert)
  if (!entry) return appendProfileEntry(text, id, body)
  const configIndent = entry.config?.indent ?? (() => {
    const head = lines[entry.start] ?? ''
    if (head.replace(/^\s*-\s*/, '').trim()) return (head.match(/^\s*/)?.[0].length ?? 0) + 2
    for (let index = entry.start + 1; index < entry.end; index += 1) {
      const line = lines[index] ?? ''
      if (line.trim() && !/^\s*#/.test(line)) return indentOf(line)
    }
    return (head.match(/^\s*/)?.[0].length ?? 0) + 2
  })()
  const block = [
    `${' '.repeat(configIndent)}config:`,
    ...body.map(line => (line ? `${' '.repeat(configIndent + 2)}${line}` : '')),
  ]
  if (entry.config) {
    lines.splice(entry.config.start, entry.config.end - entry.config.start, ...block)
  } else {
    let at = entry.start + 1
    for (let index = entry.start + 1; index < entry.end; index += 1) {
      const line = lines[index] ?? ''
      if (line.trim() && !/^\s*#/.test(line) && indentOf(line) === configIndent) at = index + 1
    }
    lines.splice(at, 0, ...block)
  }
  while (lines.length && !lines.at(-1)?.trim()) lines.pop()
  return `${lines.join('\n')}\n`
}

const legacyProfileIds: Record<string, string> = {
  'ui-developer-tools': 'ui-settings',
  'ui-onboarding': 'ui-settings-general',
  shell: process.platform === 'win32' ? 'pwsh-sandbox' : 'bash-sandbox',
}

function legacySections(text: string): Array<{ id: string; body: string[] }> {
  const lines = text.split(/\r?\n/)
  const sections: Array<{ id: string; body: string[] }> = []
  for (let index = 0; index < lines.length; index += 1) {
    const field = mappingField(lines[index] ?? '')
    if (!field || field.indent !== 0) continue
    let end = lines.length
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? ''
      if (!line.trim() || /^\s*#/.test(line)) continue
      if (!/^\s/.test(line)) { end = cursor; break }
    }
    const body = lines.slice(index + 1, end).map(line => {
      if (!line.trim()) return ''
      return indentOf(line) >= 2 ? line.slice(2) : line
    })
    if (body.some(line => line.trim())) sections.push({ id: legacyProfileIds[field.key] ?? field.key, body })
    index = end - 1
  }
  return sections
}

function mergeLegacyProfile(text: string, legacy: string): string {
  const present = new Set(profileEntries(text.split(/\r?\n/)).map(entry => entry.id).filter(Boolean))
  let merged = text
  for (const section of legacySections(legacy)) {
    if (!section.id || present.has(section.id)) continue
    merged = updateProfileConfig(merged, section.id, section.body)
    present.add(section.id)
  }
  return merged
}

function retireLegacySettings(path: string): void {
  if (!existsSync(path)) return
  const imported = `${path}.imported`
  if (existsSync(imported)) {
    let suffix = 1
    while (existsSync(`${imported}.${suffix}`)) suffix += 1
    renameSync(imported, `${imported}.${suffix}`)
  }
  renameSync(path, imported)
}

function deepseekEntryId(home: string): string {
  const modules = join(harnessRoot(home), 'node_modules')
  const patches = [join(modules, '@deepseek-ai', 'dsh-base', 'cordis.patch.yml')]
  const virtual = join(modules, '.pnpm')
  if (existsSync(virtual)) {
    for (const entry of readdirSync(virtual)) {
      if (entry.startsWith('@deepseek-ai+dsh-base@')) {
        patches.push(join(virtual, entry, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'))
      }
    }
  }
  for (const patch of patches) {
    if (!existsSync(patch)) continue
    const text = readFileSync(patch, 'utf8')
    if (/^\s*-\s*id:\s*["']?llm-deepseek-api-key["']?\s*$/m.test(text)) return 'llm-deepseek-api-key'
    if (/^\s*-\s*id:\s*["']?llm-deepseek["']?\s*$/m.test(text)) return 'llm-deepseek'
  }
  const profile = join(harnessHome(home), 'profiles', 'headless', 'cordis.patch.yml')
  if (existsSync(profile)) {
    const ids = new Set(profileEntries(readFileSync(profile, 'utf8').split(/\r?\n/)).map(entry => entry.id))
    if (ids.has('llm-deepseek')) return 'llm-deepseek'
  }
  return 'llm-deepseek-api-key'
}

function evaluatorSelection(home: string): { provider: string; model: string } | undefined {
  const path = evaluatorPatchPath(home)
  if (!existsSync(path)) return undefined
  return profileSelection(readFileSync(path, 'utf8'))
}

function syncEvaluatorHarness(home: string, settings: string, credentials: string): void {
  const selection = evaluatorSelection(home)
  if (!selection) return
  const target = evaluatorHarnessHome(home)
  const sourceProfile = join(harnessHome(home), 'profiles', 'headless')
  const targetProfile = join(target, 'profiles', 'headless')
  if (existsSync(sourceProfile)) {
    rmSync(targetProfile, { recursive: true, force: true })
    mkdirSync(dirname(targetProfile), { recursive: true })
    cpSync(sourceProfile, targetProfile, { recursive: true })
  }
  const roleSettings = updateProfileConfig(settings, 'agent-default-model', [
    `provider: ${quote(selection.provider)}`, `model: ${quote(selection.model)}`,
  ])
  atomic(join(targetProfile, 'cordis.patch.yml'), roleSettings)
  atomic(join(target, '.credentials.yaml'), credentials)
  atomic(join(target, 'skillhone', 'evaluator.patch.yml'), readFileSync(evaluatorPatchPath(home), 'utf8'))
  retireLegacySettings(join(target, 'settings.yaml'))
}

export function benchmarkHarnessHome(home: string): string {
  const roleHome = evaluatorHarnessHome(home)
  const roleProfile = join(roleHome, 'profiles', 'headless', 'cordis.patch.yml')
  const roleLegacy = join(roleHome, 'settings.yaml')
  if (existsSync(roleProfile) || existsSync(roleLegacy)) return roleHome
  const mainHome = harnessHome(home)
  const mainProfile = join(mainHome, 'profiles', 'headless', 'cordis.patch.yml')
  const mainLegacy = join(mainHome, 'settings.yaml')
  const credentialsPath = join(mainHome, '.credentials.yaml')
  if (existsSync(credentialsPath) && evaluatorSelection(home)) {
    // Existing installations predate role-isolated Harness homes. Migrate on
    // first benchmark use without asking the user to re-enter credentials.
    if (existsSync(mainProfile)) {
      syncEvaluatorHarness(home, readFileSync(mainProfile, 'utf8'), readFileSync(credentialsPath, 'utf8'))
    } else if (existsSync(mainLegacy)) {
      syncEvaluatorHarness(home, mergeLegacyProfile('', readFileSync(mainLegacy, 'utf8')), readFileSync(credentialsPath, 'utf8'))
    }
  }
  return existsSync(roleProfile) || existsSync(roleLegacy) ? roleHome : mainHome
}

export function configureHarness(home: string, input: {
  provider: string; model: string; secret: string; baseUrl?: string; protocol?: string; role?: HarnessRole
}): Record<string, unknown> {
  let provider = input.provider.trim().toLowerCase()
  if (provider === 'deepseek') provider = 'deepseek-official'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(provider)) throw new Error('invalid provider id')
  if (!input.model.trim()) throw new Error('model must not be empty')
  if (!input.secret.trim() || /[\r\n]/.test(input.secret)) throw new Error('credential must be one non-empty line')
  const builtIn = new Set(['deepseek-official', 'openai', 'anthropic'])
  if (!builtIn.has(provider) && !input.baseUrl) throw new Error('a custom provider requires --base-url')
  const dshHome = harnessHome(home)
  const profilePath = join(dshHome, 'profiles', 'headless', 'cordis.patch.yml')
  const legacyPath = join(dshHome, 'settings.yaml')
  let text = existsSync(profilePath) ? readFileSync(profilePath, 'utf8') : ''
  if (existsSync(legacyPath)) text = mergeLegacyProfile(text, readFileSync(legacyPath, 'utf8'))
  const label = (provider === 'deepseek-official' ? 'deepseek' : provider).toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const ref = `SKILLHONE_${label}_CREDENTIAL`
  if (provider === 'deepseek-official') {
    text = updateProfileConfig(text, deepseekEntryId(home), [`apiKeyEnv: ${ref}`])
    text = webSearchCredentialPatch(text.trim() ? text : '[]\n', ref)
  }
  else {
    const body = [`apiKeyEnv: ${ref}`]
    if (input.baseUrl) body.push(`api: ${input.protocol ?? 'openai-completions'}`, `baseURL: ${quote(input.baseUrl)}`, 'models:', `  - id: ${quote(input.model)}`)
    const lines = text.split(/\r?\n/)
    const current = profileEntries(lines).reverse().find(entry => entry.id === 'llm-pi-ai' && !entry.insert)
    const currentBody = current ? entryBody(lines, current) : []
    while (currentBody.length && !currentBody.at(-1)?.trim()) currentBody.pop()
    const document = `llm-pi-ai:\n${currentBody.map(line => (line ? `  ${line}` : '')).join('\n')}\n`
    const updated = piProvider(document, provider, body).split(/\r?\n/).slice(1)
      .map(line => (line.startsWith('  ') ? line.slice(2) : line))
    text = updateProfileConfig(text, 'llm-pi-ai', updated)
  }
  const role = input.role ?? 'optimizer'
  if (role === 'optimizer') {
    text = updateProfileConfig(text, 'agent-default-model', [
      `provider: ${quote(provider)}`, `model: ${quote(input.model)}`,
    ])
  } else {
    atomic(evaluatorPatchPath(home), [
      '- id: agent-default-model',
      '  config:',
      `    provider: ${quote(provider)}`,
      `    model: ${quote(input.model)}`,
    ].join('\n'))
  }
  const credentialsPath = join(dshHome, '.credentials.yaml')
  const existing = existsSync(credentialsPath) ? readFileSync(credentialsPath, 'utf8') : 'version: 1\nrefs:\n'
  const credentials = credentialReference(existing, ref, input.secret.trim())
  atomic(profilePath, text)
  atomic(credentialsPath, credentials)
  syncEvaluatorHarness(home, text, credentials)
  if (existsSync(legacyPath)) retireLegacySettings(legacyPath)
  return { role, provider, model: input.model, custom_endpoint: Boolean(input.baseUrl), credential_saved: true }
}

export function credentialStorePresent(home: string): boolean {
  const path = join(harnessHome(home), '.credentials.yaml')
  return existsSync(path) && statSync(path).size > 0
}

export function modelConfigured(home: string): boolean {
  const profile = join(harnessHome(home), 'profiles', 'headless', 'cordis.patch.yml')
  if (existsSync(profile) && profileSelection(readFileSync(profile, 'utf8'))) return true
  const legacy = join(harnessHome(home), 'settings.yaml')
  if (!existsSync(legacy)) return false
  return legacySections(readFileSync(legacy, 'utf8')).some(section => {
    if (section.id !== 'agent-default-model') return false
    return Boolean(mappingValue(section.body, 'provider') && mappingValue(section.body, 'model'))
  })
}

export function harnessConfigured(home: string): boolean {
  return modelConfigured(home) && credentialStorePresent(home)
}
