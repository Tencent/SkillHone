import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export type TriggerMode = 'queued' | 'immediate' | 'scheduled'
export type MergeMode = 'review' | 'automatic'
export interface Policy { mode: TriggerMode; interval_minutes: number; scope: 'default' | 'skill' }
export interface MergePolicy { mode: MergeMode; scope: 'default' | 'skill' }
interface StoredPolicy { mode: TriggerMode; interval_minutes: number }
interface Settings {
  automation: { default: StoredPolicy; skills: Record<string, StoredPolicy> }
  merge: { default: MergeMode; skills: Record<string, MergeMode> }
  harness: { package: string }
}

export const testedHarnessPackage = '@deepseek-ai/dsh@0.1.5-rc.2'

const defaults: Settings = {
  automation: { default: { mode: 'queued', interval_minutes: 60 }, skills: {} },
  merge: { default: 'review', skills: {} },
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

export function clearPolicy(home: string, project: string): Policy {
  const settings = loadSettings(home)
  delete settings.automation.skills[project]
  saveSettings(home, settings)
  return policy(home, project)
}

function quote(value: string): string { return JSON.stringify(value) }
function section(text: string, key: string, block: string[]): string {
  const lines = text.split(/\r?\n/)
  const start = lines.indexOf(`${key}:`)
  if (start >= 0) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? ''
      if (line && !/^[ \t#]/.test(line)) { end = index; break }
    }
    lines.splice(start, end - start, ...block)
  } else {
    if (lines.at(-1) !== '') lines.push('')
    lines.push(...block)
  }
  return `${lines.join('\n').trim()}\n`
}

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

function evaluatorSelection(home: string): { provider: string; model: string } | undefined {
  const path = evaluatorPatchPath(home)
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8')
  const provider = text.match(/^\s{4}provider:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1]
  const model = text.match(/^\s{4}model:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1]
  return provider && model ? { provider, model } : undefined
}

function syncEvaluatorHarness(home: string, settings: string, credentials: string): void {
  const selection = evaluatorSelection(home)
  if (!selection) return
  const target = evaluatorHarnessHome(home)
  const roleSettings = section(settings, 'agent-default-model', [
    'agent-default-model:', `  provider: ${quote(selection.provider)}`, `  model: ${quote(selection.model)}`,
  ])
  atomic(join(target, 'settings.yaml'), roleSettings)
  atomic(join(target, '.credentials.yaml'), credentials)
  atomic(join(target, 'skillhone', 'evaluator.patch.yml'), readFileSync(evaluatorPatchPath(home), 'utf8'))
  const sourceProfile = join(harnessHome(home), 'profiles', 'headless')
  const targetProfile = join(target, 'profiles', 'headless')
  if (existsSync(sourceProfile)) {
    rmSync(targetProfile, { recursive: true, force: true })
    mkdirSync(dirname(targetProfile), { recursive: true })
    cpSync(sourceProfile, targetProfile, { recursive: true })
  }
}

export function benchmarkHarnessHome(home: string): string {
  const roleHome = evaluatorHarnessHome(home)
  if (existsSync(join(roleHome, 'settings.yaml'))) return roleHome
  const mainHome = harnessHome(home)
  const settingsPath = join(mainHome, 'settings.yaml')
  const credentialsPath = join(mainHome, '.credentials.yaml')
  if (existsSync(settingsPath) && existsSync(credentialsPath) && evaluatorSelection(home)) {
    // Existing installations predate role-isolated Harness homes. Migrate on
    // first benchmark use without asking the user to re-enter credentials.
    syncEvaluatorHarness(home, readFileSync(settingsPath, 'utf8'), readFileSync(credentialsPath, 'utf8'))
  }
  return existsSync(join(roleHome, 'settings.yaml')) ? roleHome : mainHome
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
  const settingsPath = join(dshHome, 'settings.yaml')
  let text = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : 'version: 1\n'
  const label = (provider === 'deepseek-official' ? 'deepseek' : provider).toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const ref = `SKILLHONE_${label}_CREDENTIAL`
  if (provider === 'deepseek-official') {
    text = section(text, 'llm-deepseek', ['llm-deepseek:', `  apiKeyEnv: ${ref}`])
    const profilePatchPath = join(dshHome, 'profiles', 'headless', 'cordis.patch.yml')
    const profilePatch = existsSync(profilePatchPath) ? readFileSync(profilePatchPath, 'utf8') : '[]\n'
    atomic(profilePatchPath, webSearchCredentialPatch(profilePatch, ref))
  }
  else {
    const body = [`apiKeyEnv: ${ref}`]
    if (input.baseUrl) body.push(`api: ${input.protocol ?? 'openai-completions'}`, `baseURL: ${quote(input.baseUrl)}`, 'models:', `  - id: ${quote(input.model)}`)
    text = piProvider(text, provider, body)
  }
  const role = input.role ?? 'optimizer'
  if (role === 'optimizer') {
    text = section(text, 'agent-default-model', ['agent-default-model:', `  provider: ${quote(provider)}`, `  model: ${quote(input.model)}`])
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
  atomic(settingsPath, text)
  atomic(credentialsPath, credentials)
  syncEvaluatorHarness(home, text, credentials)
  return { role, provider, model: input.model, custom_endpoint: Boolean(input.baseUrl), credential_saved: true }
}

export function credentialStorePresent(home: string): boolean {
  const path = join(harnessHome(home), '.credentials.yaml')
  return existsSync(path) && statSync(path).size > 0
}

export function modelConfigured(home: string): boolean {
  const path = join(harnessHome(home), 'settings.yaml')
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  return /(?:^|\n)agent-default-model:\s*\n(?: {2}.+\n?)+/.test(text) && /\n {2}provider:\s*\S+/.test(text) && /\n {2}model:\s*\S+/.test(text)
}

export function harnessConfigured(home: string): boolean {
  return modelConfigured(home) && credentialStorePresent(home)
}
