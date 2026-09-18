import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

import { gitRoot, now, projectId, redact, run, sha256, slug } from './util.js'
import { resolveHome } from './settings.js'
import { repairPrBody } from './pr-description.js'

export type WorkRow = Record<string, unknown>

export interface Project {
  id: string
  name: string
  root: string
  default_branch: string
}

function row(value: unknown): WorkRow {
  if (!value || typeof value !== 'object') throw new Error('database record not found')
  return value as WorkRow
}

function rows(value: unknown[]): WorkRow[] { return value as WorkRow[] }

export class Tracker {
  readonly root: string
  readonly home: string
  readonly dataDir: string
  readonly dbPath: string
  readonly logsDir: string
  private readonly db: DatabaseSync

  constructor(root = '.', home?: string) {
    this.root = gitRoot(root)
    this.home = resolveHome(home)
    this.dataDir = join(this.home, 'projects', projectId(this.root))
    this.dbPath = join(this.dataDir, 'skillhone.db')
    this.logsDir = join(this.dataDir, 'runs')
    mkdirSync(this.logsDir, { recursive: true })
    this.db = new DatabaseSync(this.dbPath)
    this.db.exec('PRAGMA foreign_keys = ON')
    this.initialize()
  }

  close(): void { this.db.close() }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL,
        default_branch TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS issue (
        number INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL, body TEXT NOT NULL, fingerprint TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('open','closed')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS issue_open_fingerprint
        ON issue(fingerprint) WHERE status='open';
      CREATE TABLE IF NOT EXISTS pull_request (
        number INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER REFERENCES issue(number),
        title TEXT NOT NULL, body TEXT NOT NULL,
        head TEXT NOT NULL, base TEXT NOT NULL, base_commit TEXT,
        status TEXT NOT NULL CHECK(status IN ('open','merged','closed')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run (
        id TEXT PRIMARY KEY, issue_number INTEGER REFERENCES issue(number),
        runner TEXT NOT NULL, status TEXT NOT NULL,
        branch TEXT NOT NULL, log_path TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT,
        tool_call_count INTEGER
      );
      CREATE TABLE IF NOT EXISTS wiki_entry (
        slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
        issue_number INTEGER REFERENCES issue(number),
        pr_number INTEGER REFERENCES pull_request(number),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS issue_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER NOT NULL REFERENCES issue(number),
        path TEXT NOT NULL, command TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','passing','failing')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(issue_number, path, command)
      );
      CREATE TABLE IF NOT EXISTS evaluation_gate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        issue_number INTEGER NOT NULL REFERENCES issue(number),
        eval_commit TEXT NOT NULL, split TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','passing','failing')),
        baseline_score REAL NOT NULL, baseline_passed INTEGER NOT NULL,
        baseline_total INTEGER NOT NULL, candidate_score REAL,
        candidate_passed INTEGER, candidate_total INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(issue_number, eval_commit, split)
      );
    `)
    const columns = rows(this.db.prepare('PRAGMA table_info(run)').all())
    if (!columns.some(item => item.name === 'tool_call_count')) {
      this.db.exec('ALTER TABLE run ADD COLUMN tool_call_count INTEGER')
    }
    const prColumns = rows(this.db.prepare('PRAGMA table_info(pull_request)').all())
    if (!prColumns.some(item => item.name === 'base_commit')) {
      this.db.exec('ALTER TABLE pull_request ADD COLUMN base_commit TEXT')
    }
    const remote = this.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], false)
    const defaultBranch = remote ? remote.replace(/^origin\//, '') : this.detectDefaultBranch()
    this.db.prepare('INSERT OR IGNORE INTO project VALUES (?,?,?,?,?)').run(
      projectId(this.root), basename(this.root), this.root, defaultBranch, now(),
    )
  }

  private detectDefaultBranch(): string {
    for (const branch of ['main', 'master']) {
      if (this.git(['rev-parse', '--verify', branch], false)) return branch
    }
    return this.git(['branch', '--show-current'], false) || 'main'
  }

  git(args: string[], check = true): string { return run('git', args, this.root, check) }

  protectAuditTrail<T>(work: () => T): T {
    // Keep the host-owned Issue/PR/Run/Wiki database under a write lock while
    // an external repair runtime is active. A nested SkillHone process (or any
    // other SQLite client) can read the trail, but cannot rewrite or close the
    // records that describe the repair it is currently authoring.
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      const check = this.db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
      if (!check || !Object.values(check).includes('ok')) throw new Error('SkillHone audit database integrity check failed')
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* preserve the original failure */ }
      throw error
    }
  }

  auditStatus(): WorkRow {
    const check = this.db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
    return {
      integrity: check && Object.values(check).includes('ok') ? 'verified' : 'failed',
      authority: 'skillhone-host',
      runner_writes: 'blocked-during-run',
    }
  }

  private pullRequestBase(item: WorkRow): string {
    if (item.base_commit) return String(item.base_commit)
    if (item.status === 'merged') {
      const parents = this.git([
        'log', String(item.base), '-1', '--format=%P',
        `--grep=^Merge SkillHone PR #${item.number}:`,
      ], false).split(/\s+/).filter(Boolean)
      if (parents[0]) return parents[0]
    }
    return String(item.base)
  }

  project(): Project {
    return row(this.db.prepare('SELECT id,name,root,default_branch FROM project LIMIT 1').get()) as unknown as Project
  }

  private fingerprint(title: string, body: string): string {
    const normalized = `${title} ${body}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    return sha256(normalized)
  }

  createIssue(title: string, body = ''): { issue: WorkRow; created: boolean } {
    const safeTitle = redact(title).trim().slice(0, 240)
    const safeBody = redact(body).trim().slice(0, 12000)
    if (!safeTitle) throw new Error('issue title must not be empty')
    const fingerprint = this.fingerprint(safeTitle, safeBody)
    const existing = this.db.prepare("SELECT * FROM issue WHERE fingerprint=? AND status='open'").get(fingerprint)
    if (existing) return { issue: row(existing), created: false }
    const timestamp = now()
    const result = this.db.prepare(
      'INSERT INTO issue(title,body,fingerprint,status,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    ).run(safeTitle, safeBody, fingerprint, 'open', timestamp, timestamp)
    return { issue: this.issue(Number(result.lastInsertRowid)), created: true }
  }

  issue(number: number): WorkRow {
    const value = this.db.prepare('SELECT * FROM issue WHERE number=?').get(number)
    if (!value) throw new Error(`issue #${number} not found`)
    return row(value)
  }

  listIssues(status?: string): WorkRow[] {
    return status
      ? rows(this.db.prepare('SELECT * FROM issue WHERE status=? ORDER BY number DESC').all(status))
      : rows(this.db.prepare('SELECT * FROM issue ORDER BY number DESC').all())
  }

  closeIssue(number: number): WorkRow {
    this.issue(number)
    this.db.prepare("UPDATE issue SET status='closed',updated_at=? WHERE number=?").run(now(), number)
    return this.issue(number)
  }

  createPr(input: { title: string; head: string; base?: string; issueNumber?: number; body?: string }): WorkRow {
    const issue = input.issueNumber === undefined ? undefined : this.issue(input.issueNumber)
    this.git(['rev-parse', '--verify', input.head])
    const base = input.base ?? this.project().default_branch
    this.git(['rev-parse', '--verify', base])
    const baseCommit = this.git(['rev-parse', base])
    if (input.head === base) throw new Error('PR head and base must be different branches')
    const duplicate = this.db.prepare("SELECT number FROM pull_request WHERE head=? AND status='open'").get(input.head) as { number?: number } | undefined
    if (duplicate?.number) throw new Error(`branch ${JSON.stringify(input.head)} already has open PR #${duplicate.number}`)
    const body = input.body?.trim() || (issue ? repairPrBody({
      issueNumber: Number(issue.number), issueTitle: String(issue.title), runner: 'A local Agent',
      diff: this.git(['diff', '--name-status', `${base}...${input.head}`], false),
      commitCount: Number(this.git(['rev-list', '--count', `${base}..${input.head}`], false) || 0),
      tests: this.listIssueTests(Number(issue.number)),
    }) : '')
    const timestamp = now()
    const result = this.db.prepare(
      "INSERT INTO pull_request(issue_number,title,body,head,base,base_commit,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'open',?,?)",
    ).run(input.issueNumber ?? null, redact(input.title).slice(0, 240), redact(body).slice(0, 12000), input.head, base, baseCommit, timestamp, timestamp)
    return this.pr(Number(result.lastInsertRowid))
  }

  pr(number: number): WorkRow {
    const value = this.db.prepare('SELECT * FROM pull_request WHERE number=?').get(number)
    if (!value) throw new Error(`PR #${number} not found`)
    const item = row(value)
    const base = this.pullRequestBase(item)
    item.diff_stat = this.git(['diff', '--stat', `${base}...${item.head}`], false)
    return item
  }

  listPrs(status?: string): WorkRow[] {
    return status
      ? rows(this.db.prepare('SELECT * FROM pull_request WHERE status=? ORDER BY number DESC').all(status))
      : rows(this.db.prepare('SELECT * FROM pull_request ORDER BY number DESC').all())
  }

  mergePr(number: number, confirm: boolean): WorkRow {
    if (!confirm) throw new Error('merge requires --confirm')
    const item = this.pr(number)
    if (item.status !== 'open') throw new Error(`PR #${number} is ${String(item.status)}`)
    if (this.git(['status', '--porcelain'])) throw new Error('working tree must be clean before merge')
    this.git(['checkout', String(item.base)])
    this.git(['merge', '--no-ff', String(item.head), '-m', `Merge SkillHone PR #${number}: ${String(item.title)}`])
    const timestamp = now()
    this.db.prepare("UPDATE pull_request SET status='merged',updated_at=? WHERE number=?").run(timestamp, number)
    if (item.issue_number !== null) this.db.prepare("UPDATE issue SET status='closed',updated_at=? WHERE number=?").run(timestamp, Number(item.issue_number))
    return this.pr(number)
  }

  startRun(issueNumber: number, runnerName: string, branch: string): WorkRow {
    this.issue(issueNumber)
    const stamp = new Date().toISOString().replace(/[-:.]/g, '')
    const prefix = `${stamp}-${issueNumber}`
    let id = prefix
    let sequence = 2
    while (this.db.prepare('SELECT 1 FROM run WHERE id=?').get(id)) {
      id = `${prefix}-${sequence}`
      sequence += 1
    }
    const logPath = join(this.logsDir, `${id}.log`)
    this.db.prepare('INSERT INTO run(id,issue_number,runner,status,branch,log_path,started_at,finished_at,tool_call_count) VALUES (?,?,?,?,?,?,?,NULL,NULL)').run(
      id, issueNumber, runnerName, 'running', branch, logPath, now(),
    )
    return this.runRecord(id)
  }

  finishRun(id: string, status: string, toolCalls?: number): WorkRow {
    this.db.prepare('UPDATE run SET status=?,finished_at=?,tool_call_count=COALESCE(?,tool_call_count) WHERE id=?').run(status, now(), toolCalls ?? null, id)
    return this.runRecord(id)
  }

  runRecord(id: string): WorkRow {
    const value = this.db.prepare('SELECT * FROM run WHERE id=?').get(id)
    if (!value) throw new Error(`run ${id} not found`)
    return row(value)
  }

  listRuns(): WorkRow[] { return rows(this.db.prepare('SELECT * FROM run ORDER BY started_at DESC, rowid DESC').all()) }

  pendingIssues(): WorkRow[] {
    return rows(this.db.prepare(`
      SELECT i.* FROM issue AS i WHERE i.status='open'
      AND NOT EXISTS (SELECT 1 FROM run r WHERE r.issue_number=i.number)
      AND NOT EXISTS (SELECT 1 FROM pull_request p WHERE p.issue_number=i.number)
      ORDER BY i.number
    `).all())
  }

  issueStage(number: number): string {
    const item = this.issue(number)
    const pr = this.db.prepare('SELECT status FROM pull_request WHERE issue_number=? ORDER BY number DESC LIMIT 1').get(number) as { status?: string } | undefined
    const currentRun = this.db.prepare('SELECT status FROM run WHERE issue_number=? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(number) as { status?: string } | undefined
    if (item.status === 'closed' || pr?.status === 'merged') return 'done'
    if (pr?.status === 'open') return 'review'
    if (currentRun?.status === 'running') return 'optimizing'
    if (currentRun?.status === 'failed') return 'failed'
    return 'queued'
  }

  addIssueTest(issueNumber: number, path: string, command: string): WorkRow {
    this.issue(issueNumber)
    const normalizedPath = path.replaceAll('\\', '/').replace(/^\.\//, '')
    const absolute = resolve(this.root, normalizedPath)
    if (isAbsolute(path) || relative(this.root, absolute).startsWith('..')) throw new Error('test path must stay inside the Skill repository')
    if (!normalizedPath.startsWith('.test/')) throw new Error('Issue tests must live under .test/')
    const safeCommand = redact(command).trim().slice(0, 2000)
    if (!safeCommand) throw new Error('test command must not be empty')
    const existing = this.db.prepare('SELECT * FROM issue_test WHERE issue_number=? AND path=? AND command=?').get(issueNumber, normalizedPath, safeCommand)
    if (existing) return row(existing)
    if (!existsSync(absolute)) throw new Error(`Issue test does not exist: ${normalizedPath}`)
    const timestamp = now()
    this.db.prepare("INSERT OR IGNORE INTO issue_test(issue_number,path,command,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)").run(
      issueNumber, normalizedPath, safeCommand, timestamp, timestamp,
    )
    const value = this.db.prepare('SELECT * FROM issue_test WHERE issue_number=? AND path=? AND command=?').get(issueNumber, normalizedPath, safeCommand)
    return row(value)
  }

  listIssueTests(issueNumber: number): WorkRow[] {
    this.issue(issueNumber)
    return rows(this.db.prepare('SELECT * FROM issue_test WHERE issue_number=? ORDER BY id').all(issueNumber))
  }

  runIssueTests(issueNumber: number): { passed: boolean; tests: WorkRow[] } {
    const tests = this.listIssueTests(issueNumber)
    const results: WorkRow[] = []
    const openPr = this.db.prepare("SELECT head FROM pull_request WHERE issue_number=? AND status='open' ORDER BY number DESC LIMIT 1").get(issueNumber) as { head?: string } | undefined
    let testRoot = this.root
    let worktree: string | undefined
    if (openPr?.head && this.git(['branch', '--show-current'], false) !== openPr.head) {
      worktree = mkdtempSync(join(tmpdir(), 'skillhone-pr-tests-'))
      rmSync(worktree, { recursive: true })
      this.git(['worktree', 'add', '--detach', worktree, openPr.head])
      testRoot = worktree
    }
    const testEnv: NodeJS.ProcessEnv = {}
    for (const key of [
      'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
      'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT',
      'VIRTUAL_ENV', 'CONDA_PREFIX',
    ]) {
      if (process.env[key] !== undefined) testEnv[key] = process.env[key]
    }
    testEnv.PYTHONDONTWRITEBYTECODE = '1'
    try {
      for (const test of tests) {
        // A login shell may replace PATH (notably /bin/sh -l on macOS), causing
        // post-repair verification to use a different runtime than Harness.
        // Preserve the caller environment while still supporting shell commands.
        const shell = process.platform === 'win32' ? ['cmd', ['/d', '/s', '/c', String(test.command)]] as const : ['sh', ['-c', String(test.command)]] as const
        const result = spawnSync(shell[0], shell[1], {
          cwd: testRoot,
          env: testEnv,
          encoding: 'utf8', timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024,
        })
        const status = result.status === 0 ? 'passing' : 'failing'
        this.db.prepare('UPDATE issue_test SET status=?,updated_at=? WHERE id=?').run(status, now(), Number(test.id))
        results.push({ ...this.db.prepare('SELECT * FROM issue_test WHERE id=?').get(Number(test.id)) as WorkRow, exit_code: result.status ?? 1, output: redact(`${result.stdout ?? ''}${result.stderr ?? ''}`).slice(-4000) })
      }
    } finally {
      if (worktree) this.git(['worktree', 'remove', '--force', worktree], false)
    }
    return { passed: tests.length === 0 || results.every(item => item.status === 'passing'), tests: results }
  }

  cleanupGeneratedArtifacts(): string[] {
    const untracked = this.git(['ls-files', '--others', '--exclude-standard', '-z'], false).split('\0').filter(Boolean)
    const targets = new Set<string>()
    for (const path of untracked) {
      const normalized = path.replaceAll('\\', '/')
      const cache = normalized.match(/^(.*(?:^|\/)__pycache__)(?:\/|$)/)?.[1]
      if (cache) targets.add(cache)
      else if (/(?:^|\/)(?:\.pytest_cache)(?:\/|$)/.test(normalized)) {
        targets.add(normalized.split('/.pytest_cache')[0] + '/.pytest_cache')
      } else if (/\.(?:pyc|pyo)$/.test(normalized)) targets.add(normalized)
    }
    for (const path of targets) {
      const absolute = resolve(this.root, path)
      if (!relative(this.root, absolute).startsWith('..')) rmSync(absolute, { recursive: true, force: true })
    }
    return [...targets]
  }

  recordIssueTestResult(issueNumber: number, path: string, passed: boolean): WorkRow {
    const normalizedPath = path.replaceAll('\\', '/').replace(/^\.\//, '')
    const value = this.db.prepare('SELECT * FROM issue_test WHERE issue_number=? AND path=?').get(issueNumber, normalizedPath) as WorkRow | undefined
    if (!value) throw new Error(`Issue #${issueNumber} has no linked test at ${normalizedPath}`)
    this.db.prepare('UPDATE issue_test SET status=?,updated_at=? WHERE id=?').run(passed ? 'passing' : 'failing', now(), Number(value.id))
    return row(this.db.prepare('SELECT * FROM issue_test WHERE id=?').get(Number(value.id)))
  }

  upsertEvaluationGate(input: {
    issueNumber: number
    evalCommit: string
    split: string
    status: 'pending' | 'passing' | 'failing'
    baselineScore: number
    baselinePassed: number
    baselineTotal: number
    candidateScore?: number
    candidatePassed?: number
    candidateTotal?: number
  }): WorkRow {
    this.issue(input.issueNumber)
    if (!['probe', 'pr_val'].includes(input.split)) throw new Error('evaluation gate split must be probe or pr_val')
    const timestamp = now()
    this.db.prepare(`
      INSERT INTO evaluation_gate(
        issue_number,eval_commit,split,status,baseline_score,baseline_passed,baseline_total,
        candidate_score,candidate_passed,candidate_total,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(issue_number,eval_commit,split) DO UPDATE SET
        status=excluded.status,baseline_score=excluded.baseline_score,
        baseline_passed=excluded.baseline_passed,baseline_total=excluded.baseline_total,
        candidate_score=excluded.candidate_score,candidate_passed=excluded.candidate_passed,
        candidate_total=excluded.candidate_total,updated_at=excluded.updated_at
    `).run(
      input.issueNumber, input.evalCommit, input.split, input.status,
      input.baselineScore, input.baselinePassed, input.baselineTotal,
      input.candidateScore ?? null, input.candidatePassed ?? null, input.candidateTotal ?? null,
      timestamp, timestamp,
    )
    return row(this.db.prepare('SELECT * FROM evaluation_gate WHERE issue_number=? AND eval_commit=? AND split=?').get(
      input.issueNumber, input.evalCommit, input.split,
    ))
  }

  listEvaluationGates(issueNumber: number): WorkRow[] {
    this.issue(issueNumber)
    return rows(this.db.prepare('SELECT * FROM evaluation_gate WHERE issue_number=? ORDER BY id').all(issueNumber))
  }

  createWiki(input: { title: string; body?: string; slug?: string; issueNumber?: number; prNumber?: number }): WorkRow {
    const title = redact(input.title).trim().slice(0, 240)
    if (!title) throw new Error('wiki title must not be empty')
    const key = slug(redact(input.slug ?? title), 100)
    if (input.issueNumber !== undefined) this.issue(input.issueNumber)
    if (input.prNumber !== undefined) this.pr(input.prNumber)
    const timestamp = now()
    try {
      this.db.prepare('INSERT INTO wiki_entry(slug,title,body,issue_number,pr_number,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(
        key, title, redact(input.body ?? '').slice(0, 24000), input.issueNumber ?? null, input.prNumber ?? null, timestamp, timestamp,
      )
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error(`wiki entry ${JSON.stringify(key)} already exists`)
      throw error
    }
    return this.wiki(key)
  }

  updateWiki(key: string, input: { title?: string; body?: string; issueNumber?: number; prNumber?: number }): WorkRow {
    const current = this.wiki(key)
    const title = input.title === undefined ? String(current.title) : redact(input.title).trim().slice(0, 240)
    if (!title) throw new Error('wiki title must not be empty')
    const body = input.body === undefined ? String(current.body) : redact(input.body).slice(0, 24000)
    const issueNumber = input.issueNumber ?? (current.issue_number as number | null)
    const prNumber = input.prNumber ?? (current.pr_number as number | null)
    if (issueNumber !== null) this.issue(issueNumber)
    if (prNumber !== null) this.pr(prNumber)
    this.db.prepare('UPDATE wiki_entry SET title=?,body=?,issue_number=?,pr_number=?,updated_at=? WHERE slug=?').run(title, body, issueNumber, prNumber, now(), String(current.slug))
    return this.wiki(String(current.slug))
  }

  upsertWiki(key: string, title: string, body: string, issueNumber?: number, prNumber?: number): WorkRow {
    try { return this.updateWiki(key, { title, body, issueNumber, prNumber }) }
    catch (error) {
      if (!String(error).includes('not found')) throw error
      return this.createWiki({ title, body, slug: key, issueNumber, prNumber })
    }
  }

  wiki(key: string): WorkRow {
    const normalized = slug(redact(key), 100)
    const value = this.db.prepare('SELECT * FROM wiki_entry WHERE slug=?').get(normalized)
    if (!value) throw new Error(`wiki entry ${JSON.stringify(normalized)} not found`)
    return row(value)
  }

  listWiki(): WorkRow[] { return rows(this.db.prepare('SELECT * FROM wiki_entry ORDER BY updated_at DESC, slug').all()) }

  issueDetail(number: number): WorkRow {
    const item = { ...this.issue(number) }
    delete item.fingerprint
    item.stage = this.issueStage(number)
    item.pull_requests = rows(this.db.prepare('SELECT * FROM pull_request WHERE issue_number=? ORDER BY number DESC').all(number))
    item.runs = rows(this.db.prepare('SELECT * FROM run WHERE issue_number=? ORDER BY started_at DESC, rowid DESC').all(number)).map(({ log_path: _path, ...rest }) => rest)
    item.tests = this.listIssueTests(number)
    item.evaluation_gates = this.listEvaluationGates(number)
    return item
  }

  prDetail(number: number): WorkRow {
    const item = this.pr(number)
    item.issue = item.issue_number === null ? null : this.issue(Number(item.issue_number))
    if (item.issue && typeof item.issue === 'object') delete (item.issue as WorkRow).fingerprint
    const base = this.pullRequestBase(item)
    const commits = this.git(['log', '--format=%H%x1f%h%x1f%s%x1f%aI', `${base}..${item.head}`], false)
    item.commits = commits.split('\n').filter(Boolean).map(line => {
      const [sha, short_sha, subject, authored_at] = line.split('\x1f')
      return { sha, short_sha, subject, authored_at }
    })
    item.files = this.git(['diff', '--name-status', `${base}...${item.head}`], false).split('\n').filter(Boolean).map(line => {
      const [status, ...parts] = line.split('\t')
      const path = parts.at(-1) ?? ''
      const patch = this.git([
        'diff', '--no-ext-diff', '--no-color', '--unified=3', `${base}...${item.head}`, '--', path,
      ], false)
      return { status, path, patch: patch.slice(0, 200_000), patch_truncated: patch.length > 200_000 }
    })
    item.runs = item.issue_number === null ? [] : this.issueDetail(Number(item.issue_number)).runs
    return item
  }

  dashboard(): WorkRow {
    const project = { ...this.project() } as unknown as WorkRow
    delete project.root
    const pullRequests = this.listPrs()
    const approvals = pullRequests.filter(item => item.status === 'open').map(item => ({
      pr_number: item.number,
      issue_number: item.issue_number,
      title: item.title,
      state: 'awaiting_approval',
    }))
    return {
      project,
      audit: this.auditStatus(),
      issues: this.listIssues().map(({ fingerprint: _fingerprint, ...item }) => item),
      pull_requests: pullRequests,
      runs: this.listRuns().map(({ log_path: _path, ...item }) => item),
      wiki: this.listWiki(),
      notifications: {
        approval_required: approvals.length,
        message: approvals.length === 1 ? '1 optimized Skill PR awaits approval.'
          : approvals.length > 1 ? `${approvals.length} optimized Skill PRs await approval.`
            : 'No optimized Skill PRs await approval.',
        items: approvals,
      },
    }
  }
}
