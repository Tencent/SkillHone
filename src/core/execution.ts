import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { status as harnessStatus } from './harness.js'
import { executorMode, executorPolicy, type MergeMode } from './settings.js'
import { type Tracker, type WorkRow } from './tracker.js'
import { sha256 } from './util.js'

export function selectedExecutor(home: string, project?: string, requested?: string): 'native' | 'dsh' {
  const mode = requested === undefined ? executorPolicy(home, project).mode : executorMode(requested)
  return mode === 'dsh' ? 'dsh' : 'native'
}

export function executorStatus(home: string, project?: string, requested?: string): WorkRow {
  const configured = requested === undefined ? executorPolicy(home, project).mode : executorMode(requested)
  const selected = selectedExecutor(home, project, requested)
  if (selected === 'native') return {
    configured, requested: configured, selected, mode: 'attached', state: 'idle', available: true,
    ready_for_assignment: true, ready_for_autonomous_execution: false,
    audit_boundary: 'trusted-host-session', hidden_eval_isolation: false,
  }
  const harness = harnessStatus(home)
  const available = harness.installed && harness.model_configured
  return {
    configured, requested: configured, selected, mode: 'managed', state: available ? 'idle' : 'unavailable', available,
    ready_for_assignment: available, ready_for_autonomous_execution: available,
    audit_boundary: 'host-locked', hidden_eval_isolation: false,
  }
}

export interface NativeExecution {
  version: 1
  run_id: string
  issue_number: number
  branch: string
  base: string
  base_commit: string
  merge_mode: MergeMode
  audit_boundary: 'trusted-host-session'
  tests: Array<{ path: string; command: string; digest: string }>
}

function manifestPath(tracker: Tracker, id: string): string {
  // Resolve the record before using its host-generated identifier as a filename.
  const record = tracker.runRecord(id)
  if (record.runner !== 'native-agent') throw new Error('execution command requires a native-agent Run')
  return join(tracker.logsDir, `${String(record.id)}.execution.json`)
}

function recordSlug(id: string): string { return `execution-${id.toLowerCase()}` }

export function saveNativeExecution(tracker: Tracker, record: WorkRow, input: Omit<NativeExecution, 'version' | 'run_id' | 'audit_boundary' | 'tests'>): NativeExecution {
  const manifest: NativeExecution = {
    version: 1, run_id: String(record.id), ...input, audit_boundary: 'trusted-host-session',
    tests: tracker.listIssueTests(input.issue_number).map(test => ({
      path: String(test.path), command: String(test.command), digest: sha256(readFileSync(join(tracker.root, String(test.path)))),
    })),
  }
  const text = `${JSON.stringify(manifest, null, 2)}\n`
  mkdirSync(tracker.logsDir, { recursive: true })
  writeFileSync(manifestPath(tracker, manifest.run_id), text, { mode: 0o600 })
  writeFileSync(String(record.log_path), `Native assignment is waiting for the current Agent.\nAudit boundary: trusted-host-session; no cross-command write lock or hidden-evaluation isolation.\n`, { mode: 0o600 })
  tracker.upsertWiki(recordSlug(manifest.run_id), `Native execution ${manifest.run_id}`,
    JSON.stringify({ run_id: manifest.run_id, executor: 'native', event: 'assignment_created', manifest_sha256: sha256(text), audit_boundary: manifest.audit_boundary }),
    manifest.issue_number)
  return manifest
}

export function loadNativeExecution(tracker: Tracker, id: string): NativeExecution {
  const text = readFileSync(manifestPath(tracker, id), 'utf8')
  const receipt = JSON.parse(String(tracker.wiki(recordSlug(id)).body)) as { manifest_sha256?: string }
  if (receipt.manifest_sha256 !== sha256(text)) throw new Error('native execution manifest changed after assignment')
  const manifest = JSON.parse(text) as NativeExecution
  if (manifest.version !== 1 || manifest.run_id !== id) throw new Error('invalid native execution manifest')
  return manifest
}

export function nativeAssignment(tracker: Tracker, manifest: NativeExecution): WorkRow {
  return {
    state: 'waiting_for_current_agent', executor: 'native', run_id: manifest.run_id,
    worktree: tracker.root, branch: manifest.branch, base_commit: manifest.base_commit,
    issue_number: manifest.issue_number, tests: manifest.tests.map(({ path, command }) => ({ path, command })),
    audit_boundary: manifest.audit_boundary, hidden_eval_isolation: false, automatically_started: false,
    completion_args: ['skillhone', '--home', tracker.home, '--repo', tracker.root, 'execution', 'complete', manifest.run_id, '--commit', '<exact-commit-sha>'],
    instructions: 'Use the current Agent to edit and commit the repair on this branch. Do not modify the registered reproduction tests, merge, push, or rewrite SkillHone records. Then request host completion with the exact commit SHA.',
  }
}

export function verifyNativeCandidate(tracker: Tracker, manifest: NativeExecution, candidate: string): void {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(candidate)) throw new Error('--commit must be an exact commit SHA')
  const record = tracker.runRecord(manifest.run_id)
  if (record.status !== 'awaiting_agent') throw new Error('native execution is not awaiting completion; completed or ended Runs cannot be replayed')
  if (record.branch !== manifest.branch || record.issue_number !== manifest.issue_number) throw new Error('native Run no longer matches its assignment')
  if (tracker.listPrs('open').some(pr => pr.issue_number === manifest.issue_number)) throw new Error('native completion cannot use an Issue that already has an open PR')
  if (tracker.issue(manifest.issue_number).status !== 'open') throw new Error('native execution requires an open Issue')
  if (tracker.git(['branch', '--show-current']) !== manifest.branch) throw new Error('native completion requires the assigned branch')
  if (tracker.git(['rev-parse', 'HEAD']) !== candidate || tracker.git(['rev-parse', manifest.branch]) !== candidate) throw new Error('candidate SHA must match the assigned branch and current HEAD')
  if (tracker.git(['rev-parse', manifest.base]) !== manifest.base_commit) throw new Error('default branch changed after assignment; rebase and prepare a new attempt')
  tracker.git(['merge-base', '--is-ancestor', manifest.base_commit, candidate])
  if (candidate === manifest.base_commit) throw new Error('native Agent created no candidate commit')
  if (tracker.git(['status', '--porcelain'])) throw new Error('native Agent left uncommitted changes; no PR was created')
  const tests = tracker.listIssueTests(manifest.issue_number)
  if (tests.length !== manifest.tests.length || tests.some((test, index) => test.path !== manifest.tests[index]?.path || test.command !== manifest.tests[index]?.command)) throw new Error('registered test contract changed after assignment')
  for (const test of manifest.tests) {
    if (sha256(readFileSync(join(tracker.root, test.path))) !== test.digest) throw new Error(`registered reproduction test changed after assignment: ${test.path}`)
  }
}

export function endNativeExecution(tracker: Tracker, id: string, state: 'failed' | 'cancelled', reason: string): WorkRow {
  const manifest = loadNativeExecution(tracker, id)
  if (tracker.runRecord(id).status !== 'awaiting_agent') throw new Error('only an awaiting native execution may be ended')
  const run = tracker.finishRun(id, state)
  tracker.upsertWiki(`execution-${id.toLowerCase()}-result`, `Native execution ${state}`,
    `${state}: ${reason}\nAudit boundary: trusted-host-session.`, manifest.issue_number)
  return run
}
