import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { status as harnessStatus } from './harness.js'
import { auditPolicy, mergePolicy, policy, loadSettings, resolveHome } from './settings.js'
import { Tracker, type WorkRow } from './tracker.js'
import { gitRoot, now, projectId, redact, run, slug } from './util.js'

const ignored = new Set(['.git', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.DS_Store', 'node_modules'])
const bareSecret = /(?:^|[^A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,})/g
const assignedSecret = /(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*["']?([^\s"',}]{12,})/gi
const javascriptEnvironmentReference = /^process\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[["'][A-Za-z_][A-Za-z0-9_]*["']\])$/
const placeholders = ['example', 'placeholder', 'redacted', 'dummy', 'changeme', 'your', 'xxx']

type SkillRow = { id: string; name: string; root: string; source: string; source_digest: string | null; created_at: string }
export type ImportMode = 'copy' | 'managed'

function repositoryDocument(root: string): WorkRow | null {
  for (const name of ['README.md', 'SKILL.md']) {
    const path = join(root, name)
    if (!existsSync(path) || !statSync(path).isFile()) continue
    if (statSync(path).size > 256 * 1024) return { name, content: '', truncated: true }
    return { name, content: redact(readFileSync(path, 'utf8')), truncated: false }
  }
  return null
}

function walk(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.endsWith('.pyc') || entry.name.endsWith('.pyo')) continue
    const path = join(root, entry.name)
    if (lstatSync(path).isSymbolicLink()) throw new Error(`skill contains a symbolic link: ${relative(root, path)}`)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files.sort()
}

function nameFromSkill(root: string): string {
  const manifest = join(root, 'SKILL.md')
  if (!existsSync(manifest)) throw new Error(`not an Agent skill (SKILL.md missing): ${root}`)
  const match = readFileSync(manifest, 'utf8').match(/^name:\s*["']?([^"'\n]+)/m)
  return slug(match?.[1]?.trim() || basename(root))
}

function preflight(root: string): void {
  for (const path of walk(root)) {
    if (statSync(path).size > 2 * 1024 * 1024) continue
    const data = readFileSync(path)
    if (data.includes(0)) continue
    const text = data.toString('utf8')
    // Variable references contain no credential. Keep defaults/assignments and
    // literal suffixes visible, and scan the original text for token signatures.
    const assignments = text
      .replace(/\$\{[A-Za-z_][A-Za-z0-9_]*(?::?\?[^{}\n]*)?\}|\$[A-Za-z_][A-Za-z0-9_]*/g, '$ENV')
      .replace(/process\.env\[["'][A-Za-z_][A-Za-z0-9_]*["']\]/g, '$ENV')
    const assigned = [...assignments.matchAll(assignedSecret)]
      .map(match => match[1] ?? '')
      .filter(value => !placeholders.some(word => value.toLowerCase().includes(word)))
      .filter(value => !javascriptEnvironmentReference.test(value))
    if (bareSecret.test(text) || assigned.length > 0 || text.includes('-----BEGIN PRIVATE KEY-----')) {
      bareSecret.lastIndex = 0
      throw new Error(`possible credential in ${relative(root, path)}; redact it before import`)
    }
    bareSecret.lastIndex = 0
  }
}

function digest(root: string): string {
  const hash = createHash('sha256')
  for (const path of walk(root)) hash.update(relative(root, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path)).update('\0')
  return hash.digest('hex')
}

function sanitized(item: WorkRow): WorkRow {
  const copy = { ...item }
  delete copy.fingerprint
  delete copy.log_path
  return copy
}

function sanitizedSync(item: WorkRow): WorkRow {
  const copy = { ...item }
  delete copy.path
  delete copy.backup_path
  delete copy.backup
  return copy
}

export class Catalog {
  readonly home: string
  readonly repositoriesDir: string
  readonly dbPath: string
  private readonly db: DatabaseSync

  constructor(home?: string) {
    this.home = resolveHome(home)
    this.repositoriesDir = join(this.home, 'skills')
    this.dbPath = join(this.home, 'catalog.db')
    mkdirSync(this.repositoriesDir, { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec(`CREATE TABLE IF NOT EXISTS skill (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, root TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL, source_digest TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_origin (
      skill_id TEXT NOT NULL, path TEXT NOT NULL UNIQUE, runtime TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('copy','managed')), backup_path TEXT,
      source_digest TEXT,
      created_at TEXT NOT NULL, PRIMARY KEY(skill_id,path)
    )`)
    const originColumns = this.db.prepare('PRAGMA table_info(skill_origin)').all() as Array<{ name: string }>
    if (!originColumns.some(column => column.name === 'source_digest')) {
      this.db.exec('ALTER TABLE skill_origin ADD COLUMN source_digest TEXT')
    }
  }

  close(): void { this.db.close() }

  private row(identifier: string): SkillRow {
    const value = this.db.prepare('SELECT * FROM skill WHERE id=? OR name=?').get(identifier, identifier) as SkillRow | undefined
    if (!value) throw new Error(`skill ${JSON.stringify(identifier)} not found`)
    return value
  }

  register(root: string, source = 'existing', sourceDigest?: string, name?: string): WorkRow {
    const repository = gitRoot(root)
    const skillName = slug(name ?? nameFromSkill(repository))
    const identifier = projectId(repository)
    const existing = this.db.prepare('SELECT * FROM skill WHERE name=?').get(skillName) as SkillRow | undefined
    if (existing && resolve(existing.root) !== repository) throw new Error(`skill ${JSON.stringify(skillName)} is already registered from another repository`)
    this.db.prepare(`INSERT OR REPLACE INTO skill(id,name,root,source,source_digest,created_at)
      VALUES (?,?,?,?,?,COALESCE((SELECT created_at FROM skill WHERE id=?),?))`).run(
      identifier, skillName, repository, source, sourceDigest ?? null, identifier, now(),
    )
    const tracker = new Tracker(repository, this.home); tracker.close()
    return this.skill(identifier, true)
  }

  private recordOrigin(skillId: string, path: string, runtime: string, mode: ImportMode, backupPath?: string, sourceDigest?: string): void {
    this.db.prepare(`INSERT INTO skill_origin(skill_id,path,runtime,mode,backup_path,source_digest,created_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
      skill_id=excluded.skill_id,runtime=excluded.runtime,mode=excluded.mode,
      backup_path=COALESCE(excluded.backup_path,skill_origin.backup_path),
      source_digest=COALESCE(excluded.source_digest,skill_origin.source_digest)`).run(
      skillId, resolve(path), runtime, mode, backupPath ?? null, sourceDigest ?? null, now(),
    )
  }

  private connectManaged(skillId: string, source: string, target: string, runtime: string): string | undefined {
    if (resolve(source) === resolve(target)) return undefined
    if (lstatSync(source).isSymbolicLink() && resolve(realpathSync(source)) === resolve(realpathSync(target))) return undefined
    const backup = `${source}.skillhone-backup-${Date.now()}`
    renameSync(source, backup)
    try { symlinkSync(target, source, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (error) { renameSync(backup, source); throw error }
    this.recordOrigin(skillId, source, runtime, 'managed', backup)
    return backup
  }

  importPath(source: string, name?: string, sourceLabel = 'path', mode: ImportMode = 'copy'): WorkRow {
    const sourceRoot = resolve(source)
    if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) throw new Error(`skill directory not found: ${sourceRoot}`)
    const targetName = slug(name ?? nameFromSkill(sourceRoot))
    preflight(sourceRoot)
    const sourceDigest = digest(sourceRoot)
    const target = join(this.repositoriesDir, targetName)
    const existing = this.db.prepare('SELECT * FROM skill WHERE name=?').get(targetName) as SkillRow | undefined
    if (existing) {
      if (existing.source_digest === sourceDigest) {
        this.recordOrigin(existing.id, sourceRoot, sourceLabel, mode, undefined, sourceDigest)
        const backup = mode === 'managed' ? this.connectManaged(existing.id, sourceRoot, existing.root, sourceLabel) : undefined
        return { ...this.skill(existing.id, true), import_status: 'already-imported', import_mode: mode === 'managed' ? 'takeover' : mode, ...(backup ? { backup } : {}) }
      }
      throw new Error(`skill ${JSON.stringify(targetName)} already exists with different contents; use --name`)
    }
    if (existsSync(target)) throw new Error(`managed repository already exists: ${target}`)
    cpSync(sourceRoot, target, {
      recursive: true,
      filter: path => !relative(sourceRoot, path).split(/[\\/]/).some(part => ignored.has(part) || part.endsWith('.pyc') || part.endsWith('.pyo')),
    })
    try {
      run('git', ['init', '-b', 'main'], target)
      run('git', ['config', 'user.name', 'SkillHone'], target)
      run('git', ['config', 'user.email', 'skillhone@local.invalid'], target)
      run('git', ['add', '.'], target)
      run('git', ['commit', '-m', `Import ${targetName} skill`], target)
      const registered = this.register(target, sourceLabel, sourceDigest, targetName)
      const identifier = String(registered.id)
      this.recordOrigin(identifier, sourceRoot, sourceLabel, mode, undefined, sourceDigest)
      const backup = mode === 'managed' ? this.connectManaged(identifier, sourceRoot, target, sourceLabel) : undefined
      return { ...registered, import_status: 'imported', import_mode: mode === 'managed' ? 'takeover' : mode, ...(backup ? { backup } : {}) }
    } catch (error) {
      rmSync(target, { recursive: true, force: true })
      throw error
    }
  }

  static sourceRoots(runtime: string): string[] {
    if (runtime === 'codex') return [join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills')]
    if (runtime === 'cursor') return [join(homedir(), '.cursor', 'skills')]
    if (runtime === 'claude-code') return [join(homedir(), '.claude', 'skills')]
    if (runtime === 'pi') return [join(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent'), 'skills')]
    if (runtime === 'zcode') return [join(homedir(), '.zcode', 'skills')]
    if (runtime === 'all') return [
      ...Catalog.sourceRoots('codex'), ...Catalog.sourceRoots('cursor'),
      ...Catalog.sourceRoots('claude-code'), ...Catalog.sourceRoots('pi'),
      ...Catalog.sourceRoots('zcode'),
    ]
    throw new Error(`unsupported Agent runtime: ${runtime}`)
  }

  static discover(runtime: string): string[] {
    const found = new Set<string>()
    for (const root of Catalog.sourceRoots(runtime)) {
      if (!existsSync(root)) continue
      for (const first of readdirSync(root, { withFileTypes: true })) {
        if (!first.isDirectory()) continue
        const direct = join(root, first.name)
        if (existsSync(join(direct, 'SKILL.md'))) found.add(resolve(direct))
        if (first.name.startsWith('.')) for (const second of readdirSync(direct, { withFileTypes: true })) {
          const nested = join(direct, second.name)
          if (second.isDirectory() && existsSync(join(nested, 'SKILL.md'))) found.add(resolve(nested))
        }
      }
    }
    return [...found].sort((a, b) => a.localeCompare(b))
  }

  importRuntime(runtime: string, mode: ImportMode = 'copy'): WorkRow[] {
    const results: WorkRow[] = []
    const seen = new Set<string>()
    for (const source of Catalog.discover(runtime)) {
      try {
        const name = nameFromSkill(source)
        if (seen.has(name)) continue
        results.push(this.importPath(source, undefined, runtime, mode)); seen.add(name)
      } catch (error) {
        results.push({ name: basename(source), source: runtime, import_status: 'error', error: redact(error) })
      }
    }
    return results
  }

  syncStatus(identifier?: string): WorkRow[] {
    const query = identifier
      ? `SELECT o.path,o.runtime,o.mode,o.backup_path,o.source_digest AS origin_digest,
                s.id AS skill_id,s.name,s.root
         FROM skill_origin o JOIN skill s ON s.id=o.skill_id WHERE s.id=? OR s.name=? ORDER BY s.name,o.runtime`
      : `SELECT o.path,o.runtime,o.mode,o.backup_path,o.source_digest AS origin_digest,
                s.id AS skill_id,s.name,s.root
         FROM skill_origin o JOIN skill s ON s.id=o.skill_id ORDER BY s.name,o.runtime`
    const statement = this.db.prepare(query)
    return ((identifier ? statement.all(identifier, identifier) : statement.all()) as WorkRow[]).map(item => {
      const mode = item.mode === 'managed' ? 'takeover' : String(item.mode)
      const root = String(item.root)
      const path = String(item.path)
      const result: WorkRow = { ...item, mode }
      delete result.root
      delete result.origin_digest
      if (mode === 'takeover') {
        const active = existsSync(path) && lstatSync(path).isSymbolicLink()
          && resolve(realpathSync(path)) === resolve(realpathSync(root))
        return {
          ...result,
          state: active ? 'takeover_active' : 'takeover_disconnected',
          sync_required: false,
          can_apply: false,
          message: active
            ? 'The runtime already uses the SkillHone repository; merged changes need no copy-back.'
            : 'The runtime is no longer linked to the SkillHone repository.',
        }
      }
      if (!existsSync(path) || !statSync(path).isDirectory()) return {
        ...result, state: 'source_missing', sync_required: true, can_apply: false,
        message: 'The original runtime Skill directory is unavailable.',
      }
      const tracker = new Tracker(root, this.home)
      try {
        if (tracker.listPrs('open').length) return {
          ...result, state: 'awaiting_merge', sync_required: false, can_apply: false,
          message: 'A local PR is still open. Review or merge it before syncing.',
        }
        if (tracker.git(['status', '--porcelain']) || tracker.git(['branch', '--show-current']) !== tracker.project().default_branch) return {
          ...result, state: 'repository_not_ready', sync_required: false, can_apply: false,
          message: 'The SkillHone repository must be clean and on its default branch before syncing.',
        }
        const sourceDigest = digest(path)
        if (item.origin_digest && sourceDigest !== item.origin_digest) return {
          ...result, state: 'source_changed', sync_required: true, can_apply: false,
          message: 'The runtime Skill changed after import. Review those changes before applying SkillHone output.',
        }
        const synchronized = sourceDigest === digest(root)
        return {
          ...result,
          state: synchronized ? 'in_sync' : 'ready_to_sync',
          sync_required: !synchronized,
          can_apply: !synchronized,
          message: synchronized
            ? 'The runtime Skill already matches the merged SkillHone repository.'
            : 'A merged SkillHone change is ready to copy back to the runtime Skill.',
        }
      } finally { tracker.close() }
    })
  }

  webSyncStatus(identifier: string): WorkRow | null {
    const origins = this.syncStatus(identifier)
    if (!origins.length) return null
    const copyOrigins = origins.filter(item => item.mode === 'copy')
    const ready = copyOrigins.filter(item => item.state === 'ready_to_sync')
    const blocker = copyOrigins.find(item => item.state !== 'in_sync' && item.state !== 'ready_to_sync')
    const canApply = ready.length > 0 && copyOrigins.every(item => item.state === 'in_sync' || item.can_apply === true)
    let state: string
    if (copyOrigins.length === 0) state = String(origins[0]?.state ?? 'takeover_active')
    else if (blocker) state = String(blocker.state)
    else if (copyOrigins.every(item => item.state === 'in_sync')) state = 'in_sync'
    else state = canApply ? 'ready_to_sync' : 'in_sync'
    return {
      state,
      sync_required: ready.length > 0,
      can_apply: canApply,
      origins: origins.map(sanitizedSync),
    }
  }

  applyToOrigins(identifier: string): WorkRow[] {
    const skill = this.row(identifier)
    const tracker = this.tracker(skill.id)
    try {
      if (tracker.git(['status', '--porcelain'])) throw new Error('managed Skill repository has uncommitted changes')
      if (tracker.git(['branch', '--show-current']) !== tracker.project().default_branch) throw new Error('merge and check out the default branch before applying')
      if (tracker.listPrs('open').length) throw new Error('merge or close open local PRs before applying')
    } finally { tracker.close() }
    const origins = this.syncStatus(skill.id)
    const blocked = origins.find(origin =>
      origin.mode === 'copy' && origin.state !== 'in_sync' && origin.can_apply !== true,
    )
    if (blocked) throw new Error(String(blocked.message ?? 'the runtime Skill is not ready to sync'))
    const results: WorkRow[] = []
    for (const origin of origins) {
      if (origin.mode === 'takeover' || origin.mode === 'managed') {
        results.push({ ...origin, status: 'already-managed' }); continue
      }
      if (origin.state === 'in_sync') {
        results.push({ ...origin, status: 'already-synced' }); continue
      }
      if (!origin.can_apply) throw new Error(String(origin.message ?? 'the runtime Skill is not ready to sync'))
      const target = String(origin.path)
      if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`original Skill directory is unavailable: ${target}`)
      const backup = `${target}.skillhone-backup-${Date.now()}`
      cpSync(target, backup, { recursive: true })
      for (const entry of readdirSync(target, { withFileTypes: true })) {
        if (entry.name === '.git') continue
        rmSync(join(target, entry.name), { recursive: true, force: true })
      }
      for (const entry of readdirSync(skill.root, { withFileTypes: true })) {
        if (entry.name === '.git') continue
        cpSync(join(skill.root, entry.name), join(target, entry.name), { recursive: true })
      }
      this.recordOrigin(skill.id, target, String(origin.runtime), 'copy', backup, digest(target))
      results.push({ ...origin, status: 'applied', backup })
    }
    return results
  }

  applyToOriginsForWeb(identifier: string): WorkRow {
    try {
      const results = this.applyToOrigins(identifier).map(sanitizedSync)
      return { results, sync: this.webSyncStatus(identifier) }
    } catch {
      throw new Error('runtime Skill was not synchronized because a copy-back safety check did not pass')
    }
  }

  tracker(identifier: string): Tracker {
    const item = this.row(identifier)
    if (!existsSync(item.root)) throw new Error(`repository for skill ${JSON.stringify(item.name)} is unavailable`)
    return new Tracker(item.root, this.home)
  }

  skill(identifier: string, includeRoot = false, includeDocument = false): WorkRow {
    const item = this.row(identifier)
    if (!existsSync(item.root)) return {
      id: item.id, name: item.name, source: item.source, created_at: item.created_at,
      available: false, repository_status: 'unavailable',
      default_branch: 'unavailable', issue_count: 0, open_issue_count: 0,
      pr_count: 0, open_pr_count: 0, wiki_count: 0, completed_run_count: 0,
      ...(includeRoot ? { root: item.root } : {}),
    }
    const tracker = this.tracker(item.id)
    try {
      const runs = tracker.listRuns()
      const result: WorkRow = {
        id: item.id, name: item.name, source: item.source,
        available: true, repository_status: 'available',
        default_branch: tracker.project().default_branch, created_at: item.created_at,
        audit: tracker.auditStatus(),
        issue_count: tracker.listIssues().length, open_issue_count: tracker.listIssues('open').length,
        pr_count: tracker.listPrs().length, open_pr_count: tracker.listPrs('open').length,
        wiki_count: tracker.listWiki().length,
        completed_run_count: runs.filter(runItem => runItem.status === 'completed').length,
      }
      if (includeDocument) result.document = repositoryDocument(item.root)
      if (includeRoot) result.root = item.root
      return result
    } finally { tracker.close() }
  }

  listSkills(includeRoot = false): WorkRow[] {
    const identifiers = (this.db.prepare('SELECT id FROM skill ORDER BY name').all() as { id: string }[]).map(item => item.id)
    return identifiers.map(identifier => this.skill(identifier, includeRoot))
  }

  dashboard(): WorkRow {
    const skills = this.listSkills()
    const issues: WorkRow[] = [], prs: WorkRow[] = [], runs: WorkRow[] = [], wiki: WorkRow[] = []
    for (const skill of skills) {
      if (skill.available === false) continue
      const tracker = this.tracker(String(skill.id))
      const owner = { id: skill.id, name: skill.name }
      try {
        for (const value of tracker.listIssues()) issues.push({ ...sanitized(value), skill: owner, stage: tracker.issueStage(Number(value.number)) })
        for (const value of tracker.listPrs()) prs.push({
          ...value, skill: owner,
          decision_state: value.status === 'open' ? 'awaiting_approval' : value.status,
        })
        for (const value of tracker.listRuns()) runs.push({ ...sanitized(value), skill: owner })
        for (const value of tracker.listWiki()) wiki.push({ ...value, skill: owner })
      } finally { tracker.close() }
    }
    issues.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    prs.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    runs.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
    wiki.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    const activeRuns = runs.filter(item => item.status === 'running').length
    const harness = harnessStatus(this.home)
    const launchMode = harness.installed ? 'managed' : 'unavailable'
    for (const skill of skills) {
      skill.automation = policy(this.home, String(skill.id))
      skill.merge_policy = mergePolicy(this.home, String(skill.id))
      skill.audit_policy = auditPolicy(this.home, String(skill.id))
    }
    const approvals = prs.filter(item => item.decision_state === 'awaiting_approval').map(item => ({
      skill: item.skill,
      pr_number: item.number,
      issue_number: item.issue_number,
      title: item.title,
      state: 'awaiting_approval',
    }))
    const auditModes = new Set(skills.filter(skill => skill.available !== false).map(skill => String((skill.audit as WorkRow | undefined)?.mode ?? 'standard')))
    return {
      skills, issues, pull_requests: prs, runs, wiki,
      audit: {
        integrity: skills.every(skill => (skill.audit as WorkRow | undefined)?.integrity === 'verified') ? 'verified' : 'failed',
        mode: auditModes.size > 1 ? 'mixed' : (auditModes.values().next().value ?? auditPolicy(this.home).mode),
        authority: 'skillhone-host', runner_writes: 'blocked-during-run',
      },
      notifications: {
        approval_required: approvals.length,
        message: approvals.length === 1 ? '1 optimized Skill PR awaits approval.'
          : approvals.length > 1 ? `${approvals.length} optimized Skill PRs await approval.`
            : 'No optimized Skill PRs await approval.',
        items: approvals,
      },
      harness: { state: activeRuns ? 'running' : (harness.installed ? 'idle' : 'unavailable'), active_runs: activeRuns, launch_mode: launchMode, ...harness },
      automation: { default: loadSettings(this.home).automation.default },
      merge_policy: mergePolicy(this.home),
    }
  }

  issueDetail(skillId: string, number: number): WorkRow {
    const tracker = this.tracker(skillId)
    try { return { ...tracker.issueDetail(number), skill: { id: skillId, name: this.row(skillId).name } } }
    finally { tracker.close() }
  }

  prDetail(skillId: string, number: number): WorkRow {
    const tracker = this.tracker(skillId)
    try {
      const value = tracker.prDetail(number)
      return {
        ...value, skill: { id: skillId, name: this.row(skillId).name },
        decision_state: value.status === 'open' ? 'awaiting_approval' : value.status,
        sync: this.webSyncStatus(skillId),
      }
    }
    finally { tracker.close() }
  }

  mergePr(skillId: string, number: number, applyToRuntime = false): WorkRow {
    const tracker = this.tracker(skillId)
    let value: WorkRow
    try {
      value = tracker.mergePr(number, true)
    } finally { tracker.close() }
    let syncError: string | undefined
    if (applyToRuntime) {
      try { this.applyToOrigins(skillId) }
      catch { syncError = 'runtime Skill was not synchronized because a copy-back safety check did not pass' }
    }
    return {
      ...value,
      skill: { id: skillId, name: this.row(skillId).name },
      decision_state: 'merged',
      sync: this.webSyncStatus(skillId),
      ...(syncError ? { sync_error: syncError } : {}),
    }
  }

  wikiDetail(skillId: string, key: string): WorkRow {
    const tracker = this.tracker(skillId)
    try { return { ...tracker.wiki(key), skill: { id: skillId, name: this.row(skillId).name } } }
    finally { tracker.close() }
  }
}
