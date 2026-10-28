import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import test from 'node:test'

import { Catalog } from '../core/catalog.js'
import { Tracker } from '../core/tracker.js'
import { run } from '../core/util.js'

function repository(parent: string): string {
  const root = join(parent, 'sample-skill')
  mkdirSync(root, { recursive: true })
  run('git', ['init', '-b', 'main'], root)
  writeFileSync(join(root, 'SKILL.md'), '---\nname: sample-skill\ndescription: Test fixture.\n---\n')
  run('git', ['add', 'SKILL.md'], root)
  run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], root)
  return root
}

test('project state is a direct child of the projects directory and survives reopening', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-paths-'))
  const home = join(root, 'state home')
  const repo = repository(join(root, 'checkout with spaces'))
  let tracker: Tracker | undefined
  try {
    tracker = new Tracker(repo, home)
    assert.equal(dirname(tracker.dataDir), join(home, 'projects'))
    assert.match(basename(tracker.dataDir), /^sample-skill-[a-f0-9]{12}$/)
    const id = tracker.project().id
    const issue = tracker.createIssue('Persistent evidence', 'Synthetic reproduction').issue
    tracker.close()
    tracker = undefined
    tracker = new Tracker(repo, home)
    assert.equal(tracker.project().id, id)
    assert.equal(tracker.issueDetail(Number(issue.number)).title, 'Persistent evidence')
  } finally {
    tracker?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('repositories with the same directory name retain separate project state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-paths-'))
  const home = join(root, 'home')
  const trackers: Tracker[] = []
  try {
    const first = new Tracker(repository(join(root, 'one')), home)
    trackers.push(first)
    const second = new Tracker(repository(join(root, 'two')), home)
    trackers.push(second)
    assert.notEqual(first.project().id, second.project().id)
    assert.notEqual(first.dataDir, second.dataDir)
    const firstIssue = first.createIssue('First repository', 'First evidence').issue
    const secondIssue = second.createIssue('Second repository', 'Second evidence').issue
    assert.equal(first.issueDetail(Number(firstIssue.number)).title, 'First repository')
    assert.equal(second.issueDetail(Number(secondIssue.number)).title, 'Second repository')
  } finally {
    for (const tracker of trackers) tracker.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('catalog registration initializes usable project state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skillhone-paths-'))
  const home = join(root, 'home')
  let catalog: Catalog | undefined
  let tracker: Tracker | undefined
  try {
    const repo = repository(root)
    catalog = new Catalog(home)
    const registered = catalog.register(repo)
    tracker = new Tracker(repo, home)
    assert.equal(registered.id, tracker.project().id)
    assert.equal(dirname(tracker.dataDir), join(home, 'projects'))
    const issue = tracker.createIssue('Registered repository', 'Synthetic evidence').issue
    assert.equal(tracker.issueDetail(Number(issue.number)).title, 'Registered repository')
  } finally {
    tracker?.close()
    catalog?.close()
    await rm(root, { recursive: true, force: true })
  }
})
