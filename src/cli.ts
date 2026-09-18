#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { closeSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Catalog, type ImportMode } from './core/catalog.js'
import { installAgentSkills, type AgentRuntime } from './core/agent.js'
import {
  benchmarkStatus, initBenchmark, optimizeBenchmark, recordBenchmarkIssue, runBenchmark,
} from './core/benchmark.js'
import { install as installHarness, installedBinary, diagnoseFailure, probe as probeHarness, repairPrompt, runRepair, runWeb, status as harnessStatus } from './core/harness.js'
import { repairPrBody } from './core/pr-description.js'
import {
  auditPolicy, clearAuditPolicy, clearPolicy, configureHarness, loadSettings, mergePolicy, policy, saveSettings,
  setAuditPolicy, setMergePolicy, setPolicy, type AuditMode, type MergeMode, type TriggerMode,
} from './core/settings.js'
import { Tracker, type WorkRow } from './core/tracker.js'
import { redact, slug } from './core/util.js'
import { serve } from './core/web.js'

const version = '2.0.0-dev.0'

const help = `SkillHone — local Agent-friendly Issue, PR, Wiki, and Skill optimization workflow

Usage: skillhone [--home PATH] [--repo PATH] [--skill NAME] [--json] COMMAND

Commands:
  init [PATH|--from RUNTIME] --mode copy|takeover --merge review|automatic [--audit standard|signed]
                                           Initialize and import Skills with explicit ownership choices
  setup [--with-harness] [--agent RUNTIME]
                                           Initialize SkillHone and connect an Agent
  import PATH --mode copy|takeover        Import one Skill as an isolated Git repository
  import --from RUNTIME --mode copy|takeover
  sync status|apply NAME                  Review or apply a copied Skill back to its source
  skills list|show NAME                    Inspect Skill repositories
  issue create|list|view|close             Record reproducible problems
  issue test add|list|run                  Attach repository-local reproduction tests
  pr create|list|view|merge                Review local repair branches
  wiki create|list|view|update             Keep repository-scoped work records
  retry ISSUE                              Retry a failed repair on a new branch
  optimize ISSUE                           Repair a queued Issue with DeepSeek Harness
  benchmark init|status|run|optimize
                                           Evaluation-driven Issue discovery and repair
  dispatch                                Consume queued repairs serially
  config show|set|reset                    Configure trigger, merge, and optional signed-audit policy
  doctor [--probe]                        Check configuration; optionally verify native tool execution
  harness configure|status|web             Manage optimizer and evaluator models
  runs                                    List optimization trajectories
  status                                  Show local repository state
  web [--port 8790]                        Open the local workbench service

No command pushes or publishes. Local merge follows the configured review or automatic policy.`

type Globals = { home?: string; repo: string; repoSpecified: boolean; skill?: string; json: boolean; command: string; args: string[] }

function parseGlobal(argv: string[]): Globals {
  let home: string | undefined, skill: string | undefined, repo = '.', repoSpecified = false, json = false
  let index = 0
  while (index < argv.length) {
    const value = argv[index]
    if (value === '--json') { json = true; index += 1; continue }
    if (['--home', '--repo', '--skill'].includes(value ?? '')) {
      const next = argv[index + 1]
      if (!next) throw new Error(`${value} requires a value`)
      if (value === '--home') home = next
      if (value === '--repo') { repo = next; repoSpecified = true }
      if (value === '--skill') skill = next
      index += 2; continue
    }
    break
  }
  const command = argv[index] ?? ''
  return { ...(home ? { home } : {}), ...(skill ? { skill } : {}), repo, repoSpecified, json, command, args: argv.slice(index + 1) }
}

function importMode(value: string | undefined): ImportMode | undefined {
  if (value === 'takeover' || value === 'managed') return 'managed'
  if (value === 'copy') return 'copy'
  return undefined
}

function triggerMode(value: string | undefined): TriggerMode | undefined {
  if (value === 'manual') return 'queued'
  if (value === 'queued' || value === 'immediate' || value === 'scheduled') return value
  return undefined
}

function selectedMergeMode(value: string | undefined): MergeMode | undefined {
  if (value === 'review' || value === 'automatic') return value
  return undefined
}

function selectedAuditMode(value: string | undefined): AuditMode | undefined {
  if (value === 'standard' || value === 'signed') return value
  return undefined
}

