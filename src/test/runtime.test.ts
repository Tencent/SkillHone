import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { get, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { Catalog } from '../core/catalog.js'
import { installAgentSkills } from '../core/agent.js'
import {
  benchmarkPrompt, benchmarkStatus, initBenchmark, optimizationProbeQuestions, optimizeBenchmark, runBenchmark,
} from '../core/benchmark.js'
import { main } from '../cli.js'
import {
  auditPolicy, benchmarkHarnessHome, configureHarness, evaluatorHarnessHome, evaluatorPatchPath, harnessHome,
  loadSettings, mergePolicy, policy, setAuditPolicy, setMergePolicy, setPolicy, testedHarnessPackage,
} from '../core/settings.js'
import { Tracker, type WorkRow } from '../core/tracker.js'
import { run } from '../core/util.js'
import { makeServer } from '../core/web.js'

function repository(root: string, name = 'web-search'): string {
  const repo = join(root, name)
  mkdirSync(repo, { recursive: true })
  run('git', ['init', '-b', 'main'], repo)
  run('git', ['config', 'user.name', 'SkillHone Test'], repo)
  run('git', ['config', 'user.email', 'test@skillhone.local'], repo)
  writeFileSync(join(repo, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`)
  run('git', ['add', '.'], repo); run('git', ['commit', '-m', 'seed'], repo)
  return repo
}

async function fixture(): Promise<{ root: string; home: string; repo: string }> {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-'))
  return { root, home: join(root, 'home'), repo: repository(root) }
}

function request(url: string): Promise<{ body: string; headers: Record<string, unknown>; status: number }> {
  return new Promise((resolve, reject) => get(url, response => {
    const chunks: Buffer[] = []
    response.on('data', chunk => chunks.push(Buffer.from(chunk)))
    response.on('end', () => resolve({ body: Buffer.concat(chunks).toString(), headers: response.headers, status: response.statusCode ?? 0 }))
  }).on('error', reject))
}

function post(url: string, headers: Record<string, string> = {}): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    const call = httpRequest(url, { method: 'POST', headers }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({ body: Buffer.concat(chunks).toString(), status: response.statusCode ?? 0 }))
    })
    call.on('error', reject)
    call.end()
  })
}

test('Issue evidence is redacted, deduplicated, and repository scoped', async () => {
  const value = await fixture()
  try {
    const tracker = new Tracker(value.repo, value.home)
    const fakeSecret = ['sk', 'abcdefghijklmnopqrst'].join('-')
    const first = tracker.createIssue('Missing search script', `api_key=${fakeSecret}`)
    const second = tracker.createIssue('Missing search script', `api_key=${fakeSecret}`)
    assert.equal(first.created, true); assert.equal(second.created, false)
    assert.equal(first.issue.number, second.issue.number)
    assert.equal(String(first.issue.body).includes(fakeSecret), false)
    const wiki = tracker.createWiki({ title: 'Repair notes', body: `token=${fakeSecret}`, issueNumber: 1 })
    assert.equal(wiki.slug, 'repair-notes'); assert.equal(String(wiki.body).includes(fakeSecret), false)
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    writeFileSync(join(value.repo, '.test', 'repro.mjs'), 'process.exit(0)\n')
    tracker.addIssueTest(1, '.test/repro.mjs', 'node .test/repro.mjs')
    const verification = tracker.runIssueTests(1)
    assert.equal(verification.passed, true)
    assert.equal(tracker.issueDetail(1).tests instanceof Array, true)
    const firstRun = tracker.startRun(1, 'collision-test', 'main')
    const secondRun = tracker.startRun(1, 'collision-test', 'main')
    assert.notEqual(firstRun.id, secondRun.id)
    tracker.finishRun(String(firstRun.id), 'failed')
    tracker.finishRun(String(secondRun.id), 'failed')
    tracker.close()
  } finally { await rm(value.root, { recursive: true, force: true }) }
})

test('Issue tests preserve the caller PATH during verification', async () => {
  const value = await fixture()
  const originalPath = process.env.PATH
  const originalSecret = process.env.SKILLHONE_TEST_SECRET
  try {
    const tracker = new Tracker(value.repo, value.home)
    const issue = tracker.createIssue('Runtime path contract', 'verification must use the repair environment').issue
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    writeFileSync(join(value.repo, '.test', 'path_contract.txt'), 'PATH contract\n')
    const binaryDir = join(value.root, 'repair-runtime', 'bin')
    mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'skillhone-path-probe')
    writeFileSync(binary, '#!/bin/sh\nexit 0\n')
    chmodSync(binary, 0o755)
    process.env.PATH = `${binaryDir}:${originalPath ?? ''}`
    process.env.SKILLHONE_TEST_SECRET = 'must-not-reach-the-test-process'
    tracker.addIssueTest(Number(issue.number), '.test/path_contract.txt', 'skillhone-path-probe && test -z "$SKILLHONE_TEST_SECRET"')
    const result = tracker.runIssueTests(Number(issue.number))
    assert.equal(result.passed, true)
    assert.equal(result.tests[0]?.status, 'passing')
    tracker.close()
  } finally {
    process.env.PATH = originalPath
    if (originalSecret === undefined) delete process.env.SKILLHONE_TEST_SECRET
    else process.env.SKILLHONE_TEST_SECRET = originalSecret
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Catalog imports one isolated Git repository per Skill', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-catalog-'))
  try {
    const source = join(root, 'source'); mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), '---\nname: pdf\ndescription: test\n---\n')
    mkdirSync(join(source, '.test'), { recursive: true })
    writeFileSync(join(source, '.test', 'contract.test.ts'), 'export {}\n')
    const catalog = new Catalog(join(root, 'home'))
    const imported = catalog.importPath(source)
    assert.equal(imported.import_status, 'imported')
    assert.equal(run('git', ['rev-list', '--count', 'HEAD'], String(imported.root)), '1')
    assert.match(readFileSync(join(String(imported.root), '.test', 'contract.test.ts'), 'utf8'), /export/)
    assert.equal(catalog.listSkills().length, 1)
    catalog.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Catalog keeps an unavailable Skill visible without breaking the dashboard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-stale-catalog-'))
  const catalog = new Catalog(join(root, 'home'))
  try {
    const imported = catalog.register(repository(root, 'unavailable-skill'))
    await rm(String(imported.root), { recursive: true, force: true })
    const listed = catalog.listSkills()
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.name, 'unavailable-skill')
    assert.equal(listed[0]?.available, false)
    assert.equal(listed[0]?.repository_status, 'unavailable')
    const dashboard = catalog.dashboard()
    assert.equal((dashboard.skills as WorkRow[]).length, 1)
    assert.deepEqual(dashboard.issues, [])
    assert.deepEqual(dashboard.pull_requests, [])
    assert.equal((dashboard.audit as WorkRow).integrity, 'failed')
  } finally {
    catalog.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Git-installed CLI connects bundled Skills to an Agent runtime without a checkout cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-agent-install-'))
  try {
    const packageSkills = join(root, 'package', 'skills')
    for (const name of ['skillhone', 'skillhone-auto-optimization']) {
      const source = join(packageSkills, name)
      mkdirSync(source, { recursive: true })
      writeFileSync(join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`)
    }
    const destination = join(root, 'runtime', 'skills')
    const options = { sourceRoot: packageSkills, destinations: [{ runtime: 'codex' as const, root: destination }] }
    const installed = installAgentSkills('codex', options)
    assert.equal(installed.length, 3)
    assert.equal(installed.every(item => item.status === 'installed'), true)
    for (const name of ['skillhone', 'skillhone-auto-optimization']) {
      assert.equal(realpathSync(join(destination, name)), realpathSync(join(packageSkills, name)))
    }
    const routing = readFileSync(join(root, 'runtime', 'AGENTS.md'), 'utf8')
    assert.match(routing, /skillhone-auto-optimization/)
    assert.equal((routing.match(/skillhone-routing:start/g) ?? []).length, 1)
    const repeated = installAgentSkills('codex', options)
    assert.equal(repeated.every(item => item.status === 'already-installed'), true)
    assert.equal((readFileSync(join(root, 'runtime', 'AGENTS.md'), 'utf8').match(/skillhone-routing:start/g) ?? []).length, 1)
    const zcodeRoot = join(root, 'zcode', 'skills')
    const zcode = installAgentSkills('zcode', {
      sourceRoot: packageSkills,
      destinations: [{ runtime: 'zcode', root: zcodeRoot }],
    })
    assert.equal(zcode.length, 3)
    assert.equal(realpathSync(join(zcodeRoot, 'skillhone')), realpathSync(join(packageSkills, 'skillhone')))
    assert.match(readFileSync(join(root, 'zcode', 'AGENTS.md'), 'utf8'), /skillhone-auto-optimization/)
    const occupied = join(root, 'occupied', 'skills', 'skillhone')
    mkdirSync(occupied, { recursive: true })
    writeFileSync(join(occupied, 'SKILL.md'), 'user-owned\n')
    assert.throws(() => installAgentSkills('codex', {
      sourceRoot: packageSkills,
      destinations: [{ runtime: 'codex', root: join(root, 'occupied', 'skills') }],
    }), /remove or back it up/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Skill import offers copy/apply-back and centrally managed runtime modes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-import-modes-'))
  try {
    const home = join(root, 'home')
    const copiedSource = join(root, 'codex', 'skills', 'copied-skill')
    mkdirSync(copiedSource, { recursive: true })
    writeFileSync(join(copiedSource, 'SKILL.md'), '---\nname: copied-skill\ndescription: test\n---\n')
    writeFileSync(join(copiedSource, 'version.txt'), 'original\n')
    const catalog = new Catalog(home)
    const copied = catalog.importPath(copiedSource, undefined, 'codex', 'copy')
    assert.equal(catalog.syncStatus('copied-skill')[0]?.state, 'in_sync')
    assert.equal(catalog.syncStatus('copied-skill')[0]?.sync_required, false)
    writeFileSync(join(String(copied.root), 'version.txt'), 'optimized\n')
    run('git', ['add', 'version.txt'], String(copied.root))
    run('git', ['commit', '-m', 'optimize copied skill'], String(copied.root))
    assert.equal(catalog.syncStatus('copied-skill')[0]?.state, 'ready_to_sync')
    assert.equal(catalog.syncStatus('copied-skill')[0]?.can_apply, true)
    const applied = catalog.applyToOrigins('copied-skill')
    assert.equal(applied[0]?.status, 'applied')
    assert.equal(readFileSync(join(copiedSource, 'version.txt'), 'utf8'), 'optimized\n')
    assert.equal(existsSync(String(applied[0]?.backup)), true)
    assert.equal(catalog.syncStatus('copied-skill')[0]?.state, 'in_sync')
    assert.equal(catalog.applyToOrigins('copied-skill')[0]?.status, 'already-synced')

    const managedSource = join(root, 'claude', 'skills', 'managed-skill')
    mkdirSync(managedSource, { recursive: true })
    writeFileSync(join(managedSource, 'SKILL.md'), '---\nname: managed-skill\ndescription: test\n---\n')
    const managed = catalog.importPath(managedSource, undefined, 'claude-code', 'managed')
    assert.equal(managed.import_mode, 'takeover')
    assert.equal(lstatSync(managedSource).isSymbolicLink(), true)
    assert.equal(realpathSync(managedSource), realpathSync(String(managed.root)))
    assert.equal(existsSync(String(managed.backup)), true)
    assert.equal(catalog.applyToOrigins('managed-skill')[0]?.status, 'already-managed')
    assert.equal(catalog.syncStatus('managed-skill')[0]?.mode, 'takeover')
    assert.equal(catalog.syncStatus('managed-skill')[0]?.state, 'takeover_active')
    catalog.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Copy sync refuses to overwrite a runtime Skill changed after import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-sync-conflict-'))
  try {
    const source = join(root, 'cursor', 'skills', 'conflict-skill')
    const secondSource = join(root, 'codex', 'skills', 'conflict-skill')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), '---\nname: conflict-skill\ndescription: test\n---\n')
    writeFileSync(join(source, 'version.txt'), 'original\n')
    mkdirSync(secondSource, { recursive: true })
    writeFileSync(join(secondSource, 'SKILL.md'), '---\nname: conflict-skill\ndescription: test\n---\n')
    writeFileSync(join(secondSource, 'version.txt'), 'original\n')
    const catalog = new Catalog(join(root, 'home'))
    const imported = catalog.importPath(source, undefined, 'cursor', 'copy')
    catalog.importPath(secondSource, undefined, 'codex', 'copy')
    writeFileSync(join(String(imported.root), 'version.txt'), 'optimized\n')
    run('git', ['add', 'version.txt'], String(imported.root))
    run('git', ['commit', '-m', 'optimize managed copy'], String(imported.root))
    writeFileSync(join(secondSource, 'version.txt'), 'user changed this copy\n')
    const statuses = catalog.syncStatus('conflict-skill')
    assert.equal(statuses.some(status => status.state === 'source_changed' && status.can_apply === false), true)
    assert.equal(catalog.webSyncStatus('conflict-skill')?.state, 'source_changed')
    assert.equal(catalog.webSyncStatus('conflict-skill')?.can_apply, false)
    assert.throws(() => catalog.applyToOrigins('conflict-skill'), /changed after import/)
    assert.equal(readFileSync(join(source, 'version.txt'), 'utf8'), 'original\n')
    assert.equal(readFileSync(join(secondSource, 'version.txt'), 'utf8'), 'user changed this copy\n')
    catalog.close()
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Init requires explicit ownership and merge choices before importing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-init-choices-'))
  const originalLog = console.log
  try {
    const source = join(root, 'source')
    mkdirSync(source, { recursive: true })
    writeFileSync(join(source, 'SKILL.md'), '---\nname: guided-skill\ndescription: test\n---\n')
    const home = join(root, 'home')
    const output: string[] = []
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
    assert.equal(await main(['--home', home, '--repo', source, '--json', 'init']), 2)
    const choice = JSON.parse(String(output.shift())) as Record<string, unknown>
    assert.equal(choice.initialized, false)
    assert.deepEqual((choice.choice_required as Array<Record<string, unknown>>).map(item => item.field), ['mode', 'merge'])

    assert.equal(await main([
      '--home', home, '--repo', source, '--json', 'init',
      '--mode', 'copy', '--merge', 'review', '--trigger', 'queued',
    ]), 0)
    const initialized = JSON.parse(String(output.shift())) as Record<string, unknown>
    assert.equal(initialized.import_mode, 'copy')
    assert.equal((initialized.merge as Record<string, unknown>).mode, 'review')
    assert.equal((initialized.trigger as Record<string, unknown>).mode, 'queued')
    assert.equal((initialized.audit as Record<string, unknown>).mode, 'standard')
    assert.equal((initialized.skills as Array<Record<string, unknown>>)[0]?.import_status, 'imported')

    assert.equal(await main(['--home', home, '--json', 'config', 'set', '--audit', 'signed']), 0)
    const configured = JSON.parse(String(output.shift())) as Record<string, unknown>
    assert.equal((configured.audit as Record<string, unknown>).mode, 'signed')
    const importedId = String((initialized.skills as Array<Record<string, unknown>>)[0]?.id)
    assert.equal(existsSync(join(home, 'projects', importedId, 'audit-integrity.json')), true)
  } finally {
    console.log = originalLog
    await rm(root, { recursive: true, force: true })
  }
})

test('Local PR needs explicit confirmation and exposes review evidence', async () => {
  const value = await fixture()
  try {
    const tracker = new Tracker(value.repo, value.home)
    const issue = tracker.createIssue('Add script').issue
    tracker.git(['checkout', '-b', 'skillhone/issue-1-add-script'])
    writeFileSync(join(value.repo, 'search.ts'), "console.log('ok')\n")
    tracker.git(['add', 'search.ts']); tracker.git(['commit', '-m', 'add search script'])
    const pr = tracker.createPr({ title: 'Add search script', head: 'skillhone/issue-1-add-script', base: 'main', issueNumber: Number(issue.number) })
    assert.match(String(tracker.pr(Number(pr.number)).diff_stat), /search\.ts/)
    assert.match(String(pr.body), /## What changed/)
    assert.match(String(pr.body), /0\/0 Issue-linked tests passed/)
    assert.match(String(pr.body), /User approved the local merge/)
    assert.throws(() => tracker.mergePr(Number(pr.number), false), /--confirm/)
    assert.equal(tracker.prDetail(Number(pr.number)).files instanceof Array, true)
    tracker.close()
  } finally { await rm(value.root, { recursive: true, force: true }) }
})

test('Harness configuration is written to Harness-owned files without leaking in output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-harness-'))
  try {
    assert.equal(benchmarkHarnessHome(root), harnessHome(root))
    const result = configureHarness(root, { provider: 'deepseek', model: 'optimizer-model-a', secret: 'test-secret-credential' })
    const settings = readFileSync(join(harnessHome(root), 'settings.yaml'), 'utf8')
    const credentials = readFileSync(join(harnessHome(root), '.credentials.yaml'), 'utf8')
    const profilePatch = readFileSync(join(harnessHome(root), 'profiles', 'headless', 'cordis.patch.yml'), 'utf8')
    assert.match(settings, /provider: "deepseek-official"/)
    assert.match(profilePatch, /id: web-search-deepseek\n {2}config:\n {4}apiKeyEnv: SKILLHONE_DEEPSEEK_CREDENTIAL/)
    assert.doesNotMatch(profilePatch, /test-secret-credential/)
    assert.match(credentials, /test-secret-credential/)
    assert.match(credentials, /^refs:\n(?: {2}.+\n)* {2}SKILLHONE_DEEPSEEK_CREDENTIAL:/m)
    assert.doesNotMatch(credentials, /^SKILLHONE_DEEPSEEK_CREDENTIAL:/m)
    assert.doesNotMatch(JSON.stringify(result), /test-secret-credential/)
    configureHarness(root, { provider: 'deepseek', model: 'optimizer-model-b', secret: 'replacement-secret' })
    const updatedCredentials = readFileSync(join(harnessHome(root), '.credentials.yaml'), 'utf8')
    const updatedProfilePatch = readFileSync(join(harnessHome(root), 'profiles', 'headless', 'cordis.patch.yml'), 'utf8')
    assert.match(updatedCredentials, /replacement-secret/)
    assert.doesNotMatch(updatedCredentials, /test-secret-credential/)
    assert.equal((updatedCredentials.match(/SKILLHONE_DEEPSEEK_CREDENTIAL:/g) ?? []).length, 1)
    assert.equal((updatedProfilePatch.match(/id: web-search-deepseek/g) ?? []).length, 1)
    assert.doesNotMatch(updatedCredentials, /^SKILLHONE_DEEPSEEK_CREDENTIAL:/m)
    const evaluator = configureHarness(root, {
      role: 'evaluator', provider: 'evaluator-provider', model: 'evaluator-model', secret: 'evaluator-secret',
      baseUrl: 'https://example.invalid/compatible-mode/v1', protocol: 'openai-completions',
    })
    const evaluatorSettings = readFileSync(join(harnessHome(root), 'settings.yaml'), 'utf8')
    const evaluatorPatch = readFileSync(evaluatorPatchPath(root), 'utf8')
    const evaluatorCredentials = readFileSync(join(harnessHome(root), '.credentials.yaml'), 'utf8')
    const evaluatorRoleSettings = readFileSync(join(evaluatorHarnessHome(root), 'settings.yaml'), 'utf8')
    const evaluatorRoleCredentials = readFileSync(join(evaluatorHarnessHome(root), '.credentials.yaml'), 'utf8')
    const evaluatorRolePatch = readFileSync(join(evaluatorHarnessHome(root), 'skillhone', 'evaluator.patch.yml'), 'utf8')
    assert.match(evaluatorSettings, /evaluator-provider:/)
    assert.match(evaluatorSettings, /model: "optimizer-model-b"/)
    assert.doesNotMatch(evaluatorSettings, /evaluator-secret/)
    assert.match(evaluatorPatch, /provider: "evaluator-provider"/)
    assert.match(evaluatorPatch, /model: "evaluator-model"/)
    assert.doesNotMatch(evaluatorPatch, /evaluator-secret/)
    assert.match(evaluatorCredentials, /evaluator-secret/)
    assert.match(evaluatorRoleSettings, /provider: "evaluator-provider"/)
    assert.match(evaluatorRoleSettings, /model: "evaluator-model"/)
    assert.match(evaluatorRoleCredentials, /evaluator-secret/)
    assert.equal(evaluatorRolePatch, evaluatorPatch)
    assert.equal(benchmarkHarnessHome(root), evaluatorHarnessHome(root))
    await rm(evaluatorHarnessHome(root), { recursive: true, force: true })
    assert.equal(benchmarkHarnessHome(root), evaluatorHarnessHome(root))
    assert.match(readFileSync(join(evaluatorHarnessHome(root), 'settings.yaml'), 'utf8'), /model: "evaluator-model"/)
    configureHarness(root, { provider: 'deepseek', model: 'optimizer-model-c', secret: 'latest-optimizer-secret' })
    const resyncedRoleSettings = readFileSync(join(evaluatorHarnessHome(root), 'settings.yaml'), 'utf8')
    const resyncedRoleCredentials = readFileSync(join(evaluatorHarnessHome(root), '.credentials.yaml'), 'utf8')
    assert.match(resyncedRoleSettings, /provider: "evaluator-provider"/)
    assert.match(resyncedRoleSettings, /model: "evaluator-model"/)
    assert.match(resyncedRoleCredentials, /latest-optimizer-secret/)
    assert.match(resyncedRoleCredentials, /evaluator-secret/)
    assert.equal(evaluator.role, 'evaluator')
    assert.deepEqual(policy(root), { mode: 'queued', interval_minutes: 60, scope: 'default' })
    assert.deepEqual(mergePolicy(root), { mode: 'review', scope: 'default' })
    assert.deepEqual(auditPolicy(root), { mode: 'standard', scope: 'default' })
    assert.equal(setPolicy(root, 'scheduled', 15).mode, 'scheduled')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Optional signed audit mode detects offline record edits and fails closed', async () => {
  const value = await fixture()
  try {
    const project = new Tracker(value.repo, value.home)
    const projectId = project.project().id
    project.close()
    assert.deepEqual(setAuditPolicy(value.home, 'signed', projectId), { mode: 'signed', scope: 'skill' })

    const tracker = new Tracker(value.repo, value.home)
    tracker.createIssue('Signed audit contract', 'Host-authored records must remain tamper evident.')
    assert.deepEqual(tracker.auditStatus(), {
      integrity: 'verified', mode: 'signed', authority: 'skillhone-host', runner_writes: 'blocked-during-run',
    })
    const dbPath = tracker.dbPath
    const sealPath = join(tracker.dataDir, 'audit-integrity.json')
    tracker.close()
    assert.equal(existsSync(join(value.home, 'credentials', 'audit-integrity.key')), true)
    assert.equal(existsSync(sealPath), true)

    const db = new DatabaseSync(dbPath)
    db.exec("UPDATE issue SET status='closed'")
    db.close()

    const reopened = new Tracker(value.repo, value.home)
    assert.equal(reopened.auditStatus().integrity, 'failed')
    assert.throws(
      () => reopened.createIssue('Must be rejected', 'Signed state no longer matches.'),
      /signed audit trail verification failed/,
    )
    reopened.close()

    setAuditPolicy(value.home, 'standard', projectId)
    const standard = new Tracker(value.repo, value.home)
    standard.createIssue('Accepted baseline change', 'The user explicitly disabled signed history.')
    standard.close()
    setAuditPolicy(value.home, 'signed', projectId)
    const resealed = new Tracker(value.repo, value.home)
    assert.equal(resealed.auditStatus().integrity, 'verified')
    resealed.close()
  } finally { await rm(value.root, { recursive: true, force: true }) }
})

