import assert from 'node:assert/strict'
import childProcess, { type SpawnSyncOptions } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { benchmarkStatus, initBenchmark, runBenchmark } from '../core/benchmark.js'
import { Tracker } from '../core/tracker.js'
import { processExitCode, run } from '../core/util.js'

const spawnSync = childProcess.spawnSync

function repository(root: string, name: string) {
  const path = join(root, name)
  mkdirSync(path)
  run('git', ['init', '-b', 'main'], path)
  run('git', ['config', 'user.name', 'SkillHone Test'], path)
  run('git', ['config', 'user.email', 'test@skillhone.local'], path)
  writeFileSync(join(path, 'SKILL.md'), 'Public offline verification fixture\n')
  run('git', ['add', '.'], path); run('git', ['commit', '-m', 'seed'], path)
  return path
}

function intercept(t: TestContext, handler: (args: string[]) => ReturnType<typeof spawnSync>) {
  const mock = t.mock.method(childProcess, 'spawnSync', ((command: string, args: string[] = [], options?: SpawnSyncOptions) => {
    if (args.some(arg => arg.includes('synthetic-verification'))) return handler(args)
    return spawnSync(command, args, options)
  }) as typeof spawnSync)
  syncBuiltinESMExports()
  return () => { mock.mock.restore(); syncBuiltinESMExports() }
}

function timedOut(script = '') {
  const result = spawnSync(process.execPath, ['-e', `process.on('SIGTERM', () => process.exit(0)); ${script}; setInterval(() => {}, 1000)`], {
    encoding: 'utf8', timeout: 700,
  })
  assert.equal(result.status, 0)
  assert.equal((result.error as NodeJS.ErrnoException | undefined)?.code, 'ETIMEDOUT')
  return result
}

test('Issue verification rejects a real timeout even when the child exits 0', t => {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-verification-timeout-'))
  const repo = repository(root, 'skill'), tracker = new Tracker(repo, join(root, 'home'))
  const issue = tracker.createIssue('Synthetic timeout', 'Public offline fixture').issue
  mkdirSync(join(repo, '.test')); writeFileSync(join(repo, '.test/repro.txt'), 'Public fixture\n')
  tracker.addIssueTest(Number(issue.number), '.test/repro.txt', 'synthetic-verification')
  const restore = intercept(t, () => timedOut())
  try {
    const result = tracker.runIssueTests(Number(issue.number))
    assert.equal(result.passed, false)
    assert.equal(result.tests[0]?.status, 'failing')
    assert.equal(result.tests[0]?.exit_code, 124)
    assert.match(String(result.tests[0]?.output), /ETIMEDOUT/)
    assert.equal(tracker.listIssueTests(Number(issue.number))[0]?.status, 'failing')
  } finally { restore(); tracker.close(); rmSync(root, { recursive: true, force: true }) }
})

test('Issue verification preserves normal codes and redacts spawn errors', t => {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-verification-result-'))
  const repo = repository(root, 'skill'), tracker = new Tracker(repo, join(root, 'home'))
  const issue = tracker.createIssue('Synthetic results', 'Public offline fixture').issue
  mkdirSync(join(repo, '.test')); writeFileSync(join(repo, '.test/repro.txt'), 'Public fixture\n')
  tracker.addIssueTest(Number(issue.number), '.test/repro.txt', 'synthetic-verification')
  let result = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { encoding: 'utf8' })
  const restore = intercept(t, () => result)
  try {
    for (const code of [0, 7]) {
      result = spawnSync(process.execPath, ['-e', `process.exit(${code})`], { encoding: 'utf8' })
      const observed = tracker.runIssueTests(Number(issue.number))
      assert.equal(observed.passed, code === 0)
      assert.equal(observed.tests[0]?.exit_code, code)
    }
    result = spawnSync(join(root, 'nonexistent-binary'), [], { encoding: 'utf8' })
    assert.ok(result.error)
    const sentinel = 'public_synthetic_value_12345'
    result.error.message += ` token=${sentinel}`
    const observed = tracker.runIssueTests(Number(issue.number))
    assert.equal(observed.passed, false)
    assert.equal(observed.tests[0]?.exit_code, 1)
    assert.match(String(observed.tests[0]?.output), /ENOENT/)
    assert.equal(String(observed.tests[0]?.output).includes(sentinel), false)
    assert.equal(processExitCode({ status: 0, error: result.error }), 1)
  } finally { restore(); tracker.close(); rmSync(root, { recursive: true, force: true }) }
})

test('Benchmark rejects a timed-out exit-0 evaluator even if it already wrote a valid score', t => {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-benchmark-timeout-'))
  const repo = repository(root, 'skill'), evalRepo = repository(root, 'evaluation')
  writeFileSync(join(evalRepo, 'probe.jsonl'), JSON.stringify({ question: 'Public synthetic fixture', verification: 'synthetic' }) + '\n')
  run('git', ['add', '.'], evalRepo); run('git', ['commit', '-m', 'freeze fixture'], evalRepo)
  const tracker = new Tracker(repo, join(root, 'home'))
  initBenchmark(tracker, evalRepo, 'synthetic-verification {skill} {split} {output}')
  const restore = intercept(t, args => {
    const output = args.at(-1)?.match(/'([^']+)'$/)?.[1]
    assert.ok(output)
    return timedOut(`require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify({score:1,n_total:1,n_passed:1}))`)
  })
  try {
    assert.throws(() => runBenchmark(tracker, 'probe'), /benchmark runner failed for probe \(exit 124\)/)
    assert.deepEqual(benchmarkStatus(tracker).runs, [])
    const results = join(tracker.dataDir, 'benchmark', 'results')
    const log = readdirSync(results).find(name => name.endsWith('.log'))
    assert.ok(log)
    assert.match(readFileSync(join(results, log), 'utf8'), /ETIMEDOUT/)
    assert.ok(readdirSync(results).some(name => name.endsWith('.json')))
    assert.equal(existsSync(join(tracker.dataDir, 'benchmark', 'history.jsonl')), false)
  } finally { restore(); tracker.close(); rmSync(root, { recursive: true, force: true }) }
})
