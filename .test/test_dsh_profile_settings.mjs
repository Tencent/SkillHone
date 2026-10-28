import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import {
  configureHarness, evaluatorHarnessHome, harnessHome, modelConfigured, profilePatchPath, testedHarnessPackage,
} from '../dist/core/settings.js'

function home() { return mkdtempSync(join(tmpdir(), 'skillhone-dsh-profile-')) }

const profileHome = home()
try {
  const profile = join(profileHome, 'harness', 'home', 'profiles', 'headless')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'cordis.patch.yml'), [
    '- id: agent-default-model',
    '  config:',
    '    provider: "test-provider"',
    '    model: "test-model"',
    '',
  ].join('\n'))
  assert.equal(modelConfigured(profileHome), true,
    'DSH 0.2.1 imports settings.yaml into the active profile: a configured profile must remain ready')
} finally { rmSync(profileHome, { recursive: true, force: true }) }

const configureHome = home()
try {
  const profile = profilePatchPath(configureHome)
  mkdirSync(dirname(profile), { recursive: true })
  writeFileSync(profile, [
    '- id: unrelated-entry',
    '  config:',
    '    apiKeyEnv: EXTERNAL_ENV_REFERENCE',
    '    enabled: true',
    '',
  ].join('\n'))
  configureHarness(configureHome, { provider: 'deepseek', model: 'optimizer-model', secret: 'not-a-real-secret' })
  const text = readFileSync(profile, 'utf8')
  assert.match(text, /id: unrelated-entry\n {2}config:\n {4}apiKeyEnv: EXTERNAL_ENV_REFERENCE\n {4}enabled: true/)
  assert.match(text, /id: agent-default-model\n {2}config:\n {4}provider: "deepseek-official"\n {4}model: "optimizer-model"/)
  assert.match(text, /- id: llm-deepseek-api-key\n/, 'DSH 0.2.1 requires apiKeyEnv on the API-key adapter entry, not llm-deepseek')
  assert.doesNotMatch(text, /not-a-real-secret/)
  assert.equal(modelConfigured(configureHome), true)
  assert.equal(testedHarnessPackage, '@deepseek-ai/dsh@0.2.1-rc.2')

  configureHarness(configureHome, {
    role: 'evaluator', provider: 'evaluator-provider', model: 'evaluator-model',
    secret: 'not-a-real-evaluator-secret', baseUrl: 'https://example.invalid/v1', protocol: 'openai-completions',
  })
  const roleProfile = join(evaluatorHarnessHome(configureHome), 'profiles', 'headless', 'cordis.patch.yml')
  const role = readFileSync(roleProfile, 'utf8')
  assert.match(role, /provider: "evaluator-provider"/)
  assert.match(role, /model: "evaluator-model"/)
  assert.doesNotMatch(role, /not-a-real-evaluator-secret/)
} finally { rmSync(configureHome, { recursive: true, force: true }) }

const legacyHome = home()
try {
  const dshHome = harnessHome(legacyHome)
  mkdirSync(dshHome, { recursive: true })
  writeFileSync(join(dshHome, 'settings.yaml'), [
    'version: 1',
    'agent-default-model:',
    '  provider: legacy-provider',
    '  model: legacy-model',
    '',
  ].join('\n'))
  assert.equal(modelConfigured(legacyHome), true, 'a legacy settings document remains readable before migration')
  configureHarness(legacyHome, { provider: 'deepseek', model: 'migrated-model', secret: 'not-a-real-secret' })
  const text = readFileSync(profilePatchPath(legacyHome), 'utf8')
  assert.match(text, /model: "migrated-model"/)
  assert.equal(existsSync(join(dshHome, 'settings.yaml')), false)
  assert.match(readFileSync(join(dshHome, 'settings.yaml.imported'), 'utf8'), /legacy-model/)
} finally { rmSync(legacyHome, { recursive: true, force: true }) }

console.log('DSH profile configuration, migration, and evaluator selection are recognized')
