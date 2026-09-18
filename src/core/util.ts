import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Row = Record<string, unknown>

export const now = (): string => new Date().toISOString()
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')

export function redact(value: unknown): string {
  let text = String(value ?? '')
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_SECRET]')
  text = text.replace(
    /((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?)([^\s"',}]{8,})/gi,
    '$1[REDACTED_SECRET]',
  )
  text = text.replace(
    /([?&](?:api[_-]?key|key|token)=)([^&\s"']{8,})/gi,
    '$1[REDACTED_SECRET]',
  )
  text = text.replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
  return text
}

export function run(command: string, args: string[], cwd?: string, check = true): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (check && result.status !== 0) {
    throw new Error(redact(result.stderr || `${command} ${args.join(' ')} failed`))
  }
  return String(result.stdout ?? '').trim()
}

export function gitRoot(path = '.'): string {
  const root = run('git', ['rev-parse', '--show-toplevel'], path)
  return realpathSync(resolve(root))
}

export function projectId(root: string): string {
  return `${root.split('/').filter(Boolean).at(-1) ?? 'skill'}-${sha256(root).slice(0, 12)}`
}

export function slug(value: string, limit = 80): string {
  const result = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!result) throw new Error('name must contain a letter or number')
  return result.slice(0, limit)
}