test('Harness installation uses one immutable tested package across old and empty homes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-ts-harness-package-'))
  try {
    assert.equal(loadSettings(root).harness.package, testedHarnessPackage)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'settings.json'), JSON.stringify({
      harness: { package: '@deepseek-ai/dsh@latest' },
    }))
    assert.equal(loadSettings(root).harness.package, testedHarnessPackage)
    assert.match(testedHarnessPackage, /^@deepseek-ai\/dsh@\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Immediate trigger dispatches one repair and deduplicates repeated reports', async () => {
  const value = await fixture()
  const originalLog = console.log
  try {
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    writeFileSync(join(value.repo, '.test', 'repro.mjs'), `
import { existsSync } from 'node:fs'
import { join } from 'node:path'
process.exit(existsSync(join(process.cwd(), 'fixed.txt')) ? 0 : 1)
`)

    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
[ "$DSH_PERMISSION_MODE" = "workspace-write" ] || exit 97
[ "$DSH_TOOLS_MODE" = "native" ] || exit 98
printf 'repaired\n' > fixed.txt
git add fixed.txt .test/repro.mjs
git commit -m 'fix: satisfy issue-linked test'
`)
    chmodSync(binary, 0o755)
    setPolicy(value.home, 'immediate', 60)

    const output: string[] = []
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
    const args = [
      '--home', value.home, '--repo', value.repo, '--json', 'issue', 'create',
      '--title', 'Missing repair output', '--body', 'The repository-local contract test reproduces the defect.',
      '--test-path', '.test/repro.mjs', '--test-command', 'node .test/repro.mjs',
    ]
    assert.equal(await main(args), 0)
    assert.equal(await main(args), 0)
    console.log = originalLog

    assert.equal(output.length, 2)
    const first = JSON.parse(String(output[0])) as Record<string, unknown>
    const second = JSON.parse(String(output[1])) as Record<string, unknown>
    assert.equal(first.created, true)
    assert.equal((first.automation as Record<string, unknown>).mode, 'immediate')
    assert.equal(((first.optimization as Record<string, unknown>).pull_request as Record<string, unknown>).number, 1)
    assert.equal(second.created, false)
    assert.equal(second.optimization, undefined)

    const tracker = new Tracker(value.repo, value.home)
    assert.equal(tracker.listIssues().length, 1)
    assert.equal(tracker.listRuns().length, 1)
    const openPr = tracker.listPrs('open')[0] as Record<string, unknown>
    assert.ok(openPr)
    assert.match(String(openPr.body), /## Validation/)
    assert.match(String(openPr.body), /1\/1 Issue-linked tests passed/)
    assert.match(String(openPr.body), /node \.test\/repro\.mjs/)
    assert.match(String(openPr.body), /No automatic merge was performed/)
    assert.equal((tracker.dashboard().notifications as Record<string, unknown>).approval_required, 1)
    assert.equal(tracker.listWiki().length, 1)
    assert.equal(tracker.runIssueTests(1).passed, true)
    assert.equal(tracker.git(['remote', '-v'], false), '')
    tracker.close()
  } finally {
    console.log = originalLog
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Harness cannot rewrite its host-owned audit trail during a repair', async () => {
  const value = await fixture()
  const originalLog = console.log
  try {
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    writeFileSync(join(value.repo, '.test', 'audit-guard.mjs'), `
import { existsSync } from 'node:fs'
process.exit(existsSync('audit-guard-fixed.txt') ? 0 : 1)
`)
    const probe = new Tracker(value.repo, value.home)
    const dbPath = probe.dbPath
    const projectId = probe.project().id
    probe.close()
    setAuditPolicy(value.home, 'signed', projectId)

    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
[ -z "$SKILLHONE_HOME" ] || exit 95
[ "$HOME" != ${JSON.stringify(process.env.HOME ?? '')} ] || exit 96
node --disable-warning=ExperimentalWarning --input-type=module <<'NODE'
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(${JSON.stringify(dbPath)})
db.exec('PRAGMA busy_timeout=50')
try {
  db.exec("UPDATE issue SET status='closed'")
  process.exit(91)
} catch (error) {
  if (!String(error).toLowerCase().includes('locked')) throw error
  console.log('AUDIT_WRITE_BLOCKED')
} finally { db.close() }
NODE
[ $? -eq 0 ] || exit 94
printf 'repaired\n' > audit-guard-fixed.txt
git add audit-guard-fixed.txt .test/audit-guard.mjs
git commit -m 'fix: satisfy audit guard test'
`)
    chmodSync(binary, 0o755)
    setPolicy(value.home, 'immediate', 60)

    const output: string[] = []
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
    assert.equal(await main([
      '--home', value.home, '--repo', value.repo, '--json', 'issue', 'create',
      '--title', 'Audit boundary repair', '--body', 'The repair must not alter its host-owned records.',
      '--test-path', '.test/audit-guard.mjs', '--test-command', 'node .test/audit-guard.mjs',
    ]), 0)
    console.log = originalLog

    const tracker = new Tracker(value.repo, value.home)
    assert.equal(tracker.issue(1).status, 'open')
    assert.equal(tracker.listPrs('open').length, 1)
    assert.equal(tracker.auditStatus().integrity, 'verified')
    assert.equal(tracker.auditStatus().mode, 'signed')
    assert.equal(tracker.auditStatus().runner_writes, 'blocked-during-run')
    const runRecord = tracker.listRuns()[0] as Record<string, unknown>
    assert.match(readFileSync(String(runRecord.log_path), 'utf8'), /AUDIT_WRITE_BLOCKED/)
    assert.equal((tracker.dashboard().audit as Record<string, unknown>).authority, 'skillhone-host')
    tracker.close()
  } finally {
    console.log = originalLog
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Automatic merge policy merges only after the linked test passes', async () => {
  const value = await fixture()
  const originalLog = console.log
  try {
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    writeFileSync(join(value.repo, '.test', 'auto-merge.mjs'), `
import { existsSync } from 'node:fs'
process.exit(existsSync('auto-merged.txt') ? 0 : 1)
`)
    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
printf 'repaired\n' > auto-merged.txt
git add auto-merged.txt .test/auto-merge.mjs
git commit -m 'fix: satisfy automatic merge gate'
`)
    chmodSync(binary, 0o755)
    setPolicy(value.home, 'immediate', 60)
    setMergePolicy(value.home, 'automatic')

    const output: string[] = []
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
    assert.equal(await main([
      '--home', value.home, '--repo', value.repo, '--json', 'issue', 'create',
      '--title', 'Automatic merge candidate', '--body', 'The linked test reproduces the defect.',
      '--test-path', '.test/auto-merge.mjs', '--test-command', 'node .test/auto-merge.mjs',
    ]), 0)
    console.log = originalLog
    const created = JSON.parse(String(output[0])) as Record<string, unknown>
    const optimization = created.optimization as Record<string, unknown>
    assert.equal((optimization.merge_policy as Record<string, unknown>).mode, 'automatic')
    assert.equal((optimization.pull_request as Record<string, unknown>).status, 'merged')

    const tracker = new Tracker(value.repo, value.home)
    assert.equal(tracker.git(['branch', '--show-current']), 'main')
    assert.equal(tracker.issue(1).status, 'closed')
    assert.equal(tracker.listPrs('open').length, 0)
    assert.equal(tracker.runIssueTests(1).passed, true)
    assert.match(String(tracker.pr(1).diff_stat), /auto-merged\.txt/)
    const mergedDetail = tracker.prDetail(1)
    assert.equal((mergedDetail.commits as WorkRow[]).length, 1)
    assert.equal((mergedDetail.files as WorkRow[]).some(item => item.path === 'auto-merged.txt'), true)
    assert.equal((tracker.dashboard().notifications as Record<string, unknown>).approval_required, 0)
    assert.equal(tracker.git(['remote', '-v'], false), '')
    tracker.close()
  } finally {
    console.log = originalLog
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Queued reporting needs no repair approval and dispatches it once', async () => {
  const value = await fixture()
  const originalLog = console.log
  try {
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    writeFileSync(join(value.repo, '.test', 'scheduled.mjs'), `
import { existsSync } from 'node:fs'
process.exit(existsSync('scheduled-fixed.txt') ? 0 : 1)
`)
    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
[ "$DSH_PERMISSION_MODE" = "workspace-write" ] || exit 97
[ "$DSH_TOOLS_MODE" = "native" ] || exit 98
printf 'scheduled repair\n' > scheduled-fixed.txt
git add scheduled-fixed.txt .test/scheduled.mjs
git commit -m 'fix: scheduled repair'
mkdir -p scripts/__pycache__
printf 'generated' > scripts/__pycache__/repair.cpython-313.pyc
`)
    chmodSync(binary, 0o755)

    const output: string[] = []
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
    const createArgs = [
      '--home', value.home, '--repo', value.repo, '--json', 'issue', 'create',
      '--title', 'Scheduled repair candidate', '--body', 'A focused repository test reproduces this problem.',
      '--test-path', '.test/scheduled.mjs', '--test-command', 'node .test/scheduled.mjs',
    ]
    assert.equal(await main(createArgs), 0)
    const created = JSON.parse(String(output.shift())) as Record<string, unknown>
    assert.equal((created.automation as Record<string, unknown>).mode, 'queued')
    assert.equal(created.optimization, undefined)

    assert.equal(await main(['--home', value.home, '--repo', value.repo, 'dispatch']), 0)
    assert.match(String(output.shift()), /web-search Issue #1 \[PR #1 open\]/)
    assert.equal(await main(['--home', value.home, '--repo', value.repo, '--json', 'status']), 0)
    const portfolio = JSON.parse(String(output.shift())) as Record<string, unknown>
    assert.equal((portfolio.notifications as Record<string, unknown>).approval_required, 1)
    assert.match(String((portfolio.notifications as Record<string, unknown>).message), /awaits? approval/)
    assert.equal(await main(['--home', value.home, '--repo', value.repo, '--json', 'dispatch']), 0)
    assert.deepEqual(JSON.parse(String(output.shift())), [])

    const tracker = new Tracker(value.repo, value.home)
    assert.equal(tracker.listIssues().length, 1)
    assert.equal(tracker.listRuns().length, 1)
    assert.equal(tracker.listPrs('open').length, 1)
    assert.equal(tracker.runIssueTests(1).passed, true)
    assert.equal(tracker.git(['branch', '--show-current']), 'main')
    assert.equal(existsSync(join(value.repo, 'scripts', '__pycache__')), false)
    assert.equal((tracker.dashboard().notifications as Record<string, unknown>).approval_required, 1)
    tracker.close()
  } finally {
    console.log = originalLog
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Scheduled dispatcher repairs multiple database Issues serially with one PR per Issue', async () => {
  const value = await fixture()
  const originalLog = console.log
  try {
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    for (const number of [1, 2, 3]) {
      writeFileSync(join(value.repo, '.test', `queue-${number}.mjs`), `
import { existsSync } from 'node:fs'
process.exit(existsSync('fixed-${number}.txt') ? 0 : 1)
`)
    }
    run('git', ['add', '.test'], value.repo)
    run('git', ['commit', '-m', 'test: add queued issue contracts'], value.repo)

    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
[ "$DSH_PERMISSION_MODE" = "workspace-write" ] || exit 97
[ "$DSH_TOOLS_MODE" = "native" ] || exit 98
branch=$(git branch --show-current)
case "$branch" in
  *issue-1-*) issue=1 ;;
  *issue-2-*) issue=2 ;;
  *issue-3-*) issue=3 ;;
  *) exit 96 ;;
