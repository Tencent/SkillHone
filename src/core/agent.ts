import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { WorkRow } from './tracker.js'

export type AgentRuntime = 'codex' | 'cursor' | 'claude-code' | 'pi' | 'zcode' | 'all'

const bundledSkills = ['skillhone', 'skillhone-auto-optimization'] as const

export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

export function runtimeSkillRoots(runtime: AgentRuntime): Array<{ runtime: Exclude<AgentRuntime, 'all'>; root: string }> {
  if (runtime === 'all') return [
    ...runtimeSkillRoots('codex'),
    ...runtimeSkillRoots('cursor'),
    ...runtimeSkillRoots('claude-code'),
    ...runtimeSkillRoots('pi'),
    ...runtimeSkillRoots('zcode'),
  ]
  if (runtime === 'codex') return [{ runtime, root: join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills') }]
  if (runtime === 'cursor') return [{ runtime, root: join(homedir(), '.cursor', 'skills') }]
  if (runtime === 'claude-code') return [{ runtime, root: join(homedir(), '.claude', 'skills') }]
  if (runtime === 'pi') return [{ runtime, root: join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'skills') }]
  return [{ runtime, root: join(homedir(), '.zcode', 'skills') }]
}

const routingStart = '<!-- skillhone-routing:start -->'
const routingEnd = '<!-- skillhone-routing:end -->'
const routingBody = `${routingStart}
When normal Agent work exposes a reproducible defect in an Agent Skill, invoke
the \`skillhone-auto-optimization\` Skill before editing implementation files or
installing dependencies. A user-supplied Skill Git repository path is
authoritative. Record and dispatch the repair in that repository; queued repair
does not require another confirmation. Only merge or copy-back follows the
user's saved decision boundary.
${routingEnd}`

function routingPath(runtime: Exclude<AgentRuntime, 'all'>, skillRoot: string): string {
  const runtimeRoot = dirname(skillRoot)
  if (runtime === 'claude-code') return join(runtimeRoot, 'CLAUDE.md')
  if (runtime === 'cursor') return join(runtimeRoot, 'rules', 'skillhone.mdc')
  return join(runtimeRoot, 'AGENTS.md')
}

function installRouting(runtime: Exclude<AgentRuntime, 'all'>, skillRoot: string): WorkRow {
  const path = routingPath(runtime, skillRoot)
  mkdirSync(dirname(path), { recursive: true })
  const prefix = runtime === 'cursor'
    ? '---\ndescription: Route reproducible Agent Skill defects through SkillHone\nalwaysApply: true\n---\n\n'
    : ''
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : prefix
  const start = existing.indexOf(routingStart)
  const end = existing.indexOf(routingEnd)
  let next: string
  let status: string
  if (start >= 0 && end >= start) {
    next = `${existing.slice(0, start)}${routingBody}${existing.slice(end + routingEnd.length)}`
    status = next === existing ? 'already-installed' : 'updated'
  } else {
    next = `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${routingBody}\n`
    status = 'installed'
  }
  if (next !== existing) writeFileSync(path, next, 'utf8')
  return { runtime, component: 'routing', path, status }
}

export function installAgentSkills(
  runtime: AgentRuntime,
  options: { sourceRoot?: string; destinations?: Array<{ runtime: Exclude<AgentRuntime, 'all'>; root: string }> } = {},
): WorkRow[] {
  const sourceRoot = options.sourceRoot ?? join(packageRoot(), 'skills')
  const destinations = options.destinations ?? runtimeSkillRoots(runtime)
  const results: WorkRow[] = []
  for (const destination of destinations) {
    mkdirSync(destination.root, { recursive: true })
    for (const name of bundledSkills) {
      const source = join(sourceRoot, name)
      if (!existsSync(join(source, 'SKILL.md'))) throw new Error(`bundled Agent Skill is missing: ${source}`)
      const target = join(destination.root, name)
      if (existsSync(target)) {
        const same = lstatSync(target).isSymbolicLink() && realpathSync(target) === realpathSync(source)
        if (!same) throw new Error(`${destination.runtime} already has ${target}; remove or back it up before installing SkillHone`)
        results.push({ runtime: destination.runtime, skill: name, path: target, status: 'already-installed' })
        continue
      }
      symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
      results.push({ runtime: destination.runtime, skill: name, path: target, status: 'installed' })
    }
    results.push(installRouting(destination.runtime, destination.root))
  }
  return results
}