function option(args: string[], key: string): string | undefined {
  const index = args.indexOf(key)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
  return value
}

function flag(args: string[], key: string): boolean { return args.includes(key) }
function required(args: string[], key: string): string { const value = option(args, key); if (!value) throw new Error(`${key} is required`); return value }
function number(value: string | undefined, label: string): number { const result = Number(value); if (!Number.isInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`); return result }
function positionals(args: string[], valuedOptions: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? ''
    if (valuedOptions.includes(value)) { index += 1; continue }
    if (!value.startsWith('--')) values.push(value)
  }
  return values
}

function emit(value: unknown, asJson: boolean): void {
  if (asJson || !Array.isArray(value)) console.log(JSON.stringify(value, null, 2))
  else for (const item of value as WorkRow[]) {
    if ('skill' in item && 'issue' in item) {
      const optimization = item.optimization as WorkRow | undefined
      const pullRequest = optimization?.pull_request as WorkRow | undefined
      const outcome = item.error ? `failed: ${item.error}`
        : pullRequest ? `PR #${pullRequest.number} ${pullRequest.status}`
          : optimization ? (optimization.exit_code ? 'failed' : 'completed') : 'queued'
      console.log(`${item.skill} Issue #${item.issue} [${outcome}]`)
    }
    else if ('slug' in item) console.log(`${item.slug} ${item.title ?? ''}`)
    else if ('number' in item || 'status' in item) console.log(`#${item.number ?? item.id} [${item.status}] ${item.title ?? item.runner ?? item.name ?? ''}`)
    else console.log(`${item.name ?? item.id} [${item.import_status ?? item.source ?? 'local'}]`)
  }
}

function publicRun(value: WorkRow): WorkRow {
  const copy = { ...value }
  delete copy.log_path
  return copy
}

async function readSecret(): Promise<string> {
  if (!process.stdin.isTTY) return readFileSync(0, 'utf8').trim()
  process.stderr.write('Provider API key (hidden): ')
  const input = process.stdin
  input.setRawMode(true); input.resume(); input.setEncoding('utf8')
  return await new Promise<string>((resolve, reject) => {
    let value = ''
    const finish = (error?: Error): void => {
      input.off('data', onData); input.setRawMode(false); input.pause(); process.stderr.write('\n')
      if (error) reject(error); else resolve(value.trim())
    }
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') { finish(); return }
        if (char === '\u0003') { finish(new Error('Interrupted')); return }
        if (char === '\u007f') value = value.slice(0, -1)
        else value += char
      }
    }
    input.on('data', onData)
  })
}

function withOptimizationLock<T>(tracker: Tracker, work: () => T): T {
  const path = join(tracker.dataDir, 'optimize.lock')
  const acquire = (): number => {
    try {
      const descriptor = openSync(path, 'wx', 0o600)
      writeFileSync(descriptor, `${process.pid}\n`)
      return descriptor
    } catch (error) {
      if (!String(error).includes('EEXIST')) throw error
      const owner = Number(readFileSync(path, 'utf8').trim())
      let alive = Number.isInteger(owner) && owner > 0
      if (alive) try { process.kill(owner, 0) } catch { alive = false }
      if (alive) throw new Error(`another optimization is already running for ${tracker.project().name}`)
      unlinkSync(path)
      return acquire()
    }
  }
  const descriptor = acquire()
  try { return work() }
  finally {
    closeSync(descriptor)
    try { unlinkSync(path) } catch { /* a replaced stale lock must not hide the result */ }
  }
}

