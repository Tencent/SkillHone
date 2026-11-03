import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { Catalog } from '../core/catalog.js'
import { setAuditPolicy, setMergePolicy, setPolicy } from '../core/settings.js'
import type { WorkRow } from '../core/tracker.js'

function imported(catalog: Catalog, root: string, name: string): WorkRow {
  const source = join(root, name)
  mkdirSync(source)
  writeFileSync(join(source, 'SKILL.md'), `---\nname: ${name}\ndescription: Isolated dashboard regression\n---\nDemo.\n`)
  return catalog.importPath(source)
}

test('Dashboard opens each available repository once and retains summaries and missing repositories', () => {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-dashboard-reads-'))
  const catalog = new Catalog(join(root, 'home'))
  try {
    const first = imported(catalog, root, 'first-skill')
    const second = imported(catalog, root, 'second-skill')
    const missing = imported(catalog, root, 'missing-skill')
    const tracker = catalog.tracker(String(first.id))
    const issue = tracker.createIssue('Public dashboard issue', 'A fresh running repair remains visible.').issue
    const run = tracker.startRun(Number(issue.number), 'isolated-test', 'test-branch')
    tracker.close()
    setPolicy(catalog.home, 'immediate', 60, String(first.id))
    setMergePolicy(catalog.home, 'automatic', String(first.id))
    rmSync(String(missing.root), { recursive: true, force: true })
    const expected = catalog.listSkills()
    let opens = 0
    const openTracker = catalog.tracker.bind(catalog)
    catalog.tracker = identifier => { opens += 1; return openTracker(identifier) }
    const dashboard = catalog.dashboard()
    assert.equal((dashboard.executor as WorkRow).selected, 'native')
    assert.equal((dashboard.harness as WorkRow).active_runs, 0, 'A non-DSH Run must not appear as a DSH job')
    assert.equal((dashboard.audit as WorkRow).runner_writes, 'trusted-host-session')
    assert.equal(opens, 2, 'One dashboard request must not reopen each available repository for its records')
    const skills = dashboard.skills as WorkRow[]
    assert.deepEqual(skills.map(({ automation: _automation, merge_policy: _merge, audit_policy: _audit, executor: _executor, ...skill }) => skill), expected)
    assert.equal(skills.find(skill => skill.id === missing.id)?.available, false)
    assert.equal(skills.find(skill => skill.id === second.id)?.issue_count, 0)
    assert.deepEqual(skills.find(skill => skill.id === first.id)?.automation, { mode: 'immediate', interval_minutes: 60, scope: 'skill' })
    assert.deepEqual(skills.find(skill => skill.id === first.id)?.merge_policy, { mode: 'automatic', scope: 'skill' })
    assert.equal((skills.find(skill => skill.id === second.id)?.automation as WorkRow).scope, 'default')
    assert.equal((dashboard.runs as WorkRow[]).find(record => record.id === run.id)?.status, 'running')
    assert.deepEqual((dashboard.issues as WorkRow[])[0]?.skill, { id: first.id, name: first.name })
    assert.equal((dashboard.issues as WorkRow[])[0]?.stage, 'optimizing')
    assert.equal((dashboard.issues as WorkRow[])[0]?.fingerprint, undefined)
    assert.equal((dashboard.runs as WorkRow[])[0]?.log_path, undefined)
    assert.equal((dashboard.audit as WorkRow).integrity, 'failed', 'Missing repositories retain their existing audit result')
  } finally { catalog.close(); rmSync(root, { recursive: true, force: true }) }
})

test('Successive dashboard requests read new records and detect signed audit changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'skillhone-dashboard-fresh-'))
  const catalog = new Catalog(join(root, 'home'))
  try {
    const skill = imported(catalog, root, 'signed-skill')
    setAuditPolicy(catalog.home, 'signed', String(skill.id))
    const before = catalog.dashboard()
    assert.equal((before.issues as WorkRow[]).length, 0)
    assert.equal((before.audit as WorkRow).integrity, 'verified')
    const tracker = catalog.tracker(String(skill.id))
    tracker.createIssue('New issue between requests', 'Dashboard data must not be cached between requests.')
    const dbPath = tracker.dbPath
    tracker.protectAuditTrail(() => {
      const protectedRead = catalog.dashboard()
      assert.equal((protectedRead.audit as WorkRow).integrity, 'verified')
      assert.equal((protectedRead.issues as WorkRow[]).length, 1)
      const writer = new DatabaseSync(dbPath)
      try { assert.throws(() => writer.exec("UPDATE issue SET status='closed'"), /locked|busy/i) }
      finally { writer.close() }
    })
    tracker.close()
    const after = catalog.dashboard()
    assert.equal((after.issues as WorkRow[]).length, 1)
    assert.equal((after.audit as WorkRow).integrity, 'verified')
    const db = new DatabaseSync(dbPath)
    try { db.exec("UPDATE issue SET title='Tampered offline'") } finally { db.close() }
    const tampered = catalog.dashboard()
    assert.equal((tampered.audit as WorkRow).integrity, 'failed')
    assert.equal(((tampered.skills as WorkRow[])[0]?.audit as WorkRow).mode, 'signed')
    assert.equal((tampered.issues as WorkRow[])[0]?.title, 'Tampered offline')
  } finally { catalog.close(); rmSync(root, { recursive: true, force: true }) }
})
