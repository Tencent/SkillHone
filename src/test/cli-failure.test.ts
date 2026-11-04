import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { setAuditPolicy } from '../core/settings.js'
import { Tracker } from '../core/tracker.js'
import { run } from '../core/util.js'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-cli-failure-'))
  const repo = join(root, 'skill'), home = join(root, 'home')
  mkdirSync(join(repo, '.test'), { recursive: true })
  writeFileSync(join(repo, 'SKILL.md'), '---\nname: public-cli-contract\ndescription: Public regression.\n---\nDemo.\n')
  writeFileSync(join(repo, '.test/repro.mjs'), 'process.exit(0)\n')
  run('git', ['init', '-b', 'main'], repo)
  run('git', ['config', 'user.name', 'Public fixture'], repo)
  run('git', ['config', 'user.email', 'fixture@example.invalid'], repo)
  run('git', ['add', '.'], repo); run('git', ['commit', '-m', 'baseline'], repo)
  const cli = (...args: string[]) => spawnSync(process.execPath, [
    fileURLToPath(new URL('../cli.js', import.meta.url)), '--home', home, '--repo', repo, '--json', ...args,
  ], { cwd: repo, encoding: 'utf8' })
  return { root, repo, home, cli }
}

test('Issue creation validates test inputs before mutating signed records and permits a corrected retry', () => {
  const f = fixture()
  try {
    setAuditPolicy(f.home, 'signed')
    const invalid = [
      ['--test-path', '.test/repro.mjs'],
      ['--test-command', 'node .test/repro.mjs'],
      ['--test-path', '.test/missing.mjs', '--test-command', 'node .test/missing.mjs'],
      ['--test-path', '../outside.mjs', '--test-command', 'node outside.mjs'],
      ['--test-path', 'SKILL.md', '--test-command', 'node SKILL.md'],
      ['--test-path', '.test/repro.mjs', '--test-command', '   '],
    ]
    for (const extra of invalid) {
      const result = f.cli('issue', 'create', '--title', 'Public corrected retry', ...extra)
      assert.equal(result.status, 2, result.stderr)
      assert.deepEqual(JSON.parse(f.cli('issue', 'list').stdout), [])
      const tracker = new Tracker(f.repo, f.home)
      try { assert.equal(tracker.auditStatus().integrity, 'verified') }
      finally { tracker.close() }
    }
    const args = ['issue', 'create', '--title', 'Public corrected retry', '--test-path', '.test/repro.mjs', '--test-command', 'node .test/repro.mjs']
    const created = f.cli(...args)
    assert.equal(created.status, 0, created.stderr)
    assert.equal(JSON.parse(created.stdout).created, true)
    const duplicate = f.cli(...args)
    assert.equal(duplicate.status, 0, duplicate.stderr)
    assert.equal(JSON.parse(duplicate.stdout).created, false)
    assert.equal(JSON.parse(duplicate.stdout).number, JSON.parse(created.stdout).number)
    // Review mode can restore a base without the registered test file.
    rmSync(join(f.repo, '.test/repro.mjs'))
    const restoredBaseDuplicate = f.cli(...args)
    assert.equal(restoredBaseDuplicate.status, 0, restoredBaseDuplicate.stderr)
    assert.equal(JSON.parse(restoredBaseDuplicate.stdout).created, false)
    const tracker = new Tracker(f.repo, f.home)
    try {
      assert.equal(tracker.listIssues().length, 1)
      assert.equal(tracker.listIssueTests(1).length, 1)
      assert.equal(tracker.auditStatus().integrity, 'verified')
    } finally { tracker.close() }
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('Issue test CLI exit status agrees with structured verification results', () => {
  const f = fixture()
  try {
    const created = f.cli('issue', 'create', '--title', 'Public pass and fail', '--test-path', '.test/repro.mjs', '--test-command', 'node .test/repro.mjs')
    assert.equal(created.status, 0, created.stderr)
    assert.equal(f.cli('issue', 'test', 'list', '1').status, 0)
    assert.equal(f.cli('issue', 'test', 'add', '1', '--path', '.test/repro.mjs', '--command', 'node .test/repro.mjs').status, 0)
    const passing = f.cli('issue', 'test', 'run', '1')
    assert.equal(passing.status, 0, passing.stderr)
    assert.equal(JSON.parse(passing.stdout).passed, true)
    writeFileSync(join(f.repo, '.test/repro.mjs'), 'process.exit(7)\n')
    const failing = f.cli('issue', 'test', 'run', '1')
    assert.equal(failing.status, 1, failing.stderr)
    assert.equal(JSON.parse(failing.stdout).passed, false)
    assert.equal(JSON.parse(failing.stdout).tests[0].exit_code, 7)
    const persisted = JSON.parse(f.cli('issue', 'test', 'list', '1').stdout)
    assert.equal(persisted[0].status, 'failing')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