function optimizeIssueUnlocked(tracker: Tracker, issueNumber: number, retry = false): WorkRow {
  const issue = tracker.issue(issueNumber)
  if (issue.status !== 'open') throw new Error('optimization requires an open Issue')
  if (tracker.listPrs('open').some(pr => pr.issue_number === issueNumber)) throw new Error('Issue already has an open PR')
  const runs = tracker.listRuns().filter(run => run.issue_number === issueNumber)
  if (runs.some(run => run.status === 'running')) throw new Error('Issue already has a running optimization')
  const previous = runs[0]
  if (retry && (!previous || previous.status !== 'failed' || previous.runner !== 'deepseek-harness')) {
    throw new Error('retry requires the latest runtime repair to have failed')
  }
  const tests = tracker.listIssueTests(issueNumber)
  const selectedMerge = mergePolicy(tracker.home, String(tracker.project().id))
  if (!tests.length) throw new Error('Issue must have at least one linked reproduction test before optimization')
  const canonicalBranch = `skillhone/issue-${issueNumber}-${slug(String(issue.title), 36)}`
  let branch = canonicalBranch
  if (retry) {
    let attempt = 2
    do { branch = `${canonicalBranch}-retry-${attempt++}` }
    while (tracker.git(['rev-parse', '--verify', `refs/heads/${branch}`], false))
    if (!tracker.git(['rev-parse', '--verify', `refs/heads/${previous!.branch}`], false)) throw new Error('previous repair branch is missing; restore it before retrying')
  }
  tracker.cleanupGeneratedArtifacts()
  const changedPaths = [
    tracker.git(['diff', '--name-only', '-z'], false),
    tracker.git(['diff', '--cached', '--name-only', '-z'], false),
    tracker.git(['ls-files', '--others', '--exclude-standard', '-z'], false),
  ].flatMap(value => value.split('\0').filter(Boolean))
  const linkedTestPaths = new Set(tests.map(item => String(item.path)))
  const unrelatedChanges = [...new Set(changedPaths)].filter(path => !linkedTestPaths.has(path))
  if (unrelatedChanges.length) {
    throw new Error(`working tree has changes unrelated to Issue tests: ${unrelatedChanges.join(', ')}`)
  }
  if (tracker.git(['rev-parse', '--verify', branch], false)) throw new Error(`optimization branch already exists: ${branch}; use skillhone retry ${issueNumber} after resolving the failure`)
  const base = tracker.project().default_branch
  tracker.git(['checkout', '-b', branch, retry ? `refs/heads/${previous!.branch}` : base])
  const record = tracker.startRun(issueNumber, 'deepseek-harness', branch)
  let code: number
  try {
    code = tracker.protectAuditTrail(() => runRepair(
      repairPrompt(issue, tracker.root, tests), tracker.root, tracker.home, String(record.log_path),
    ))
  }
  catch (error) { tracker.finishRun(String(record.id), 'failed'); throw error }
  const finished = tracker.finishRun(String(record.id), code === 0 ? 'completed' : 'failed')
  if (code !== 0) return { run: publicRun(finished), exit_code: code, failure: diagnoseFailure(readFileSync(String(record.log_path), 'utf8')), retry: `skillhone retry ${issueNumber}` }
  tracker.cleanupGeneratedArtifacts()
  const verification = tracker.runIssueTests(issueNumber)
  if (!verification.passed) {
    tracker.finishRun(String(record.id), 'failed')
    return { run: publicRun(tracker.runRecord(String(record.id))), tests: verification.tests, exit_code: 1 }
  }
  const ahead = tracker.git(['rev-list', '--count', `${base}..${branch}`])
  if (ahead === '0') {
    tracker.finishRun(String(record.id), 'failed')
    throw new Error('DeepSeek Harness exited successfully but created no commit')
  }
  if (tracker.git(['status', '--porcelain'])) {
    tracker.finishRun(String(record.id), 'failed')
    throw new Error('DeepSeek Harness left uncommitted changes; no PR was created')
  }
  const pr = tracker.createPr({
    title: `Fix #${issueNumber}: ${String(issue.title)}`, head: branch, base,
    issueNumber, body: repairPrBody({
      issueNumber, issueTitle: String(issue.title), runner: 'DeepSeek Harness', runId: String(finished.id),
      diff: tracker.git(['diff', '--name-status', `${base}...${branch}`], false),
      commitCount: Number(ahead), tests: verification.tests, mergeMode: selectedMerge.mode,
    }),
  })
  let wiki = tracker.upsertWiki(
    `issue-${issueNumber}-repair`, `Repair record: ${String(issue.title)}`,
    `Issue #${issueNumber}: ${String(issue.title)}\n\nDeepSeek Harness completed run ${finished.id} on branch ${branch}.\n` +
    (selectedMerge.mode === 'automatic'
      ? `Local PR #${pr.number} passed its gates and is authorized for automatic local merge.\nNo push was performed.`
      : `Local PR #${pr.number} is open for review.\nNo push or merge was performed.`),
    issueNumber, Number(pr.number),
  )
  if (selectedMerge.mode === 'automatic') {
    const merged = tracker.mergePr(Number(pr.number), true)
    wiki = tracker.upsertWiki(
      `issue-${issueNumber}-repair`, `Repair record: ${String(issue.title)}`,
      `Issue #${issueNumber}: ${String(issue.title)}\n\nDeepSeek Harness completed run ${finished.id} on branch ${branch}.\n` +
      `Local PR #${pr.number} passed all linked tests and was merged locally by the saved automatic policy.\nNo push was performed.`,
      issueNumber, Number(pr.number),
    )
    return { run: publicRun(finished), pull_request: merged, wiki, merge_policy: selectedMerge }
  }
  // Review mode must leave the runtime on the approved base revision. This is
  // especially important for takeover imports, where Agent runtimes use the
  // managed repository through a symlink and must not observe an open PR.
  tracker.git(['checkout', base])
  return { run: publicRun(finished), pull_request: pr, wiki, merge_policy: selectedMerge }
}

