// Public, isolated CLI failure-contract regression. No real runtime state.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
const cli = resolve('dist/cli.js')
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-cli-contract-'))
  const repo = join(root, 'skill'), home = join(root, 'home')
  mkdirSync(join(repo, '.test'), {recursive:true})
  writeFileSync(join(repo, 'SKILL.md'), '---\nname: public-contract\ndescription: Public CLI regression.\n---\nDemo.\n')
  writeFileSync(join(repo, '.test/repro.mjs'), 'process.exit(7)\n')
  for (const args of [['init','-b','main'], ['config','user.name','Public fixture'], ['config','user.email','fixture@example.invalid'], ['add','.'], ['commit','-m','baseline']]) {
    const r = spawnSync('git',args,{cwd:repo,encoding:'utf8'}); assert.equal(r.status,0,r.stderr)
  }
  const invoke = (...args) => spawnSync(process.execPath,[cli,'--home',home,'--repo',repo,'--json',...args],{cwd:repo,encoding:'utf8'})
  return {root,invoke}
}
test('invalid Issue test arguments must not leave an Issue behind', () => {
  const f = fixture()
  try {
    for (const extra of [['--test-path','.test/repro.mjs'], ['--test-path','.test/missing.mjs','--test-command','node .test/missing.mjs'], ['--test-path','../outside.mjs','--test-command','node outside.mjs']]) {
      const r = f.invoke('issue','create','--title','Public invalid create',...extra)
      assert.notEqual(r.status,0)
      assert.deepEqual(JSON.parse(f.invoke('issue','list').stdout),[], 'Rejected input must not persist an orphan Issue')
    }
    const valid=f.invoke('issue','create','--title','Public invalid create','--test-path','.test/repro.mjs','--test-command','node .test/repro.mjs')
    assert.equal(valid.status,0,valid.stderr)
    assert.equal(JSON.parse(valid.stdout).created,true)
  } finally {rmSync(f.root,{recursive:true,force:true})}
})
test('a failing issue test must return a failing CLI exit status', () => {
  const f = fixture()
  try {
    const created=f.invoke('issue','create','--title','Public failing test','--test-path','.test/repro.mjs','--test-command','node .test/repro.mjs')
    assert.equal(created.status,0,created.stderr)
    const r=f.invoke('issue','test','run',String(JSON.parse(created.stdout).number))
    assert.equal(JSON.parse(r.stdout).passed,false)
    assert.equal(r.status,1,'Shell automation must observe a failed verification')
  } finally {rmSync(f.root,{recursive:true,force:true})}
})
