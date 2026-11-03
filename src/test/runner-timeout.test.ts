import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { diagnoseFailure, runRepair } from '../core/harness.js'

function fixture(script: string) {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-runner-timeout-'))
  const home = join(root, 'home'), bin = join(home, 'harness', 'node_modules', '.bin')
  mkdirSync(bin, { recursive: true })
  const binary = join(bin, 'dsh'), log = join(root, 'repair.log')
  writeFileSync(binary, `#!${process.execPath}\n${script}\n`)
  chmodSync(binary, 0o755)
  return { root, home, binary, log }
}

test('repair timeout is a failure even when SIGTERM is handled with exit 0', () => {
  const value = fixture("process.on('SIGTERM', () => { require('node:fs').writeFileSync('terminated', 'exit 0'); process.exit(0) }); setInterval(() => {}, 1000)")
  try {
    assert.equal(runRepair('synthetic offline task', value.root, value.home, value.log, 1000), 124)
    const output = readFileSync(value.log, 'utf8')
    assert.equal(readFileSync(join(value.root, 'terminated'), 'utf8'), 'exit 0')
    assert.match(output, /ETIMEDOUT/)
    assert.equal(diagnoseFailure(output).kind, 'harness-timeout')
  } finally { rmSync(value.root, { recursive: true, force: true }) }
})

test('repair preserves normal success and failure exit codes', () => {
  for (const code of [0, 7]) {
    const value = fixture(`console.log('offline result'); process.exit(${code})`)
    try {
      assert.equal(runRepair('synthetic offline task', value.root, value.home, value.log, 5000), code)
      assert.match(readFileSync(value.log, 'utf8'), /offline result/)
    } finally { rmSync(value.root, { recursive: true, force: true }) }
  }
})

test('repair spawn error remains a nonzero failure', () => {
  const value = fixture('')
  try {
    writeFileSync(value.binary, '#!/nonexistent-skillhone-test-interpreter\n')
    assert.equal(runRepair('synthetic offline task', value.root, value.home, value.log, 1000), 1)
    assert.match(readFileSync(value.log, 'utf8'), /ENOENT/)
  } finally { rmSync(value.root, { recursive: true, force: true }) }
})
