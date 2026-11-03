// Public offline regression: returned completion arguments must retain --home.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const sandbox = mkdtempSync(join(tmpdir(), 'native-assignment-home-'))
const repo = join(sandbox, 'repo'), home = join(sandbox, 'explicit-home')
const cli = resolve('dist/cli.js')
const env = { ...process.env, SKILLHONE_HOME: join(sandbox, 'fallback-home') }
function execute(command, args) {
  const result = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8' })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr + result.stdout)
  return result.stdout.trim()
}
function command(args) { return JSON.parse(execute(process.execPath, [cli, '--home', home, '--repo', repo, '--json', ...args])) }
try {
  mkdirSync(join(repo, '.test'), { recursive: true })
  writeFileSync(join(repo, 'SKILL.md'), '---\nname: public-home-regression\ndescription: Public native completion fixture.\n---\nDemo.\n')
  writeFileSync(join(repo, 'value.txt'), 'broken')
  writeFileSync(join(repo, '.test/repro.mjs'), "import {readFileSync} from 'node:fs';if(readFileSync('value.txt','utf8')!=='fixed')process.exit(1)\n")
  execute('git', ['init', '-b', 'main'])
  execute('git', ['config', 'user.name', 'Public regression'])
  execute('git', ['config', 'user.email', 'fixture@example.invalid'])
  execute('git', ['add', '.']); execute('git', ['commit', '-m', 'baseline'])
  command(['config', 'set', '--executor', 'native', '--trigger', 'immediate', '--merge', 'automatic'])
  const issue = command(['issue', 'create', '--title', 'Retain explicit home', '--body', 'Public fixture', '--test-path', '.test/repro.mjs', '--test-command', 'node .test/repro.mjs'])
  writeFileSync(join(repo, 'value.txt'), 'fixed')
  execute('git', ['add', 'value.txt']); execute('git', ['commit', '-m', 'candidate'])
  const sha = execute('git', ['rev-parse', 'HEAD'])
  const args = issue.optimization.assignment.completion_args.slice(1).map(value => value === '<exact-commit-sha>' ? sha : value)
  execute(process.execPath, [cli, '--json', ...args])
  assert.equal(command(['runs'])[0].status, 'completed')
  assert.equal(command(['pr', 'list'])[0].status, 'merged')
  console.log('PASS: returned argv completes the exact explicit-home assignment without DSH')
} finally { rmSync(sandbox, { recursive: true, force: true }) }
