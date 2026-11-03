import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'

import { main } from '../cli.js'
import { executorStatus } from '../core/execution.js'
import { executorPolicy, loadSettings, setExecutor, setMergePolicy, setPolicy } from '../core/settings.js'
import { Tracker, type WorkRow } from '../core/tracker.js'
import { run } from '../core/util.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-native-execution-'))
  const repo = join(root, 'demo'), home = join(root, 'home')
  mkdirSync(join(repo, '.test'), { recursive: true })
  writeFileSync(join(repo, 'SKILL.md'), '---\nname: native-demo\ndescription: Public native execution regression\n---\nDemo.\n')
  writeFileSync(join(repo, 'value.txt'), 'broken')
  writeFileSync(join(repo, '.test', 'repro.mjs'), "import {readFileSync} from 'node:fs';if(readFileSync('value.txt','utf8')!=='fixed')process.exit(1)\n")
  run('git', ['init', '-b', 'main'], repo)
  run('git', ['config', 'user.name', 'Native regression'], repo)
  run('git', ['config', 'user.email', 'native@example.invalid'], repo)
  run('git', ['add', '.'], repo); run('git', ['commit', '-m', 'baseline'], repo)
  setPolicy(home, 'immediate', 60); setMergePolicy(home, 'automatic')
  return { root, repo, home }
}

async function invoke(args: string[]) {
  const log = console.log, error = console.error, lines: string[] = [], errors: string[] = []
  console.log = (...values) => { lines.push(values.map(String).join(' ')) }
  console.error = (...values) => { errors.push(values.map(String).join(' ')) }
  try {
    const code = await main(args)
    return { code, output: lines.length ? JSON.parse(String(lines.at(-1))) as WorkRow : {}, error: errors.join('\n') }
  } finally { console.log = log; console.error = error }
}

async function cli(f: { home: string; repo: string }, args: string[]) {
  return invoke(['--home', f.home, '--repo', f.repo, '--json', ...args])
}

async function issue(f: { home: string; repo: string }, extra: string[] = []) {
  const result = await cli(f, ['issue', 'create', '--title', 'Fix public reproduction', '--body', 'The isolated value contract fails.',
    '--test-path', '.test/repro.mjs', '--test-command', 'node .test/repro.mjs', ...extra])
  assert.equal(result.code, 0, result.error)
  return result.output.optimization as WorkRow
}

function commit(repo: string, filename = 'value.txt', contents = 'fixed'): string {
  writeFileSync(join(repo, filename), contents)
  run('git', ['add', '.'], repo); run('git', ['commit', '-m', 'Current Agent candidate'], repo)
  return run('git', ['rev-parse', 'HEAD'], repo)
}