export function optimizeIssue(tracker: Tracker, issueNumber: number, retry = false): WorkRow {
  return withOptimizationLock(tracker, () => optimizeIssueUnlocked(tracker, issueNumber, retry))
}

function guide(home: string): string[] {
  const harness = harnessStatus(home)
  return [
    ...(!harness.installed ? ['Run `skillhone setup --with-harness` to install the optional optimizer.'] : []),
    ...(!harness.model_configured ? ['Run `skillhone harness configure --provider deepseek --model <model>` or configure a default model in Harness.'] : []),
    'Run `skillhone doctor --probe` to verify model access and native tool execution. Configuration alone does not verify connectivity.',
  ]
}

const agentRuntimes = new Set<AgentRuntime>(['codex', 'cursor', 'claude-code', 'pi', 'zcode', 'all'])

function selectedAgent(args: string[]): AgentRuntime | undefined {
  const agent = option(args, '--agent') as AgentRuntime | undefined
  if (agent && !agentRuntimes.has(agent)) throw new Error('--agent must be codex, cursor, claude-code, pi, zcode, or all')
  return agent
}

function executeInit(global: Globals, catalog: Catalog): number {
  const runtime = option(global.args, '--from')
  const positional = positionals(global.args, ['--from', '--name', '--mode', '--merge', '--audit', '--trigger', '--interval-minutes', '--agent'])
  if (runtime && positional.length) throw new Error('provide either a Skill path or --from codex|cursor|claude-code|pi|zcode|all')
  const requestedMode = option(global.args, '--mode')
  const mode = importMode(requestedMode)
  const merge = selectedMergeMode(option(global.args, '--merge'))
  const audit = selectedAuditMode(option(global.args, '--audit') ?? 'standard')
  if (!mode || !merge) {
    emit({
      initialized: false,
      choice_required: [
        ...(!mode ? [{
          field: 'mode',
          options: [
            { value: 'takeover', effect: 'Back up the current Skill and link the runtime to ~/.skillhone/skills; merged fixes are usable immediately.' },
            { value: 'copy', effect: 'Keep the current Skill untouched; after merge, run sync apply to copy the fix back.' },
          ],
        }] : []),
        ...(!merge ? [{
          field: 'merge',
          options: [
            { value: 'review', effect: 'Leave every successful local PR in the approval inbox until the user merges it.' },
            { value: 'automatic', effect: 'Merge a local PR automatically only after its linked tests pass; never push it.' },
          ],
        }] : []),
      ],
    }, global.json)
    return 2
  }
  if (!audit) throw new Error('--audit must be standard or signed')
  if (runtime && !agentRuntimes.has(runtime as AgentRuntime)) throw new Error('--from must be codex, cursor, claude-code, pi, zcode, or all')
  const configuredTrigger = triggerMode(option(global.args, '--trigger') ?? 'queued')
  if (!configuredTrigger) throw new Error('--trigger must be queued, immediate, or scheduled')
  const settings = loadSettings(catalog.home); saveSettings(catalog.home, settings)
  const agent = selectedAgent(global.args)
  const source = positional[0] ?? global.repo
  const selectedAudit = setAuditPolicy(catalog.home, audit)
  const skills = runtime ? catalog.importRuntime(runtime, mode) : [catalog.importPath(source, option(global.args, '--name'), 'path', mode)]
  if (audit === 'signed') for (const skill of skills) {
    const tracker = catalog.tracker(String(skill.id))
    try { tracker.auditStatus() } finally { tracker.close() }
  }
  emit({
    home: catalog.home,
    import_mode: requestedMode === 'takeover' ? 'takeover' : mode,
    trigger: setPolicy(catalog.home, configuredTrigger, Number(option(global.args, '--interval-minutes') ?? 60)),
    merge: setMergePolicy(catalog.home, merge),
    audit: selectedAudit,
    skills,
    harness: flag(global.args, '--with-harness') ? installHarness(catalog.home) : harnessStatus(catalog.home),
    ...(agent ? { agent_skills: installAgentSkills(agent) } : {}),
  }, global.json)
  return 0
}

