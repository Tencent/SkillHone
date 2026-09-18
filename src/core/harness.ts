import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { credentialStorePresent, harnessHome, harnessRoot, loadSettings, modelConfigured } from './settings.js'
import { redact, run } from './util.js'

const registry = 'https://registry.npmjs.org'

function executable(name: string): string | undefined {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
  return result.status === 0 ? String(result.stdout).trim().split(/\r?\n/)[0] : undefined
}

export function installedBinary(home: string): string | undefined {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  const candidate = join(harnessRoot(home), 'node_modules', '.bin', `dsh${suffix}`)
  return existsSync(candidate) ? candidate : undefined
}

export interface HarnessStatus {
  installed: boolean
  version: string | null
  package: string
  model_configured: boolean
  credential_store_present: boolean
}

export function status(home: string): HarnessStatus {
  const binary = installedBinary(home)
  let version: string | null = null
  if (binary) {
    try {
      const value = JSON.parse(readFileSync(join(harnessRoot(home), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')) as { version?: string }
      version = value.version ?? null
    } catch { version = null }
  }
  return {
    installed: Boolean(binary),
    version,
    package: loadSettings(home).harness.package,
    model_configured: modelConfigured(home),
    credential_store_present: credentialStorePresent(home),
  }
}

export function environment(home: string): NodeJS.ProcessEnv {
  return { ...process.env, npm_config_registry: registry, DSH_HOME: harnessHome(home) }
}

export function install(home: string): HarnessStatus {
  const pnpm = executable('pnpm')
  const npm = executable('npm')
  if (!pnpm && !npm) throw new Error('Node.js with pnpm or npm is required to install DeepSeek Harness')
  // --allow-build was introduced in pnpm 10.4. Older versions reject it.
  const version = pnpm ? spawnSync(pnpm, ['--version'], { encoding: 'utf8', timeout: 10_000 }) : undefined
  const match = version?.status === 0 ? version.stdout.trim().match(/^(\d+)\.(\d+)\./) : null
  const compatiblePnpm = pnpm && match && (Number(match[1]) > 10 || (Number(match[1]) === 10 && Number(match[2]) >= 4)) ? pnpm : undefined
  const installer = compatiblePnpm ?? npm
  if (!installer) throw new Error('DeepSeek Harness requires pnpm >=10.4 or npm; the detected pnpm cannot approve dependency builds')
  const root = harnessRoot(home)
  mkdirSync(root, { recursive: true })
  const packageName = loadSettings(home).harness.package
  const args = compatiblePnpm ? [
    'add', '--dir', root, '--save-prod',
    '--allow-build=@deepseek-ai/dsh-subprocess-local',
    '--allow-build=@google/genai',
    '--allow-build=koffi',
    '--allow-build=node-pty',
    '--allow-build=protobufjs',
    packageName,
  ] : ['install', '--prefix', root, '--no-audit', '--no-fund', packageName]
  const result = spawnSync(installer, args, {
    encoding: 'utf8', env: environment(home),
  })
  if (result.status !== 0) throw new Error(`DeepSeek Harness installation failed: ${redact(result.stderr || result.stdout).slice(-1200)}`)
  const binary = installedBinary(home)
  if (!binary) throw new Error('DeepSeek Harness installed without a dsh launcher')
  run(binary, ['--version'], undefined, true)
  return status(home)
}

export function repairPrompt(issue: Record<string, unknown>, root: string, tests: Record<string, unknown>[] = []): string {
  const testPlan = tests.length ? `\n\nIssue-linked tests that must pass before review:\n${tests.map(item => `- ${item.command}`).join('\n')}` : ''
  return `DeepSeek Harness: fix SkillHone local Issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}\n\n` +
    `Work only in ${root}. Reproduce the defect, make one focused fix, and add tests under ` +
    '.test/ when they should stay hidden from normal skill behavior. Run the relevant tests ' +
    'with generated Python bytecode disabled, remove generated caches such as __pycache__ and ' +
    `.pytest_cache, and commit the result on the current branch. Leave the working tree clean. ` +
    `The Issue, Run, PR, and Wiki audit trail is owned by the SkillHone host: do not invoke ` +
    `SkillHone commands or read, edit, close, or delete its records. Do not merge or push anything.${testPlan}`
}

function repairEnvironment(home: string, cwd: string, isolatedHome: string): NodeJS.ProcessEnv {
  const env = environment(home)
  delete env.SKILLHONE_HOME
  delete env.SKILLHONE_PROJECT
  const gitValue = (key: string): string | undefined => {
    const result = spawnSync('git', ['config', '--get', key], { cwd, encoding: 'utf8' })
    const value = result.status === 0 ? String(result.stdout).trim() : ''
    return value || undefined
  }
  const name = gitValue('user.name'), email = gitValue('user.email')
  return {
    ...env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, '.config'),
    XDG_DATA_HOME: join(isolatedHome, '.local', 'share'),
    ...(name ? { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name } : {}),
    ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}),
  }
}

export function runRepair(prompt: string, cwd: string, home: string, logPath: string, timeoutMs = 20 * 60_000): number {
  const binary = installedBinary(home)
  if (!binary) throw new Error('DeepSeek Harness optimizer is not installed; run `skillhone setup --with-harness`')
  const isolatedHome = mkdtempSync(join(tmpdir(), 'skillhone-runner-home-'))
  const result = (() => {
    try {
      return spawnSync(binary, ['--profile', 'headless', prompt], {
        cwd,
        env: {
          ...repairEnvironment(home, cwd, isolatedHome),
          DSH_PERMISSION_MODE: 'workspace-write', DSH_TOOLS_MODE: 'native',
        },
        encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
      })
    } finally { rmSync(isolatedHome, { recursive: true, force: true }) }
  })()
  writeFileSync(logPath, redact(`${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`), { mode: 0o600 })
  return result.status ?? 1
}

