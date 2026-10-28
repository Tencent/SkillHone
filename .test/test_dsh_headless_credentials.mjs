import assert from 'node:assert/strict'
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {environment} from '../dist/core/harness.js'

function fixture(store, mode = 0o600, run) {
  const home = mkdtempSync(join(tmpdir(), 'skillhone-headless-env-'))
  try {
    const dshHome = join(home, 'harness', 'home')
    mkdirSync(join(dshHome, 'profiles', 'headless'), {recursive: true})
    const path = join(dshHome, '.credentials.yaml')
    if (store !== undefined) {
      writeFileSync(path, store, {mode})
      chmodSync(path, mode)
    }
    return run({home, dshHome, path})
  } finally {
    rmSync(home, {recursive: true, force: true})
  }
}

const saved = 'version: 1\nrefs:\n  SKILLHONE_PUBLIC_SMOKE_CREDENTIAL: public-fixture-value\n'

fixture(saved, 0o600, ({home, path}) => {
  assert.equal(environment(home).SKILLHONE_PUBLIC_SMOKE_CREDENTIAL, 'public-fixture-value',
    'DSH 0.2.1 headless disables the credential service and requires launch-time credentials; saved references must remain usable')
  assert.equal(statSync(path).mode & 0o777, 0o600, 'reading the protected store must not change its owner-only mode')
  assert.equal(readFileSync(path, 'utf8'), saved, 'resolving launch credentials must not rewrite the existing store')
  console.log('Saved credential references are available to headless launch without changing the store')
})

fixture([
  'version: 1',
  'refs:',
  '  "SKILLHONE_FIXTURE_DOUBLE": "double: # value \\"quoted\\""',
  "  'SKILLHONE_FIXTURE_SINGLE': 'single ''quoted'' # value'",
  '  SKILLHONE_FIXTURE_PLAIN: plain-value # trailing comment',
  'foreign:',
  '  SKILLHONE_FIXTURE_FOREIGN: not-a-reference',
  'records:',
  '  llm/example:',
  '    kind: api-key',
  '    key: not-a-reference',
  '',
].join('\n'), 0o600, ({home}) => {
  const env = environment(home)
  assert.equal(env.SKILLHONE_FIXTURE_DOUBLE, 'double: # value "quoted"')
  assert.equal(env.SKILLHONE_FIXTURE_SINGLE, "single 'quoted' # value")
  assert.equal(env.SKILLHONE_FIXTURE_PLAIN, 'plain-value')
  assert.equal(env.SKILLHONE_FIXTURE_FOREIGN, undefined, 'foreign top-level records must not become environment variables')
  assert.equal(env.SKILLHONE_FIXTURE_RECORD, undefined)
  console.log('Quoted references resolve while unrelated store records are ignored')
})

const names = {
  saved: 'SKILLHONE_FIXTURE_STORE_WINS',
  ambient: 'SKILLHONE_FIXTURE_AMBIENT_ONLY',
  storedOnly: 'SKILLHONE_FIXTURE_STORE_ONLY',
}
fixture([
  'version: 1',
  'refs:',
  `  ${names.saved}: stored-value`,
  `  ${names.storedOnly}: stored-only-value`,
  '',
].join('\n'), 0o600, ({home}) => {
  const previous = Object.fromEntries(Object.entries(names).map(([key, name]) => [name, process.env[name]]))
  try {
    process.env[names.saved] = 'ambient-value'
    process.env[names.ambient] = 'ambient-fallback'
    const env = environment(home)
    assert.equal(env[names.saved], 'stored-value', 'the protected store wins over the launch environment')
    assert.equal(env[names.ambient], 'ambient-fallback', 'ambient values remain the fallback for references absent from the store')
    assert.equal(env[names.storedOnly], 'stored-only-value')
    assert.equal(process.env[names.saved], 'ambient-value', 'launch credentials must not mutate the parent process environment')
    assert.equal(process.env[names.storedOnly], undefined, 'launch credentials must not mutate the parent process environment')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  console.log('Stored credentials take precedence without changing parent process.env')
})

for (const [label, store] of [
  ['unterminated quotes', 'version: 1\nrefs:\n  SKILLHONE_FIXTURE_MALFORMED: "unterminated\n'],
  ['unsupported version', 'version: 2\nrefs:\n  SKILLHONE_FIXTURE_MALFORMED: stored-value\n'],
  ['non-string value', 'version: 1\nrefs:\n  SKILLHONE_FIXTURE_MALFORMED: 12345\n'],
  ['invalid reference name', 'version: 1\nrefs:\n  "BAD-NAME": stored-value\n'],
  ['duplicate reference', 'version: 1\nrefs:\n  SKILLHONE_FIXTURE_MALFORMED: one\n  SKILLHONE_FIXTURE_MALFORMED: two\n'],
]) {
  fixture(store, 0o600, ({home}) => {
    const name = 'SKILLHONE_FIXTURE_MALFORMED'
    const previous = process.env[name]
    try {
      process.env[name] = 'ambient-fallback'
      assert.equal(environment(home)[name], 'ambient-fallback',
        `${label}: a malformed store must be ignored instead of partially applied`)
      assert.equal(environment(home).SKILLHONE_FIXTURE_STORE_ONLY, undefined)
    } finally {
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    }
  })
}
console.log('Malformed stores are ignored safely')

if (process.platform !== 'win32') {
  const unsafe = 'version: 1\nrefs:\n  SKILLHONE_FIXTURE_UNSAFE: unsafe-store-value\n'
  fixture(unsafe, 0o644, ({home, path}) => {
    const previous = process.env.SKILLHONE_FIXTURE_UNSAFE
    try {
      process.env.SKILLHONE_FIXTURE_UNSAFE = 'ambient-fallback'
      assert.equal(environment(home).SKILLHONE_FIXTURE_UNSAFE, 'ambient-fallback',
        'a credentials file readable beyond its owner must not be consumed')
      assert.equal(statSync(path).mode & 0o777, 0o644, 'an unsafe store must not be silently chmodded')
      assert.equal(readFileSync(path, 'utf8'), unsafe, 'an unsafe store must not be rewritten')
    } finally {
      if (previous === undefined) delete process.env.SKILLHONE_FIXTURE_UNSAFE
      else process.env.SKILLHONE_FIXTURE_UNSAFE = previous
    }
  })
  console.log('World-readable stores are refused without modifying them')
}

fixture(undefined, 0o600, ({home}) => {
  const previous = process.env.SKILLHONE_FIXTURE_AMBIENT_ONLY
  try {
    process.env.SKILLHONE_FIXTURE_AMBIENT_ONLY = 'ambient-fallback'
    const env = environment(home)
    assert.equal(env.SKILLHONE_FIXTURE_AMBIENT_ONLY, 'ambient-fallback')
    assert.equal(env.DSH_HOME, join(home, 'harness', 'home'))
    assert.equal(process.env.SKILLHONE_FIXTURE_AMBIENT_ONLY, 'ambient-fallback')
  } finally {
    if (previous === undefined) delete process.env.SKILLHONE_FIXTURE_AMBIENT_ONLY
    else process.env.SKILLHONE_FIXTURE_AMBIENT_ONLY = previous
  }
  console.log('A missing store keeps ambient environment credentials as fallback')
})