esac
printf 'repair %s\n' "$issue" > "fixed-$issue.txt"
git add "fixed-$issue.txt"
git commit -m "fix: queued issue $issue"
`)
    chmodSync(binary, 0o755)

    const catalog = new Catalog(value.home)
    const registered = catalog.register(value.repo)
    catalog.close()
    const output: string[] = []
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
    for (const number of [1, 2, 3]) {
      assert.equal(await main([
        '--home', value.home, '--skill', String(registered.id), '--json', 'issue', 'create',
        '--title', `Queued repair ${number}`, '--body', `Repository contract ${number} reproduces the defect.`,
        '--test-path', `.test/queue-${number}.mjs`, '--test-command', `node .test/queue-${number}.mjs`,
      ]), 0)
    }
    output.length = 0
    setPolicy(value.home, 'scheduled', 60, String(registered.id))
    const mainBefore = run('git', ['rev-parse', 'main'], value.repo)
    assert.equal(await main(['--home', value.home, '--json', 'dispatch']), 0)
    const dispatched = JSON.parse(String(output.shift())) as Array<Record<string, unknown>>
    assert.deepEqual(dispatched.map(item => item.issue), [1, 2, 3])
    assert.equal(dispatched.every(item => Boolean((item.optimization as Record<string, unknown>).pull_request)), true)

    const tracker = new Tracker(value.repo, value.home)
    assert.equal(tracker.listIssues().length, 3)
    assert.equal(tracker.listRuns().length, 3)
    assert.equal(tracker.listPrs('open').length, 3)
    assert.equal(tracker.listWiki().length, 3)
    for (const number of [1, 2, 3]) {
      const pr = tracker.listPrs().find(item => Number(item.issue_number) === number)
      assert.ok(pr)
      tracker.git(['checkout', String(pr.head)])
      assert.equal(tracker.runIssueTests(number).passed, true)
    }
    assert.equal(tracker.git(['rev-parse', 'main']), mainBefore)
    assert.equal(tracker.git(['ls-tree', '-r', '--name-only', 'main']).includes('fixed-'), false)
    assert.equal(tracker.git(['remote', '-v'], false), '')
    tracker.close()
  } finally {
    console.log = originalLog
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Scheduled dispatcher continues with the next Issue after one repair fails', async () => {
  const value = await fixture()
  const originalLog = console.log
  try {
    mkdirSync(join(value.repo, '.test'), { recursive: true })
    for (const number of [1, 2]) writeFileSync(join(value.repo, '.test', `recovery-${number}.mjs`), number === 1 ? `