function executeSetup(global: Globals, catalog: Catalog): number {
  const settings = loadSettings(catalog.home); saveSettings(catalog.home, settings)
  const agent = selectedAgent(global.args)
  emit({
    home: catalog.home,
    trigger: policy(catalog.home),
    merge: mergePolicy(catalog.home),
    harness: flag(global.args, '--with-harness') ? installHarness(catalog.home) : harnessStatus(catalog.home),
    ...(agent ? { agent_skills: installAgentSkills(agent) } : {}),
    configuration: guide(catalog.home),
  }, global.json)
  return 0
}

function executeDoctor(global: Globals, catalog: Catalog): number {
  const harness = harnessStatus(catalog.home)
  const probe = flag(global.args, '--probe') ? probeHarness(catalog.home) : undefined
  emit({
    ok: probe?.ok ?? true, ready_for_optimization: harness.installed && harness.model_configured && (probe?.ok ?? true),
    connectivity_verified: probe?.ok ?? false, ...(probe ? { probe } : {}),
    node: { available: true, version: process.version }, harness,
    trigger: policy(catalog.home), merge: mergePolicy(catalog.home), audit: auditPolicy(catalog.home), configuration: guide(catalog.home),
  }, global.json)
  return probe && !probe.ok ? 1 : 0
}

function executeImport(global: Globals, catalog: Catalog): number {
  const runtime = option(global.args, '--from')
  const path = positionals(global.args, ['--from', '--name', '--mode'])[0]
  if (Boolean(path) === Boolean(runtime)) throw new Error('provide either a skill path or --from codex|cursor|claude-code|pi|zcode|all')
  const mode = importMode(option(global.args, '--mode'))
  if (!mode) throw new Error('ask the user to choose --mode copy or takeover before importing')
  emit(runtime ? catalog.importRuntime(runtime, mode) : catalog.importPath(String(path), option(global.args, '--name'), 'path', mode), global.json)
  return 0
}

function executeSync(global: Globals, catalog: Catalog): number {
  const action = global.args[0]
  const identifier = global.args.find((value, index) => index > 0 && !value.startsWith('--')) ?? global.skill
  if (action === 'status') emit(catalog.syncStatus(identifier), global.json)
  else if (action === 'apply') {
    if (!identifier) throw new Error('sync apply requires a Skill name')
    emit(catalog.applyToOrigins(identifier), global.json)
  } else throw new Error('sync requires status or apply')
  return 0
}

function executeSkills(global: Globals, catalog: Catalog): number {
  const action = global.args[0]
  emit(action === 'list' ? catalog.listSkills(true) : catalog.skill(global.args[1] ?? global.skill ?? '', true), global.json)
  return 0
}

async function executeWeb(global: Globals, catalog: Catalog): Promise<number> {
  // `--repo` is an explicit request to open this repository in the shared
  // workbench. Register it by reference so the dashboard is useful even when
  // the user has not imported the Skill into the managed catalog.
  if (global.repoSpecified) catalog.register(global.repo, 'workbench')
  await serve(catalog, '127.0.0.1', Number(option(global.args, '--port') ?? 8790), flag(global.args, '--open'))
  return 0
}

