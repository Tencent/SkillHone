import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  applyManagedHarnessDependencyPolicy,
  managedHarnessDependencyPolicy,
} from '../dist/core/harness-dependencies.js'

const registry = 'https://registry.npmjs.org'
const root = mkdtempSync(join(tmpdir(), 'skillhone-dsh-audit-'))

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: 'inherit',
    env: { ...process.env, npm_config_registry: registry },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? 'unknown status'}`)
}

try {
  applyManagedHarnessDependencyPolicy(root)
  run('pnpm', ['add', '--dir', root, '--save-exact', '--ignore-scripts', `--registry=${registry}`, managedHarnessDependencyPolicy.package])
  const installed = JSON.parse(readFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'))
  const release = `${installed.name}@${installed.version}`
  if (release !== managedHarnessDependencyPolicy.package) {
    throw new Error(`managed Harness release changed: expected ${managedHarnessDependencyPolicy.package}, installed ${release}`)
  }
  run('pnpm', ['--dir', root, 'audit', '--audit-level=low', `--registry=${registry}`])
  run('npm', ['audit', 'signatures', '--prefix', root, `--registry=${registry}`])
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  rmSync(root, { recursive: true, force: true })
}