test('Native auto completes an offline current-Agent repair without installing DSH', async () => {
  const f = fixture()
  try {
    assert.equal(existsSync(join(f.home, 'harness')), false)
    const start = await issue(f)
    const assignment = start.assignment as WorkRow, record = start.run as WorkRow
    assert.equal(record.runner, 'native-agent'); assert.equal(record.status, 'awaiting_agent'); assert.equal(record.finished_at, null)
    assert.equal(assignment.state, 'waiting_for_current_agent'); assert.equal(assignment.automatically_started, false)
    assert.equal(assignment.audit_boundary, 'trusted-host-session'); assert.equal(assignment.hidden_eval_isolation, false)
    const sha = commit(f.repo)
    const returnedArgs = (assignment.completion_args as string[]).slice(1).map(value => value === '<exact-commit-sha>' ? sha : value)
    const previousHome = process.env.SKILLHONE_HOME
    process.env.SKILLHONE_HOME = join(f.root, 'fallback-home')
    let completed: Awaited<ReturnType<typeof invoke>>
    try { completed = await invoke(['--json', ...returnedArgs]) }
    finally {
      if (previousHome === undefined) delete process.env.SKILLHONE_HOME
      else process.env.SKILLHONE_HOME = previousHome
    }
    assert.equal(completed.code, 0, completed.error)
    assert.equal((completed.output.pull_request as WorkRow).status, 'merged')
    assert.equal((completed.output.run as WorkRow).status, 'completed')
    assert.match(String((completed.output.pull_request as WorkRow).body), /Current Agent.*trusted-host-session/)
    const replay = await cli(f, ['execution', 'complete', String(record.id), '--commit', sha])
    assert.equal(replay.code, 2); assert.match(replay.error, /cannot be replayed/)
    const tracker = new Tracker(f.repo, f.home)
    try { assert.equal(tracker.issue(1).status, 'closed'); assert.equal(tracker.runRecord(String(record.id)).status, 'completed') }
    finally { tracker.close() }
    assert.equal(existsSync(join(f.home, 'harness')), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('Native completion rejects absent commits, dirty trees, changed tests, and wrong SHAs', async () => {
  const f = fixture()
  try {
    const start = await issue(f), id = String((start.run as WorkRow).id)
    const base = run('git', ['rev-parse', 'HEAD'], f.repo)
    assert.match((await cli(f, ['execution', 'complete', id, '--commit', base])).error, /no candidate commit/)
    writeFileSync(join(f.repo, 'value.txt'), 'fixed')
    assert.match((await cli(f, ['execution', 'complete', id, '--commit', base])).error, /no candidate commit|uncommitted/)
    const sha = commit(f.repo)
    assert.match((await cli(f, ['execution', 'complete', id, '--commit', '0'.repeat(40)])).error, /SHA must match/)
    const changed = commit(f.repo, '.test/repro.mjs', 'process.exit(0)\n')
    assert.match((await cli(f, ['execution', 'complete', id, '--commit', changed])).error, /reproduction test changed/)
    assert.equal((await cli(f, ['execution', 'cancel', id, '--reason', 'Discard invalid candidate later'])).code, 0)
    assert.notEqual(base, sha)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('Failed host tests create no PR and explicit retry and cancellation remain traceable', async () => {
  const f = fixture()
  try {
    const start = await issue(f), id = String((start.run as WorkRow).id)
    const sha = commit(f.repo, 'note.txt', 'does not satisfy reproduction')
    const result = await cli(f, ['execution', 'complete', id, '--commit', sha])
    assert.equal(result.code, 1); assert.equal((result.output.run as WorkRow).status, 'failed')
    const retry = await cli(f, ['retry', '1', '--executor', 'native'])
    assert.equal(retry.code, 0, retry.error)
    const next = retry.output.run as WorkRow
    assert.notEqual(next.id, id); assert.notEqual(next.branch, (start.run as WorkRow).branch)
    assert.equal((await cli(f, ['execution', 'cancel', String(next.id), '--reason', 'Public cancellation test'])).code, 0)
    const tracker = new Tracker(f.repo, f.home)
    try { assert.equal(tracker.listPrs().length, 0); assert.equal(tracker.listRuns().length, 2) }
    finally { tracker.close() }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('Executor selection is explicit, scoped, and native doctor never probes or installs DSH', async () => {
  const f = fixture()
  try {
    const doctor = await cli(f, ['doctor', '--probe'])
    assert.equal(doctor.code, 0); assert.equal(doctor.output.ready_for_optimization, true)
    assert.equal((doctor.output.executor as WorkRow).selected, 'native'); assert.equal(doctor.output.connectivity_verified, false)
    setExecutor(f.home, 'dsh')
    const unavailable = executorStatus(f.home)
    assert.equal(unavailable.selected, 'dsh'); assert.equal(unavailable.available, false)
    const tracker = new Tracker(f.repo, f.home)
    try {
      setExecutor(f.home, 'native', tracker.project().id)
      assert.equal(executorPolicy(f.home, tracker.project().id).scope, 'skill')
      tracker.createIssue('Public explicit executor availability')
      tracker.addIssueTest(1, '.test/repro.mjs', 'node .test/repro.mjs')
    }
    finally { tracker.close() }
    const explicit = await cli(f, ['optimize', '1', '--executor', 'dsh'])
    assert.equal(explicit.code, 2); assert.match(explicit.error, /DSH executor is not installed/)
    assert.equal(existsSync(join(f.home, 'harness')), false)
    const hidden = await cli(f, ['optimize', '1', '--executor', 'native', '--hidden-eval'])
    assert.equal(hidden.code, 2); assert.match(hidden.error, /cannot isolate hidden evaluation/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('Dispatch prepares only one native assignment per repository and refuses duplicate active runs', async () => {
  const f = fixture()
  try {
    setPolicy(f.home, 'queued', 60)
    const tracker = new Tracker(f.repo, f.home)
    try {
      for (const title of ['first issue', 'second issue']) {
        const created = tracker.createIssue(title).issue
        tracker.addIssueTest(Number(created.number), '.test/repro.mjs', 'node .test/repro.mjs')
      }
    } finally { tracker.close() }
    const dispatched = await cli(f, ['dispatch', '--executor', 'native'])
    assert.equal(dispatched.code, 0)
    assert.equal((dispatched.output as unknown as WorkRow[]).length, 1)
    const duplicate = await cli(f, ['optimize', '2', '--executor', 'native'])
    assert.equal(duplicate.code, 2); assert.match(duplicate.error, /active execution/)
    const secondDispatch = await cli(f, ['dispatch', '--executor', 'native'])
    assert.equal(secondDispatch.code, 0); assert.equal((secondDispatch.output as unknown as WorkRow[]).length, 0)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})


test('Existing settings preserve DSH while new homes default to auto and explicit arguments win', async () => {
  const f = fixture()
  try {
    const settingsPath = join(f.home, 'settings.json')
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    delete settings.executor
    writeFileSync(settingsPath, JSON.stringify(settings))
    assert.equal(loadSettings(f.home).executor.default, 'dsh')
    const start = await issue(f, ['--executor', 'native'])
    assert.equal((start.run as WorkRow).runner, 'native-agent')
    const cancel = await cli(f, ['execution', 'cancel', String((start.run as WorkRow).id), '--reason', 'Public explicit selection test'])
    assert.equal(cancel.code, 0)
    assert.equal((await cli(f, ['retry', '1', '--executor', 'native'])).code, 0)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('Native completion rejects a competing PR rather than verifying its other head', async () => {
  const f = fixture()
  try {
    const start = await issue(f), id = String((start.run as WorkRow).id)
    const sha = commit(f.repo)
    const tracker = new Tracker(f.repo, f.home)
    try { tracker.createPr({ title: 'Competing manually prepared PR', issueNumber: 1, head: String((start.run as WorkRow).branch), base: 'main' }) }
    finally { tracker.close() }
    const complete = await cli(f, ['execution', 'complete', id, '--commit', sha])
    assert.equal(complete.code, 2); assert.match(complete.error, /already has an open PR/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('Native benchmark and all attached hidden-evaluation requests are explicitly unsupported', async () => {
  const f = fixture()
  try {
    const benchmark = await cli(f, ['benchmark', 'optimize', '--executor', 'native'])
    assert.equal(benchmark.code, 2); assert.match(benchmark.error, /does not support benchmark optimization/)
    const hiddenDsh = await cli(f, ['optimize', '1', '--executor', 'dsh', '--hidden-eval'])
    assert.equal(hiddenDsh.code, 2); assert.match(hiddenDsh.error, /cannot isolate hidden evaluation/)
    assert.equal(existsSync(join(f.home, 'harness')), false)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