process.exit(0)
` : `
import { existsSync } from 'node:fs'
process.exit(existsSync('recovered-${number}.txt') ? 0 : 1)
`)
    run('git', ['add', '.test'], value.repo)
    run('git', ['commit', '-m', 'test: add dispatcher recovery contracts'], value.repo)
    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
branch=$(git branch --show-current)
case "$branch" in
  *issue-1-*) exit 0 ;;
  *issue-2-*) printf 'recovered\n' > recovered-2.txt; git add recovered-2.txt; git commit -m 'fix: second queued issue' ;;
  *) exit 96 ;;
esac
`)
    chmodSync(binary, 0o755)
    const catalog = new Catalog(value.home)
    const registered = catalog.register(value.repo)
    const tracker = catalog.tracker(String(registered.id))
    for (const number of [1, 2]) {
      const issue = tracker.createIssue(`Recovery repair ${number}`, `Contract ${number} reproduces the defect.`).issue
      tracker.addIssueTest(Number(issue.number), `.test/recovery-${number}.mjs`, `node .test/recovery-${number}.mjs`)
    }
    tracker.close(); catalog.close()
    setPolicy(value.home, 'scheduled', 60, String(registered.id))
    const output: string[] = []
    console.log = (...args: unknown[]) => { output.push(args.map(String).join(' ')) }
    assert.equal(await main(['--home', value.home, '--json', 'dispatch']), 1)
    const dispatched = JSON.parse(String(output.shift())) as Array<Record<string, unknown>>
    assert.match(String(dispatched[0]?.error), /created no commit/)
    assert.equal(((dispatched[1]?.optimization as Record<string, unknown>).pull_request as Record<string, unknown>).number, 1)
    const checked = new Tracker(value.repo, value.home)
    assert.equal(checked.listRuns().length, 2)
    assert.equal(checked.listPrs('open').length, 1)
    assert.equal(checked.issueStage(1), 'failed')
    assert.equal(checked.issueStage(2), 'review')
    checked.close()
  } finally {
    console.log = originalLog
    await rm(value.root, { recursive: true, force: true })
  }
})

