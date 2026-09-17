import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { main } from '../cli.js'
import { Catalog } from '../core/catalog.js'
import { install } from '../core/harness.js'
import { harnessHome, setPolicy } from '../core/settings.js'
import { Tracker } from '../core/tracker.js'
import { run } from '../core/util.js'

function executable(path: string, script: string): void {
  writeFileSync(path, `#!/bin/sh\nset -e\n${script}\n`); chmodSync(path, 0o755)
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-recovery-'))
  const home = join(root, 'home'), repo = join(root, 'skill')
  mkdirSync(repo)
  writeFileSync(join(repo, 'SKILL.md'), '---\nname: search-fixture\ndescription: test\n---\n')
  run('git', ['init', '-b', 'main'], repo)
  run('git', ['config', 'user.name', 'SkillHone Test'], repo)
  run('git', ['config', 'user.email', 'test@skillhone.local'], repo)
  run('git', ['add', '.'], repo); run('git', ['commit', '-m', 'seed'], repo)
  const bin = join(home, 'harness', 'node_modules', '.bin'); mkdirSync(bin, { recursive: true })
  return { root, home, repo, binary: join(bin, 'dsh') }
}
async function cli(home: string, repo: string, ...args: string[]) {
  const output: string[] = [], errors: string[] = []
  const log = console.log, error = console.error
  console.log = (...values) => output.push(values.join(' '))
  console.error = (...values) => errors.push(values.join(' '))
  try { return { code: await main(['--home', home, '--repo', repo, '--json', ...args]), output: output.join('\n'), errors: errors.join('\n') } }
  finally { console.log = log; console.error = error }
}

test('install falls back from pnpm 9 to npm and retains pnpm 11 build approval flags', () => {
  const value = fixture(), path = process.env.PATH
  try {
    const bin = join(value.root, 'bin'); mkdirSync(bin)
    executable(join(bin, 'pnpm'), '[ "$1" = "--version" ] && { echo 9.15.9; exit 0; }; exit 91')
    executable(join(bin, 'npm'), `printf '%s\\n' "$@" > '${value.root}/installer-args'`)
    executable(value.binary, 'echo test-version')
    process.env.PATH = `${bin}:${path}`
    assert.equal(install(value.home).installed, true)
    assert.match(readFileSync(join(value.root, 'installer-args'), 'utf8'), /^install\n--prefix\n/)
    executable(join(bin, 'pnpm'), `[ "$1" = "--version" ] && { echo 11.19.0; exit 0; }; printf '%s\\n' "$@" > '${value.root}/installer-args'`)
    install(value.home)
    assert.match(readFileSync(join(value.root, 'installer-args'), 'utf8'), /--allow-build=node-pty/)
  } finally { process.env.PATH = path; rmSync(value.root, { recursive: true, force: true }) }
})

test('import permits environment references but rejects literal secrets and secret defaults', () => {
  const value = fixture(), catalog = new Catalog(value.home)
  try {
    const manifest = join(value.repo, 'SKILL.md')
    const prefix = readFileSync(manifest, 'utf8')
    for (const [index, reference] of ['$API_KEY', '${API_KEY}', '${API_KEY:?请设置环境变量}', '${API_KEY?required}', '$LONG_PROVIDER_API_KEY'].entries()) {
      writeFileSync(manifest, `${prefix}\nexport API_KEY="${reference}"\n`)
      assert.doesNotThrow(() => catalog.importPath(value.repo, `reference-${index}`, 'path', 'copy'))
    }
    for (const [index, reference] of ['process.env.PHOENIX_API_KEY', 'process.env["PHOENIX_API_KEY"]'].entries()) {
      writeFileSync(manifest, `${prefix}\nconst client = { apiKey: ${reference} }\n`)
      assert.doesNotThrow(() => catalog.importPath(value.repo, `javascript-reference-${index}`, 'path', 'copy'))
    }
    writeFileSync(manifest, `${prefix}\nconst client = { apiKey: process.env.PHOENIX_API_KEY+literalcredential12345 }\n`)
    assert.throws(() => catalog.importPath(value.repo, 'unsafe-javascript-suffix', 'path', 'copy'), /possible credential/)
    for (const reference of ['literalcredential12345', '${API_KEY:-literalcredential12345}', '${API_KEY:=literalcredential12345}', '${API_KEY}literalcredential12345', '${API_KEY:?sk-abcdefghijklmnopqrstuv}']) {
      writeFileSync(manifest, `${prefix}\nexport API_KEY="${reference}"\n`)
      assert.throws(() => catalog.importPath(value.repo, 'unsafe', 'path', 'copy'), /possible credential/)
    }
  } finally { catalog.close(); rmSync(value.root, { recursive: true, force: true }) }
})

