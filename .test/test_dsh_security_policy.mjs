import assert from 'node:assert/strict'
import {mkdtempSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'
import {install} from '../dist/core/harness.js'

// Applying the security policy must not introduce a new profile/config ReDoS.
// A malformed line may be rejected, but it must finish within a bounded time.
const policy = pathToFileURL(join(process.cwd(), 'dist/core/harness-dependencies.js')).href
for (const expression of [
  "'overrides:' + ' '.repeat(200000) + 'x\\u2028tail'",
  "'overrides:\\n  ' + ' '.repeat(200000) + 'x'",
]) {
  const source = `import {managedHarnessPnpmWorkspace as parse} from ${JSON.stringify(policy)}; try {parse(${expression})} catch {}`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {encoding: 'utf8', timeout: 3000})
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stderr)
}

const home = mkdtempSync(join(tmpdir(), 'skillhone-dsh-security-'))
try {
  const installed = install(home)
  assert.equal(installed.version, '0.2.1-rc.2')
  const audit = spawnSync('pnpm', ['--dir', join(home, 'harness'), 'audit', '--json', '--registry=https://registry.npmjs.org/'], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  })
  assert.ifError(audit.error)
  const report = JSON.parse(audit.stdout)
  const counts = report.metadata?.vulnerabilities
  assert.ok(counts, 'Audit must return vulnerability counts')
  console.log(JSON.stringify({version: installed.version, vulnerabilities: counts}))
  const findings = Object.entries(counts).filter(([level]) => level !== 'total').reduce((sum, [, count]) => sum + Number(count), 0)
  assert.equal(findings, 0, 'The managed DSH dependency tree must pass the unchanged low-severity audit gate')
  assert.equal(audit.status, 0, 'Audit command must pass')
} finally {
  rmSync(home, {recursive: true, force: true})
}