async function executeHarness(global: Globals, catalog: Catalog): Promise<number> {
  const action = global.args[0]
  if (action === 'status') emit({ ...harnessStatus(catalog.home), configuration: guide(catalog.home) }, global.json)
  else if (action === 'configure') {
    if (!installedBinary(catalog.home)) throw new Error('DeepSeek Harness optimizer is not installed; run `skillhone setup --with-harness`')
    const provider = option(global.args, '--provider') ?? 'deepseek'
    const model = required(global.args, '--model')
    const role = option(global.args, '--role') ?? 'optimizer'
    if (role !== 'optimizer' && role !== 'evaluator') throw new Error('harness role must be optimizer or evaluator')
    const secret = await readSecret()
    emit(configureHarness(catalog.home, {
      role, provider, model, secret,
      ...(option(global.args, '--base-url') ? { baseUrl: option(global.args, '--base-url') } : {}),
      ...(option(global.args, '--protocol') ? { protocol: option(global.args, '--protocol') } : {}),
    }), global.json)
  } else if (action === 'web') return runWeb(catalog.home, global.repo, Number(option(global.args, '--port') ?? 3080))
  else throw new Error('harness requires configure, status, or web')
  return 0
}

function selectedProject(global: Globals, catalog: Catalog): string | undefined {
  if (!global.skill && !global.repoSpecified) return undefined
  const tracker = global.skill ? catalog.tracker(global.skill) : new Tracker(global.repo, global.home)
  try { return String(tracker.project().id) } finally { tracker.close() }
}

function executeConfigSet(global: Globals, catalog: Catalog, project: string | undefined): void {
  const requestedTrigger = option(global.args, '--trigger')
  const requestedMerge = option(global.args, '--merge')
  const requestedAudit = option(global.args, '--audit')
  if (!requestedTrigger && !requestedMerge && !requestedAudit) throw new Error('config set requires --trigger, --merge, or --audit')
  const selectedTrigger = requestedTrigger ? triggerMode(requestedTrigger) : undefined
  const selectedMerge = requestedMerge ? selectedMergeMode(requestedMerge) : undefined
  const selectedAudit = requestedAudit ? selectedAuditMode(requestedAudit) : undefined
  if (requestedTrigger && !selectedTrigger) throw new Error('--trigger must be queued, immediate, or scheduled')
  if (requestedMerge && !selectedMerge) throw new Error('--merge must be review or automatic')
  if (requestedAudit && !selectedAudit) throw new Error('--audit must be standard or signed')
  const configuredAudit = selectedAudit ? setAuditPolicy(catalog.home, selectedAudit, project) : auditPolicy(catalog.home, project)
  if (selectedAudit === 'signed') {
    const trackers = project
      ? [global.skill ? catalog.tracker(global.skill) : new Tracker(global.repo, global.home)]
      : catalog.listSkills().map(item => catalog.tracker(String(item.id)))
    for (const tracker of trackers) try { tracker.auditStatus() } finally { tracker.close() }
  }
  emit({
    trigger: selectedTrigger ? setPolicy(catalog.home, selectedTrigger, Number(option(global.args, '--interval-minutes') ?? 60), project) : policy(catalog.home, project),
    merge: selectedMerge ? setMergePolicy(catalog.home, selectedMerge, project) : mergePolicy(catalog.home, project),
    audit: configuredAudit,
  }, global.json)
}

function executeConfig(global: Globals, catalog: Catalog): number {
  const action = global.args[0]
  const project = selectedProject(global, catalog)
  if (action === 'show') emit({ trigger: policy(catalog.home, project), merge: mergePolicy(catalog.home, project), audit: auditPolicy(catalog.home, project) }, global.json)
  else if (action === 'set') executeConfigSet(global, catalog, project)
  else if (action === 'reset' && project) emit({ trigger: clearPolicy(catalog.home, project), audit: clearAuditPolicy(catalog.home, project) }, global.json)
  else if (action === 'reset') throw new Error('global trigger policy cannot be reset; set it explicitly')
  else throw new Error('config requires show, set, or reset')
  return 0
}

function dispatchTargets(global: Globals, catalog: Catalog): Tracker[] {
  if (global.repoSpecified) return [new Tracker(global.repo, global.home)]
  if (global.skill) return [catalog.tracker(global.skill)]
  return catalog.listSkills().map(item => catalog.tracker(String(item.id)))
}

function dispatchOnce(global: Globals, catalog: Catalog): WorkRow[] {
  const results: WorkRow[] = []
  for (const tracker of dispatchTargets(global, catalog)) try {
    if (policy(catalog.home, tracker.project().id).mode === 'immediate') continue
    for (const issue of tracker.pendingIssues()) {
      try {
        results.push({ skill: tracker.project().name, issue: issue.number, optimization: optimizeIssue(tracker, Number(issue.number)) })
      } catch (error) {
        results.push({
          skill: tracker.project().name, issue: issue.number,
          error: redact(error instanceof Error ? error.message : String(error)),
        })
      }
    }
  } finally { tracker.close() }
  return results
}