test('failed repairs return failure and explicit retry preserves partial commits and review gates', async () => {
  const value = fixture(), tracker = new Tracker(value.repo, value.home)
  try {
    mkdirSync(join(value.repo, '.test'))
    writeFileSync(join(value.repo, '.test', 'repro.sh'), 'test -f fixed.txt\n')
    tracker.createIssue('Broken search', 'Search failed')
    tracker.addIssueTest(1, '.test/repro.sh', 'sh .test/repro.sh')
    executable(value.binary, 'echo partial > partial.txt\ngit add partial.txt .test\ngit commit -m partial\necho "tool_calls[1] id is duplicate" >&2\nexit 1')
    const failed = await cli(value.home, value.repo, 'optimize', '1')
    assert.equal(failed.code, 1)
    assert.equal(JSON.parse(failed.output).failure.kind, 'tool-call-protocol')
    const first = tracker.listRuns()[0]!
    const firstTip = tracker.git(['rev-parse', String(first.branch)])
    writeFileSync(join(value.repo, 'unrelated.txt'), 'preserve me')
    assert.match((await cli(value.home, value.repo, 'retry', '1')).errors, /unrelated/)
    assert.equal(readFileSync(join(value.repo, 'unrelated.txt'), 'utf8'), 'preserve me')
    rmSync(join(value.repo, 'unrelated.txt'))
    executable(value.binary, 'test -f partial.txt\necho repaired > fixed.txt\ngit add fixed.txt\ngit commit -m repaired')
    const retried = await cli(value.home, value.repo, 'retry', '1')
    assert.equal(retried.code, 0, retried.errors)
    assert.equal(JSON.parse(retried.output).pull_request.status, 'open')
    assert.equal(tracker.listRuns().length, 2)
    assert.equal(tracker.git(['rev-parse', String(first.branch)]), firstTip)
    assert.notEqual(tracker.listRuns()[0]!.branch, first.branch)
    assert.equal(tracker.runIssueTests(1).passed, true)
    assert.equal(tracker.git(['status', '--porcelain']), '')
    assert.equal(tracker.git(['show', 'main:SKILL.md']).includes('fixed.txt'), false)
    assert.match((await cli(value.home, value.repo, 'retry', '1')).errors, /open PR/)
    tracker.closeIssue(1)
    assert.match((await cli(value.home, value.repo, 'retry', '1')).errors, /open Issue/)
  } finally { tracker.close(); rmSync(value.root, { recursive: true, force: true }) }
})

