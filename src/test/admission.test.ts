import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'

import { Catalog } from '../core/catalog.js'
import { containsCredential } from '../core/credential-scan.js'

const opaque = 'q7W2m9R4v8L6c3X5n1P0' // Public rejection fixture, never a credential.

test('Credential admission separates runtime references from literal defaults', () => {
  for (const [file, body] of [
    ['sample.py', 'token = os.environ.get("GENERIC_TOKEN", "")'],
    ['sample.py', 'token = getpass.getpass("Enter an API token:")'],
    ['sample.js', 'const token = client.options.authToken;'],
    ['sample.js', 'const token = response["access_token"];'],
    ['sample.sh', 'TOKEN=${TOKEN:-${FALLBACK_TOKEN:?set it at runtime}}'],
    ['sample.md', 'Authorization: 请从环境变量读取认证信息。'],
    ['sample.md', 'Obtain a token: https://example.invalid/documentation/authentication'],
    ['sample.md', 'token: `<GENERIC_TOKEN>`'],
  ]) assert.equal(containsCredential(body!, file!), false, file)
  for (const [file, body] of [
    ['sample.js', `const token = "${opaque}!";`],
    ['sample.js', `const token = "client:${opaque}";`],
    ['sample.js', `const token = "test_${opaque}";`],
    ['sample.js', `const token = ["${opaque}"];`],
    ['sample.json', `{"token":["${opaque}"]}`],
    ['sample.py', `token = f"{os.getenv('GENERIC_TOKEN', '${opaque}')}"`],
    ['sample.js', 'const token = `Bearer ${process.env.GENERIC_TOKEN || "' + opaque + '"}`;'],
    ['sample.sh', 'TOKEN=${TOKEN:-${FALLBACK_TOKEN:-' + opaque + '}}'],
    ['sample.md', `token: https://${opaque}@example.invalid/`],
    ['sample.md', `token: https://example.invalid/auth?token=${opaque}%21`],
    ['sample.md', `Authorization: Bearer ${opaque}`],
    ['sample.txt', '-----BEGIN RSA PRIVATE KEY-----'],
    ['sample.txt', '-----BEGIN OPENSSH PRIVATE KEY-----'],
  ]) assert.equal(containsCredential(body!, file!), true, body)
})

test('Credential admission preserves string and regular-expression boundaries in bundled code', () => {
  const body = 'const pattern=/["\']/;const message="Not a valid token:".concat(value);const options={createToken:(a,b)=>({type:"taskList",text:a.text,tokens:a.tokens})};'
  assert.equal(containsCredential(body, 'sample.mjs'), false)
  assert.equal(containsCredential(`const pattern=/["']/; const token="${opaque}"`, 'sample.mjs'), true)
})

test('A new runtime may attach to a clean repaired repository without resetting existing origin drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-origin-admission-'))
  const home = join(root, 'home'), first = join(root, 'first'), second = join(root, 'second')
  mkdirSync(first)
  writeFileSync(join(first, 'SKILL.md'), '---\nname: public-origin-demo\ndescription: Public origin admission fixture\n---\nDemo.\n')
  const catalog = new Catalog(home)
  try {
    const imported = catalog.importPath(first)
    const managed = String(imported.root)
    writeFileSync(join(managed, 'CHANGELOG.md'), 'Public verified repair.\n')
    for (const args of [['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Public repair']]) {
      assert.equal(spawnSync('git', args, { cwd: managed }).status, 0)
    }
    cpSync(managed, second, { recursive: true, filter: path => !path.split('/').includes('.git') })
    assert.equal(catalog.importPath(second).id, imported.id)
    assert.equal(catalog.syncStatus('public-origin-demo').find(item => item.path === second)?.state, 'in_sync')
    writeFileSync(join(first, 'CHANGELOG.md'), 'Public verified repair.\n')
    assert.equal(catalog.syncStatus('public-origin-demo').find(item => item.path === first)?.state, 'source_changed')
    assert.throws(() => catalog.importPath(first), /drift/)
    assert.equal(catalog.syncStatus('public-origin-demo').find(item => item.path === first)?.state, 'source_changed')
    assert.equal(existsSync(join(first, '.git')), false)
  } finally { catalog.close(); rmSync(root, { recursive: true, force: true }) }
})