export interface ExplorationResult {
  code: number
  summary: string
}

export function runExploration(
  prompt: string,
  cwd: string,
  home: string,
  logPath: string,
  options: { allowReferenceDownloads?: boolean } = {},
): ExplorationResult {
  const binary = installedBinary(home)
  if (!binary) throw new Error('DeepSeek Harness optimizer is not installed; run `skillhone setup --with-harness`')
  const isolatedHome = mkdtempSync(join(tmpdir(), 'skillhone-explorer-home-'))
  const result = (() => {
    try {
      return spawnSync(binary, ['--profile', 'headless', prompt], {
        cwd,
        env: {
          ...repairEnvironment(home, cwd, isolatedHome),
          DSH_PERMISSION_MODE: options.allowReferenceDownloads ? 'workspace-write' : 'read-only',
          DSH_TOOLS_MODE: 'native',
        },
        encoding: 'utf8', timeout: 2 * 60_000, maxBuffer: 64 * 1024 * 1024,
      })
    } finally { rmSync(isolatedHome, { recursive: true, force: true }) }
  })()
  const stdout = redact(String(result.stdout ?? ''))
  const stderr = redact(String(result.stderr ?? ''))
  writeFileSync(logPath, `${stdout}${stderr}`, { mode: 0o600 })
  return { code: result.status ?? 1, summary: stdout.trim().slice(-6000) }
}

export function runWeb(home: string, cwd: string, port: number): number {
  const binary = installedBinary(home)
  if (!binary) throw new Error('DeepSeek Harness optimizer is not installed; run `skillhone setup --with-harness`')
  const result = spawnSync(binary, ['--profile', 'web', '--host', '127.0.0.1', '--port', String(port)], {
    cwd, env: environment(home), stdio: 'inherit',
  })
  return result.status ?? 1
}

export interface HarnessFailure { kind: string; message: string; action: string }

export function diagnoseFailure(output: string): HarnessFailure {
  if (/tool_calls[^\n]*id is duplicate|duplicate[^\n]*(tool.?call|call.?id)/i.test(output)) return {
    kind: 'tool-call-protocol',
    message: 'The model provider rejected duplicate tool-call IDs during a tool round trip.',
    action: 'Check the configured provider protocol for compatibility with Harness, then run `skillhone doctor --probe` before retrying. SkillHone has not changed the model or protocol.',
  }
  if (/ETIMEDOUT|timed? out/i.test(output)) return {
    kind: 'harness-timeout', message: 'Harness exceeded the execution timeout.',
    action: 'Check provider availability and response latency before retrying.',
  }
  if (/missing[^\n]*(api.?key|credential)|(?:api.?key|credential|environment variable)[^\n]*(?:missing|not (?:set|found)|required)|unauthorized|please auth first|authentication failed/i.test(output)) return {
    kind: 'authentication', message: 'Harness could not authenticate with the configured provider.',
    action: 'Make the provider credential available in this shell or Harness credential storage, then run `skillhone doctor --probe`.',
  }
  return {
    kind: 'harness-failed', message: 'Harness execution failed; inspect Harness session logs (and the run log for repairs).',
    action: 'Check the Harness configuration and run `skillhone doctor --probe` before retrying.',
  }
}

export interface ProbeResult { ok: boolean; exit_code: number; failure?: HarnessFailure }

export function probe(home: string): ProbeResult {
  const configured = status(home)
  if (!configured.installed || !configured.model_configured) return {
    ok: false, exit_code: 1, failure: {
      kind: 'not-configured', message: 'Harness and a default model are required for the probe.',
      action: 'Install Harness and configure a model before running `skillhone doctor --probe`.',
    },
  }
  const workspace = mkdtempSync(join(tmpdir(), 'skillhone-probe-'))
  try {
    const first = randomBytes(24).toString('hex'), second = randomBytes(24).toString('hex')
    writeFileSync(join(workspace, 'challenge-1.txt'), `${first}\nNext file: challenge-2.txt\n`)
    writeFileSync(join(workspace, 'challenge-2.txt'), `${second}\n`)
    const result = spawnSync(installedBinary(home)!, ['--profile', 'headless',
      'Read challenge-1.txt using a native file tool. After receiving its result, use a second tool call to read the next file named there. Return the two challenge values in your final answer. Do not modify any files or use network tools.'], {
      cwd: workspace, env: { ...environment(home), DSH_PERMISSION_MODE: 'read-only', DSH_TOOLS_MODE: 'native' },
      encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error?.message ?? ''}`
    if (result.status !== 0) return { ok: false, exit_code: result.status ?? 1, failure: diagnoseFailure(output) }
    if (!result.stdout.includes(first) || !result.stdout.includes(second)) return {
      ok: false, exit_code: 1, failure: {
        kind: 'tool-roundtrip-unverified', message: 'Harness exited without returning the file challenges.',
        action: 'Check native tool support and the provider protocol; a text-only reply does not verify tool execution.',
      },
    }
    return { ok: true, exit_code: 0 }
  } finally { rmSync(workspace, { recursive: true, force: true }) }
}