async function executeDispatch(global: Globals, catalog: Catalog): Promise<number> {
  if (!flag(global.args, '--watch')) {
    const results = dispatchOnce(global, catalog)
    emit(results, global.json)
    return results.some(item => item.error || (item.optimization as WorkRow | undefined)?.exit_code) ? 1 : 0
  }
  const minutes = Number(option(global.args, '--interval-minutes') ?? policy(catalog.home).interval_minutes)
  if (!Number.isInteger(minutes) || minutes < 1) throw new Error('dispatch interval must be at least one minute')
  while (true) {
    emit(dispatchOnce(global, catalog), global.json)
    await new Promise(resolve => setTimeout(resolve, minutes * 60_000))
  }
}

function executeIssue(global: Globals, catalog: Catalog, tracker: Tracker): number {
  const [action, reference] = global.args
  if (action === 'create') {
    const result = tracker.createIssue(required(global.args, '--title'), option(global.args, '--body') ?? '')
    const testPath = option(global.args, '--test-path'), testCommand = option(global.args, '--test-command')
    if (Boolean(testPath) !== Boolean(testCommand)) throw new Error('--test-path and --test-command must be provided together')
    if (testPath && testCommand) result.issue.tests = [tracker.addIssueTest(Number(result.issue.number), testPath, testCommand)]
    const automation = policy(catalog.home, tracker.project().id)
    const output: WorkRow = {
      ...result.issue, created: result.created, automation,
      merge_policy: mergePolicy(catalog.home, tracker.project().id),
    }
    if (result.created && automation.mode === 'immediate') output.optimization = optimizeIssue(tracker, Number(result.issue.number))
    emit(output, global.json)
    return (output.optimization as WorkRow | undefined)?.exit_code ? 1 : 0
  } else if (action === 'test') executeIssueTest(global, tracker, reference)
  else if (action === 'list') emit(tracker.listIssues(option(global.args, '--status')), global.json)
  else if (action === 'view') emit(tracker.issueDetail(number(reference, 'issue number')), global.json)
  else if (action === 'close') emit(tracker.closeIssue(number(reference, 'issue number')), global.json)
  else throw new Error('issue requires create, list, view, or close')
  return 0
}

function executeIssueTest(global: Globals, tracker: Tracker, action: string | undefined): void {
  const issueNumber = number(global.args[2], 'issue number')
  if (action === 'add') emit(tracker.addIssueTest(issueNumber, required(global.args, '--path'), required(global.args, '--command')), global.json)
  else if (action === 'list') emit(tracker.listIssueTests(issueNumber), global.json)
  else if (action === 'run') emit(tracker.runIssueTests(issueNumber), global.json)
  else throw new Error('issue test requires add, list, or run')
}

function executePr(global: Globals, tracker: Tracker): void {
  const [action, reference] = global.args
  if (action === 'create') emit(tracker.createPr({
    title: required(global.args, '--title'), head: required(global.args, '--head'),
    ...(option(global.args, '--base') ? { base: option(global.args, '--base') } : {}),
    ...(option(global.args, '--issue') ? { issueNumber: number(option(global.args, '--issue'), 'issue number') } : {}),
    body: option(global.args, '--body') ?? '',
  }), global.json)
  else if (action === 'list') emit(tracker.listPrs(option(global.args, '--status')), global.json)
  else if (action === 'view') emit(tracker.prDetail(number(reference, 'PR number')), global.json)
  else if (action === 'merge') emit(tracker.mergePr(number(reference, 'PR number'), flag(global.args, '--confirm')), global.json)
  else throw new Error('pr requires create, list, view, or merge')
}