test('doctor probes actual tool output, diagnoses protocol failures, and supports environment credentials', async () => {
  const value = fixture()
  try {
    mkdirSync(harnessHome(value.home), { recursive: true })
    writeFileSync(join(harnessHome(value.home), 'settings.yaml'), 'agent-default-model:\n  provider: test-provider\n  model: test-model\n')
    executable(value.binary, '[ "$DSH_PERMISSION_MODE" = "read-only" ]\n[ "$DSH_TOOLS_MODE" = "native" ]\ncat challenge-1.txt challenge-2.txt')
    const ready = await cli(value.home, value.repo, 'doctor', '--probe')
    assert.equal(ready.code, 0, ready.errors)
    const result = JSON.parse(ready.output)
    assert.equal(result.probe.ok, true)
    assert.equal(result.harness.credential_store_present, false)
    assert.equal(result.configuration.some((line: string) => line.includes('harness configure')), false)
    executable(value.binary, 'echo SKILLHONE_READY')
    const noTools = await cli(value.home, value.repo, 'doctor', '--probe')
    assert.equal(noTools.code, 1)
    assert.equal(JSON.parse(noTools.output).probe.failure.kind, 'tool-roundtrip-unverified')
    executable(value.binary, 'echo "Message format error: tool_calls[2] id is duplicate" >&2\nexit 1')
    const failed = await cli(value.home, value.repo, 'doctor', '--probe')
    assert.equal(failed.code, 1)
    assert.equal(JSON.parse(failed.output).probe.failure.kind, 'tool-call-protocol')
    assert.equal(JSON.parse(failed.output).ready_for_optimization, false)
    assert.equal(existsSync(join(value.repo, 'challenge-1.txt')), false)
  } finally { rmSync(value.root, { recursive: true, force: true }) }
})


test('retry rejects running or missing attempts and failed test gates never create a PR', async () => {
  const value = fixture(), tracker = new Tracker(value.repo, value.home)
  try {
    mkdirSync(join(value.repo, '.test'))
    writeFileSync(join(value.repo, '.test', 'repro.sh'), 'test -f fixed.txt\n')
    tracker.createIssue('Failed gate', 'Reproduction must pass')
    tracker.addIssueTest(1, '.test/repro.sh', 'sh .test/repro.sh')
    assert.match((await cli(value.home, value.repo, 'retry', '1')).errors, /latest runtime repair/)
    const record = tracker.startRun(1, 'deepseek-harness', 'main')
    assert.match((await cli(value.home, value.repo, 'retry', '1')).errors, /running optimization/)
    tracker.finishRun(String(record.id), 'failed')
    executable(value.binary, 'echo incomplete > partial.txt\ngit add partial.txt .test\ngit commit -m incomplete')
    const failed = await cli(value.home, value.repo, 'retry', '1')
    assert.equal(failed.code, 1)
    assert.equal(JSON.parse(failed.output).run.status, 'failed')
    assert.equal(tracker.listPrs().length, 0)
    assert.equal(tracker.issueStage(1), 'failed')
    const branch = tracker.listRuns()[0]!.branch
    tracker.git(['checkout', 'main'])
    tracker.git(['branch', '-D', String(branch)])
    assert.match((await cli(value.home, value.repo, 'retry', '1')).errors, /branch is missing/)
  } finally { tracker.close(); rmSync(value.root, { recursive: true, force: true }) }
})

test('immediate and human-readable dispatch report runner failures as failures', async () => {
  for (const mode of ['immediate', 'queued'] as const) {
    const value = fixture()
    try {
      mkdirSync(join(value.repo, '.test'))
      writeFileSync(join(value.repo, '.test', 'repro.sh'), 'exit 1\n')
      executable(value.binary, 'exit 1')
      setPolicy(value.home, mode, 60)
      const result = await cli(value.home, value.repo, 'issue', 'create', '--title', 'Broken search', '--test-path', '.test/repro.sh', '--test-command', 'sh .test/repro.sh')
      if (mode === 'immediate') assert.equal(result.code, 1)
      else {
        assert.equal(result.code, 0)
        const log = console.log, output: string[] = []
        console.log = (...values) => output.push(values.join(' '))
        try {
          assert.equal(await main(['--home', value.home, '--repo', value.repo, 'dispatch']), 1)
          assert.match(output.join('\n'), /\[failed\]/)
          assert.doesNotMatch(output.join('\n'), /completed/)
        } finally { console.log = log }
      }
    } finally { rmSync(value.root, { recursive: true, force: true }) }
  }
})