test('TypeScript Web API serves bilingual workbench without local paths', async () => {
  const value = await fixture()
  const catalog = new Catalog(value.home)
  const registered = catalog.register(value.repo)
  const tracker = catalog.tracker(String(registered.id))
  const issue = tracker.createIssue('Broken parser', 'safe reproduction').issue
  tracker.upsertEvaluationGate({
    issueNumber: Number(issue.number), evalCommit: 'abc123safe', split: 'probe', status: 'pending',
    baselineScore: 0.25, baselinePassed: 1, baselineTotal: 4,
  })
  tracker.git(['checkout', '-b', 'skillhone/issue-1-broken-parser'])
  writeFileSync(join(value.repo, 'parser.ts'), 'export const repaired = true\n')
  tracker.git(['add', 'parser.ts']); tracker.git(['commit', '-m', 'repair parser'])
  tracker.createPr({ title: 'Repair parser', head: 'skillhone/issue-1-broken-parser', base: 'main', issueNumber: Number(issue.number) })
  tracker.close()
  const server = makeServer(catalog, '127.0.0.1', 0)
  try {
    await new Promise<void>(resolve => server.once('listening', () => resolve()))
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`
    const dashboard = await request(`${base}/api/dashboard`)
    const parsed = JSON.parse(dashboard.body) as { issues: unknown[]; pull_requests: Array<Record<string, unknown>>; notifications: { approval_required: number }; audit: Record<string, unknown> }
    assert.equal(parsed.issues.length, 1)
    assert.equal(parsed.pull_requests[0]?.decision_state, 'awaiting_approval')
    assert.equal(parsed.notifications.approval_required, 1)
    assert.equal(parsed.audit.integrity, 'verified')
    assert.equal(parsed.audit.runner_writes, 'blocked-during-run')
    assert.doesNotMatch(dashboard.body, new RegExp(value.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const issueDetail = JSON.parse((await request(
      `${base}/api/skills/${encodeURIComponent(String(registered.id))}/issues/1`,
    )).body) as { evaluation_gates: Array<Record<string, unknown>> }
    assert.equal(issueDetail.evaluation_gates.length, 1)
    assert.equal(issueDetail.evaluation_gates[0]?.baseline_score, 0.25)
    assert.doesNotMatch(JSON.stringify(issueDetail), new RegExp(value.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const mergePath = `${base}/api/skills/${encodeURIComponent(String(registered.id))}/pull-requests/1/merge`
    const denied = await post(mergePath)
    assert.equal(denied.status, 403)
    const before = catalog.tracker(String(registered.id)); assert.equal(before.pr(1).status, 'open'); before.close()
    const merged = await post(mergePath, { 'X-SkillHone-Confirm': 'merge' })
    assert.equal(merged.status, 200)
    const mergedBody = JSON.parse(merged.body) as Record<string, unknown>
    assert.equal(mergedBody.status, 'merged'); assert.equal(mergedBody.decision_state, 'merged')
    const after = catalog.tracker(String(registered.id))
    assert.equal(after.pr(1).status, 'merged'); assert.equal(after.issue(1).status, 'closed')
    assert.match(String(after.pr(1).diff_stat), /parser\.ts/)
    const changedFiles = after.prDetail(1).files as WorkRow[]
    assert.equal(changedFiles.some(item => item.path === 'parser.ts'), true)
    assert.match(String(changedFiles.find(item => item.path === 'parser.ts')?.patch), /\+export const repaired = true/)
    assert.match(readFileSync(join(value.repo, 'parser.ts'), 'utf8'), /repaired/)
    after.close()
    const skillPath = `${base}/api/skills/${encodeURIComponent(String(registered.id))}`
    const skillFallback = JSON.parse((await request(skillPath)).body) as { document: { name: string; content: string } }
    assert.equal(skillFallback.document.name, 'SKILL.md')
    assert.match(skillFallback.document.content, /name: web-search/)
    writeFileSync(join(value.repo, 'README.md'), '# Web Search\n\nRepository overview.\n')
    const skillReadme = JSON.parse((await request(skillPath)).body) as { document: { name: string; content: string } }
    assert.equal(skillReadme.document.name, 'README.md')
    assert.match(skillReadme.document.content, /Repository overview/)
    assert.doesNotMatch(JSON.stringify(skillReadme), new RegExp(value.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const html = await request(base)
    assert.match(html.body, /data-locale="en"/); assert.match(html.body, /data-locale="zh"/)
    const app = await request(`${base}/assets/app.js`)
    assert.match(app.body, /new URLSearchParams\(location\.search\)\.get\('lang'\)/)
    assert.match(app.body, /data-pr-tab=/)
    assert.match(app.body, /data-pr-panel=/)
    assert.match(app.body, /state\.prTab\s*=\s*button\.dataset\.prTab/)
    const styles = await request(`${base}/assets/styles.css`)
    assert.match(styles.body, /\.pr-subnav button/)
    assert.match(styles.body, /\.pr-tab-panel\[hidden\]/)
    assert.doesNotMatch(styles.body, /\.pr-closed,\.failed\{color:var\(--danger\)!important\}/)
    assert.match(styles.body, /\.pr-closed,\.run-state\.failed\{color:var\(--danger\)!important\}/)
    assert.ok(html.headers['content-security-policy'])
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    catalog.close(); await rm(value.root, { recursive: true, force: true })
  }
})

test('Web merge synchronizes a copy-mode Skill back to its Agent runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-web-sync-'))
  const home = join(root, 'home')
  const source = join(root, 'codex', 'skills', 'copy-web-skill')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'SKILL.md'), '---\nname: copy-web-skill\ndescription: test\n---\n')
  writeFileSync(join(source, 'version.txt'), 'original\n')
  const catalog = new Catalog(home)
  const imported = catalog.importPath(source, undefined, 'codex', 'copy')
  const skillId = String(imported.id)
  const tracker = catalog.tracker(skillId)
  const issue = tracker.createIssue('Runtime still uses the old version', 'safe reproduction').issue
  tracker.git(['checkout', '-b', 'skillhone/issue-1-copy-back'])
  writeFileSync(join(String(imported.root), 'version.txt'), 'repaired\n')
  tracker.git(['add', 'version.txt']); tracker.git(['commit', '-m', 'repair copied skill'])
  tracker.createPr({
    title: 'Repair copied Skill', head: 'skillhone/issue-1-copy-back', base: 'main', issueNumber: Number(issue.number),
  })
  tracker.close()
  const server = makeServer(catalog, '127.0.0.1', 0)
  try {
    await once(server, 'listening')
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}`
    const detail = JSON.parse((await request(
      `${base}/api/skills/${encodeURIComponent(skillId)}/pull-requests/1`,
    )).body) as Record<string, unknown>
    assert.equal(((detail.sync as WorkRow).state), 'awaiting_merge')
    assert.doesNotMatch(JSON.stringify(detail.sync), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const merge = await post(
      `${base}/api/skills/${encodeURIComponent(skillId)}/pull-requests/1/merge`,
      { 'X-SkillHone-Confirm': 'merge', 'X-SkillHone-Sync': 'apply' },
    )
    assert.equal(merge.status, 200)
    const merged = JSON.parse(merge.body) as Record<string, unknown>
    assert.equal(merged.status, 'merged')
    assert.equal((merged.sync as WorkRow).state, 'in_sync')
    assert.equal(merged.sync_error, undefined)
    assert.equal(readFileSync(join(source, 'version.txt'), 'utf8'), 'repaired\n')
    assert.doesNotMatch(merge.body, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const denied = await post(`${base}/api/skills/${encodeURIComponent(skillId)}/sync`)
    assert.equal(denied.status, 403)
    const repeated = await post(
      `${base}/api/skills/${encodeURIComponent(skillId)}/sync`,
      { 'X-SkillHone-Confirm': 'sync' },
    )
    assert.equal(repeated.status, 200)
    assert.equal((JSON.parse(repeated.body) as { sync: WorkRow }).sync.state, 'in_sync')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    catalog.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('Web CLI registers an explicitly selected repository in the workbench', async () => {
  const value = await fixture()
  const tracker = new Tracker(value.repo, value.home)
  tracker.createIssue('Visible from explicit repository', 'safe reproduction')
  tracker.close()
  const cli = fileURLToPath(new URL('../cli.js', import.meta.url))
  const child = spawn(process.execPath, [
    '--disable-warning=ExperimentalWarning', cli,
    '--home', value.home, '--repo', value.repo, 'web', '--port', '0',
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    const base = await new Promise<string>((resolve, reject) => {
      let output = ''
      const timer = setTimeout(() => reject(new Error('Web CLI did not start')), 10_000)
      child.stdout.on('data', chunk => {
        output += String(chunk)
        const match = output.match(/SkillHone: (http:\/\/127\.0\.0\.1:\d+)/)
        if (match?.[1]) { clearTimeout(timer); resolve(match[1]) }
      })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', code => {
        if (!output.includes('SkillHone:')) { clearTimeout(timer); reject(new Error(`Web CLI exited before startup (${code})`)) }
      })
    })
    const dashboard = JSON.parse((await request(`${base}/api/dashboard`)).body) as {
      skills: unknown[]; issues: Array<Record<string, unknown>>
    }
    assert.equal(dashboard.skills.length, 1)
    assert.equal(dashboard.issues.length, 1)
    assert.equal(dashboard.issues[0]?.title, 'Visible from explicit repository')
    assert.doesNotMatch(JSON.stringify(dashboard), new RegExp(value.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    child.kill('SIGTERM')
    await once(child, 'exit').catch(() => undefined)
    await rm(value.root, { recursive: true, force: true })
  }
})

test('Benchmark optimization reads every probe question regardless of row count or total length', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-probes-'))
  try {
    const questions = Array.from({ length: 25 }, (_, index) =>
      `PROBE-${String(index + 1).padStart(2, '0')}-${'x'.repeat(index === 24 ? 1500 : 400)}`,
    )
    writeFileSync(
      join(root, 'probe.jsonl'),
      questions.map(question => JSON.stringify({ question, verification: 'public verifier' })).join('\n') + '\n',
    )

    const actual = optimizationProbeQuestions(root)
    assert.deepEqual(actual, questions)
    assert.ok(actual.join('\n').length > 8000)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Benchmark mode keeps eval data separate and selects an improved local PR', async () => {
  const value = await fixture()
  try {
    const evalRepo = repository(value.root, 'web-search-eval')
    writeFileSync(join(evalRepo, 'probe.jsonl'), JSON.stringify({ question: 'PRIVATE PROBE', expected: { kind: 'integer', value: 1 } }) + '\n')
    writeFileSync(join(evalRepo, 'pr_val.jsonl'), JSON.stringify({ question: 'PRIVATE VALIDATION', expected: { kind: 'integer', value: 1 } }) + '\n')
    writeFileSync(join(evalRepo, 'evaluate.mjs'), `
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => index % 2 ? rows : [...rows, [value, all[index + 1]]], []))
if (!process.env.DSH_HOME?.replaceAll('\\\\', '/').endsWith('/roles/evaluator')) process.exit(42)
const improved = existsSync(join(args['--skill'], 'improved.txt'))
writeFileSync(args['--output'], JSON.stringify({score: improved ? 1.0 : 0.9, n_total: 10, n_passed: improved ? 10 : 9, traces: [{query: 'PRIVATE PROBE', passed: improved, error: improved ? '' : 'missing guidance'}]}))
`)
    run('git', ['add', '.'], evalRepo); run('git', ['commit', '-m', 'freeze evaluation'], evalRepo)

    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
case "$3" in
*"DeepSeek Harness Explorer"*)
  [ "$DSH_PERMISSION_MODE" = "workspace-write" ] || exit 99
  [ "$DSH_TOOLS_MODE" = "native" ] || exit 98
  case "$3" in
    *"skillhone-reference-skills"*"skillhub search"*"Downloaded Candidate Skills"*) ;;
    *) exit 96 ;;
  esac
  mkdir -p .git/skillhone-reference-skills/search-skill
  printf '%s\n' '# Search Skill' > .git/skillhone-reference-skills/search-skill/SKILL.md
  printf '## Capability Gap\nmissing search implementation\n## Downloaded Candidate Skills\n- slug: search-skill; URL: https://example.test/search-skill; revision: abc123; license: MIT; required tools: native web search; executable files: scripts/search.py\n## Reusable Files\n- scripts/search.py\n## Recommendation\nadapt the reviewed search script\n'
  exit 0
  ;;
esac
[ "$DSH_PERMISSION_MODE" = "workspace-write" ] || exit 97
case "$3" in
  *"https://example.test/search-skill"*) ;;
  *) exit 95 ;;
esac
printf 'benchmark improvement\n' > improved.txt
git add improved.txt
git commit -m 'improve benchmark score'
`)
    chmodSync(binary, 0o755)

    const tracker = new Tracker(value.repo, value.home)
    configureHarness(value.home, { provider: 'deepseek', model: 'optimizer-model', secret: 'optimizer-secret' })
    configureHarness(value.home, {
      role: 'evaluator', provider: 'benchmark-evaluator', model: 'evaluator-model', secret: 'evaluator-secret',
      baseUrl: 'https://example.invalid/v1', protocol: 'openai-completions',
    })
    assert.throws(
      () => initBenchmark(tracker, value.repo, 'node evaluate.mjs --skill {skill} --split {split} --output {output}'),
      /must be separate from the Skill repository/,
    )
    const campaign = initBenchmark(tracker, evalRepo, 'node evaluate.mjs --skill {skill} --split {split} --output {output}')
    assert.equal(campaign.eval_repository, 'web-search-eval')
    assert.doesNotMatch(JSON.stringify(campaign), new RegExp(value.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    const baseline = runBenchmark(tracker, 'probe')
    assert.equal(baseline.score, 0.9)
    assert.doesNotMatch(JSON.stringify(baseline), /PRIVATE PROBE/)
    assert.doesNotMatch(benchmarkPrompt(baseline, value.repo), /PRIVATE PROBE/)
    const optimizerPrompt = benchmarkPrompt(baseline, value.repo, 1, ['PRIVATE PROBE'])
    assert.match(optimizerPrompt, /PRIVATE PROBE/)
    assert.match(optimizerPrompt, /visible feedback, not held-out validation/)
    assert.match(optimizerPrompt, /Do not solve them, search for their answers/)
    assert.match(optimizerPrompt, /skillhub or an immutable public Git revision/)
    assert.match(optimizerPrompt, /adapt the smallest useful instructions, scripts, and references/)
    assert.match(optimizerPrompt, /Do not execute unreviewed downloaded code/)
    assert.match(optimizerPrompt, /references\/EXPLORATION\.md/)
    assert.match(optimizerPrompt, /at most twelve tool calls/)
    assert.doesNotMatch(optimizerPrompt, /PRIVATE VALIDATION/)
    const exploredPrompt = benchmarkPrompt(baseline, value.repo, 1, ['PRIVATE PROBE'], '## Candidate Skills\n- https://example.test/skill')
    assert.match(exploredPrompt, /downloaded and inspected reference copies/)
    assert.match(exploredPrompt, /https:\/\/example\.test\/skill/)
    assert.match(exploredPrompt, /immutable revision, license, scripts, required tools/)
    const mainBefore = tracker.git(['rev-parse', 'main'])
    setMergePolicy(value.home, 'automatic')
    const selected = optimizeBenchmark(tracker, 0.10)
    assert.equal(selected.status, 'selected')
    assert.equal(tracker.git(['log', '-1', '--no-merges', '--format=%an <%ae>']), 'SkillHone Test <test@skillhone.local>')
    assert.equal((selected.exploration_run as WorkRow).runner, 'deepseek-harness-explorer')
    assert.equal((selected.exploration_run as WorkRow).status, 'completed')
    assert.equal((selected.pull_request as Record<string, unknown>).issue_number, 1)
    assert.equal((selected.pull_request as Record<string, unknown>).status, 'merged')
    assert.equal((((selected.issue as WorkRow).evaluation_gates as WorkRow[]).every(gate => gate.status === 'passing')), true)
    assert.equal((selected.issue as WorkRow).status, 'closed')
    assert.match(String((selected.pull_request as Record<string, unknown>).body), /## Evaluation effect/)
    assert.match(String((selected.pull_request as Record<string, unknown>).body), /0\.9 \(9\/10\) → 1 \(10\/10\)/)
    assert.match(String((selected.pull_request as Record<string, unknown>).body), /visible probe feedback/)
    assert.match(String((selected.pull_request as Record<string, unknown>).body), /no verifier, gold answer, or held-out input/)
    assert.equal(tracker.listIssues().length, 1)
    assert.equal(tracker.listPrs('open').length, 0)
    assert.equal(tracker.issue(1).status, 'closed')
    const benchmarkIssue = tracker.issueDetail(1)
    assert.equal((benchmarkIssue.tests as WorkRow[]).length, 0)
    const gates = benchmarkIssue.evaluation_gates as WorkRow[]
    assert.equal(gates.length, 2)
    assert.equal(gates.every(gate => gate.status === 'passing'), true)
    assert.equal(gates.find(gate => gate.split === 'probe')?.candidate_score, 1)
    assert.doesNotMatch(JSON.stringify(gates), /PRIVATE PROBE|PRIVATE VALIDATION|web-search-eval/)
    assert.equal(tracker.git(['ls-files', '.test/benchmark']), '')
    assert.doesNotMatch(tracker.git(['diff', '--name-only', 'main...HEAD']), /\.test\/benchmark/)
    assert.equal(existsSync(join(value.repo, 'probe.jsonl')), false)
    assert.equal(existsSync(join(value.repo, 'pr_val.jsonl')), false)
    assert.notEqual(tracker.git(['rev-parse', 'main']), mainBefore)
    assert.equal(tracker.git(['remote', '-v'], false), '')
    const status = benchmarkStatus(tracker)
    assert.equal((status.runs as unknown[]).length, 5)
    assert.doesNotMatch(JSON.stringify(status), /PRIVATE PROBE|PRIVATE VALIDATION/)
    tracker.close()
  } finally { await rm(value.root, { recursive: true, force: true }) }
})

test('Benchmark mode keeps a non-improving branch out of the PR queue', async () => {
  const value = await fixture()
  try {
    const evalRepo = repository(value.root, 'flat-eval')
    writeFileSync(join(evalRepo, 'probe.jsonl'), JSON.stringify({ question: 'PRIVATE FLAT PROBE', verification: "scores = {'ok': True}" }) + '\n')
    writeFileSync(join(evalRepo, 'evaluate.mjs'), `
import { writeFileSync } from 'node:fs'
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => index % 2 ? rows : [...rows, [value, all[index + 1]]], []))
writeFileSync(args['--output'], JSON.stringify({score: 0.4, n_total: 1, n_passed: 0, traces: [{query: 'PRIVATE FLAT PROBE', passed: false, error: 'wrong answer included private text'}]}))
`)
    run('git', ['add', '.'], evalRepo); run('git', ['commit', '-m', 'freeze flat evaluation'], evalRepo)
    const binaryDir = join(value.home, 'harness', 'node_modules', '.bin'); mkdirSync(binaryDir, { recursive: true })
    const binary = join(binaryDir, 'dsh')
    writeFileSync(binary, `#!/bin/sh
case "$3" in
*"DeepSeek Harness Explorer"*)
  [ "$DSH_PERMISSION_MODE" = "workspace-write" ] || exit 99
  [ "$DSH_TOOLS_MODE" = "native" ] || exit 98
  mkdir -p .git/skillhone-reference-skills/search-skill
  printf '%s\n' '# Search Skill' > .git/skillhone-reference-skills/search-skill/SKILL.md
  printf '## Findings\nno hidden data inspected\n## Recommendation\nkeep the public procedure focused\n'
  exit 0
  ;;
esac
[ "$DSH_PERMISSION_MODE" = "workspace-write" ] || exit 97
printf 'candidate with no score gain\n' > flat-change.txt
git add flat-change.txt
git commit -m 'candidate without benchmark gain'
`)
    chmodSync(binary, 0o755)
    const tracker = new Tracker(value.repo, value.home)
    initBenchmark(tracker, evalRepo, 'node evaluate.mjs --skill {skill} --split {split} --output {output}')
    const result = optimizeBenchmark(tracker, 0.02)
    assert.equal(result.status, 'not-selected')
    assert.equal((((result.issue as WorkRow).evaluation_gates as WorkRow[]).every(gate => gate.status === 'failing')), true)
    assert.equal(tracker.listPrs().length, 0)
    assert.equal(tracker.listIssues().length, 1)
    assert.equal(tracker.listWiki().length, 1)
    const benchmarkIssue = tracker.issueDetail(1)
    assert.equal((benchmarkIssue.tests as WorkRow[]).length, 0)
    assert.equal((benchmarkIssue.evaluation_gates as WorkRow[])[0]?.status, 'failing')
    assert.equal((benchmarkIssue.runs as WorkRow[])[0]?.status, 'failed')
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE FLAT PROBE|private text/)
    tracker.close()
  } finally { await rm(value.root, { recursive: true, force: true }) }
})

test('Benchmark mode rejects Harness infrastructure failures without recording a score or Issue', async () => {
  const value = await fixture()
  try {
    const evalRepo = repository(value.root, 'failed-eval')
    writeFileSync(join(evalRepo, 'probe.jsonl'), JSON.stringify({ question: 'PRIVATE PROBE', verification: "scores = {'ok': True}" }) + '\n')
    writeFileSync(join(evalRepo, 'evaluate.mjs'), `
import { writeFileSync } from 'node:fs'
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => index % 2 ? rows : [...rows, [value, all[index + 1]]], []))
writeFileSync(args['--output'], JSON.stringify({score: 0, n_total: 1, n_passed: 0, traces: [{passed: false, error: 'provider-rate-limited'}]}))
`)
    run('git', ['add', '.'], evalRepo); run('git', ['commit', '-m', 'freeze failed evaluation'], evalRepo)
    const tracker = new Tracker(value.repo, value.home)
    initBenchmark(tracker, evalRepo, 'node evaluate.mjs --skill {skill} --split {split} --output {output}')
    assert.throws(() => runBenchmark(tracker, 'probe'), /benchmark infrastructure failed/)
    assert.equal(tracker.listIssues().length, 0)
    assert.equal(existsSync(join(tracker.dataDir, 'benchmark', 'history.jsonl')), false)
    tracker.close()
  } finally { await rm(value.root, { recursive: true, force: true }) }
})