function executeWiki(global: Globals, tracker: Tracker): void {
  const [action, reference] = global.args
  if (action === 'create') emit(tracker.createWiki({
    title: required(global.args, '--title'), body: option(global.args, '--body') ?? '',
    ...(option(global.args, '--slug') ? { slug: option(global.args, '--slug') } : {}),
    ...(option(global.args, '--issue') ? { issueNumber: number(option(global.args, '--issue'), 'issue number') } : {}),
    ...(option(global.args, '--pr') ? { prNumber: number(option(global.args, '--pr'), 'PR number') } : {}),
  }), global.json)
  else if (action === 'list') emit(tracker.listWiki(), global.json)
  else if (action === 'view') emit(tracker.wiki(String(reference)), global.json)
  else if (action === 'update') emit(tracker.updateWiki(String(reference), {
    ...(option(global.args, '--title') ? { title: option(global.args, '--title') } : {}),
    ...(option(global.args, '--body') ? { body: option(global.args, '--body') } : {}),
    ...(option(global.args, '--issue') ? { issueNumber: number(option(global.args, '--issue'), 'issue number') } : {}),
    ...(option(global.args, '--pr') ? { prNumber: number(option(global.args, '--pr'), 'PR number') } : {}),
  }), global.json)
  else throw new Error('wiki requires create, list, view, or update')
}

function executeBenchmarkRun(global: Globals, tracker: Tracker): void {
  const split = option(global.args, '--split') ?? 'probe'
  const result = runBenchmark(tracker, split)
  emit({ ...result, issue: split === 'test' ? null : recordBenchmarkIssue(tracker, result) ?? null }, global.json)
}

function executeBenchmarkOptimization(global: Globals, tracker: Tracker): void {
  const maxIterations = Number(option(global.args, '--max-iterations') ?? 1)
  emit(optimizeBenchmark(
    tracker, Number(option(global.args, '--min-improvement') ?? 0.02), maxIterations,
    Number(option(global.args, '--patience') ?? Math.min(2, maxIterations)),
  ), global.json)
}

function executeBenchmark(global: Globals, tracker: Tracker): void {
  const action = global.args[0]
  if (action === 'init') emit(initBenchmark(tracker, required(global.args, '--eval-repo'), option(global.args, '--runner')), global.json)
  else if (action === 'status') emit(benchmarkStatus(tracker), global.json)
  else if (action === 'run') executeBenchmarkRun(global, tracker)
  else if (action === 'optimize') executeBenchmarkOptimization(global, tracker)
  else throw new Error('benchmark requires init, status, run, or optimize')
}

function executeRepositoryCommand(global: Globals, catalog: Catalog): number {
  if (global.command === 'status' && !global.skill && !global.repoSpecified) {
    emit(catalog.dashboard(), global.json)
    return 0
  }
  const tracker = global.skill ? catalog.tracker(global.skill) : new Tracker(global.repo, global.home)
  try {
    if (global.command === 'issue') return executeIssue(global, catalog, tracker)
    else if (global.command === 'pr') executePr(global, tracker)
    else if (global.command === 'wiki') executeWiki(global, tracker)
    else if (global.command === 'optimize' || global.command === 'retry') {
      const result = optimizeIssue(tracker, number(global.args[0], 'issue number'), global.command === 'retry')
      emit(result, global.json)
      return result.exit_code ? 1 : 0
    }
    else if (global.command === 'benchmark') executeBenchmark(global, tracker)
    else if (global.command === 'runs') emit(tracker.listRuns().map(publicRun), global.json)
    else if (global.command === 'status') emit(tracker.dashboard(), global.json)
    else throw new Error(`unknown command: ${global.command}`)
  } finally { tracker.close() }
  return 0
}

type CommandHandler = (global: Globals, catalog: Catalog) => number | Promise<number>

const commandHandlers: Record<string, CommandHandler> = {
  init: executeInit,
  setup: executeSetup,
  doctor: executeDoctor,
  import: executeImport,
  sync: executeSync,
  skills: executeSkills,
  web: executeWeb,
  harness: executeHarness,
  config: executeConfig,
  dispatch: executeDispatch,
}

async function execute(global: Globals): Promise<number> {
  if (!global.command || global.command === 'help' || flag(global.args, '--help')) { console.log(help); return 0 }
  const catalog = new Catalog(global.home)
  try {
    const handler = commandHandlers[global.command]
    return handler ? await handler(global, catalog) : executeRepositoryCommand(global, catalog)
  } finally { catalog.close() }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--version')) { console.log(`skillhone ${version}`); return 0 }
  if (argv.includes('--help') && argv[0] === '--help') { console.log(help); return 0 }
  try { return await execute(parseGlobal(argv)) }
  catch (error) { console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`); return 2 }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await main()
