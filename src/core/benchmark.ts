import { spawnSync } from 'node:child_process'
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync,
  rmSync, statSync, writeFileSync, mkdtempSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

import { runExploration, runRepair } from './harness.js'
import { benchmarkPrBody } from './pr-description.js'
import { benchmarkHarnessHome, mergePolicy } from './settings.js'
import { Tracker, type WorkRow } from './tracker.js'
import { now, redact, run, sha256, slug } from './util.js'

type Split = 'probe' | 'pr_val' | 'test'

interface DatasetSummary {
  split: Split
  items: number
  sha256: string
}

interface Campaign {
  version: 1
  eval_repo: string
  eval_commit: string
  runner: string
  datasets: DatasetSummary[]
  created_at: string
}

interface ScoreResult {
  score?: number
  pass_rate?: number
  n_total?: number
  n_passed?: number
  traces?: Array<Record<string, unknown>>
}

const infrastructureFailures = new Set([
  'harness-failed', 'provider-rate-limited', 'harness-model-not-configured',
])

// Evaluation scores commonly arrive as decimal fractions. Subtracting values
// such as 1.0 and 0.9 produces 0.09999999999999998 in JavaScript, so an exact
// threshold of 0.10 must allow a tiny representation tolerance.
const scoreEpsilon = 1e-12

const allowedSplits = new Set<Split>(['probe', 'pr_val', 'test'])

function campaignDir(tracker: Tracker): string { return join(tracker.dataDir, 'benchmark') }
function campaignPath(tracker: Tracker): string { return join(campaignDir(tracker), 'campaign.json') }

function privateWrite(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  chmodSync(dirname(path), 0o700)
  writeFileSync(path, value.endsWith('\n') ? value : `${value}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

function dataset(evalRepo: string, split: Split): DatasetSummary | undefined {
  const path = join(evalRepo, `${split}.jsonl`)
  if (!existsSync(path)) return undefined
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) throw new Error(`${split}.jsonl must contain at least one item`)
  for (const [index, line] of lines.entries()) {
    let item: Record<string, unknown>
    try { item = JSON.parse(line) as Record<string, unknown> }
    catch (error) { throw new Error(`${split}.jsonl line ${index + 1} is not valid JSON: ${redact(error)}`) }
    if (typeof item.question !== 'string' || !item.question.trim()) throw new Error(`${split}.jsonl line ${index + 1} has no question`)
    const hasVerification = typeof item.verification === 'string' && item.verification.trim().length > 0
    const hasExpected = item.expected !== null && typeof item.expected === 'object' && !Array.isArray(item.expected)
    if (!hasVerification && !hasExpected) {
      throw new Error(`${split}.jsonl line ${index + 1} has neither verification nor expected`)
    }
  }
  return { split, items: lines.length, sha256: sha256(readFileSync(path)) }
}

function runIsolatedBenchmarkRepair(
  tracker: Tracker,
  branch: string,
  home: string,
  logPath: string,
  promptForRoot: (root: string) => string,
): number {
  const temporary = mkdtempSync(join(tmpdir(), 'skillhone-benchmark-repair-'))
  const workspace = join(temporary, 'skill')
  const before = tracker.git(['rev-parse', branch])
  try {
    run('git', ['clone', '--quiet', '--no-hardlinks', '--single-branch', '--branch', branch, tracker.root, workspace])
    run('git', ['remote', 'remove', 'origin'], workspace)
    // Cloning does not carry repository-local identity. Preserve only these
    // two settings so the repair can commit without changing global Git config.
    for (const key of ['user.name', 'user.email']) {
      const value = tracker.git(['config', '--get', key], false)
      if (value) run('git', ['config', key, value], workspace)
    }
    const code = runRepair(promptForRoot(workspace), workspace, home, logPath, 5 * 60_000)
    if (code !== 0) return code
    if (run('git', ['status', '--porcelain'], workspace)) {
      throw new Error('DeepSeek Harness left uncommitted changes; no PR was created')
    }
    const after = run('git', ['rev-parse', 'HEAD'], workspace)
    if (after === before) throw new Error('DeepSeek Harness exited successfully but created no commit')
    run('git', ['fetch', '--quiet', workspace, after], tracker.root)
    const fetched = tracker.git(['rev-parse', 'FETCH_HEAD'])
    run('git', ['update-ref', `refs/heads/${branch}`, fetched, before], tracker.root)
    return 0
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function runIsolatedBenchmarkExploration(
  tracker: Tracker,
  branch: string,
  home: string,
  logPath: string,
  promptForRoot: (root: string, referenceRoot: string) => string,
): { code: number; summary: string } {
  const temporary = mkdtempSync(join(tmpdir(), 'skillhone-benchmark-exploration-'))
  const workspace = join(temporary, 'skill')
  try {
    run('git', ['clone', '--quiet', '--no-hardlinks', '--single-branch', '--branch', branch, tracker.root, workspace])
    run('git', ['remote', 'remove', 'origin'], workspace)
    const before = run('git', ['rev-parse', 'HEAD'], workspace)
    // Reference Skills live below .git so the Explorer can download and read
    // them without polluting the candidate Skill tree or accidentally adding
    // an entire upstream repository to the eventual revision.
    const referenceRoot = join(workspace, '.git', 'skillhone-reference-skills')
    mkdirSync(referenceRoot, { recursive: true, mode: 0o700 })
    const result = runExploration(
      promptForRoot(workspace, referenceRoot), workspace, home, logPath,
      { allowReferenceDownloads: true },
    )
    if (run('git', ['status', '--porcelain'], workspace)) {
      throw new Error('DeepSeek Harness Explorer modified its read-only workspace')
    }
    if (run('git', ['rev-parse', 'HEAD'], workspace) !== before) {
      throw new Error('DeepSeek Harness Explorer created a commit in its read-only workspace')
    }
    return result
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function validateRunner(value: string): string {
  const runner = value.trim()
  if (!runner || /[\r\n]/.test(runner)) throw new Error('benchmark runner must be one non-empty command line')
  if (redact(runner) !== runner) throw new Error('benchmark runner must not contain credentials; use the evaluator environment or credential store')
  for (const placeholder of ['{skill}', '{split}', '{output}']) {
    if (!runner.includes(placeholder)) throw new Error(`benchmark runner must contain ${placeholder}`)
  }
  return runner
}

function currentEvalCommit(evalRepo: string): string {
  if (run('git', ['status', '--porcelain'], evalRepo)) throw new Error('evaluation repository must be clean and committed before use')
  return run('git', ['rev-parse', 'HEAD'], evalRepo)
}

export function initBenchmark(tracker: Tracker, evalPath: string, runner?: string): WorkRow {
  if (!existsSync(resolve(evalPath))) throw new Error(`evaluation repository not found: ${redact(evalPath)}`)
  const evalRepo = realpathSync(resolve(evalPath))
  if (!statSync(evalRepo).isDirectory()) throw new Error('evaluation repository must be a directory')
  if (evalRepo === tracker.root) throw new Error('evaluation repository must be separate from the Skill repository')
  const gitRoot = run('git', ['rev-parse', '--show-toplevel'], evalRepo)
  if (realpathSync(gitRoot) !== evalRepo) throw new Error('point --eval-repo at the evaluation repository root')
  const defaultRunner = 'python3 evaluator/eval.py --skill-dir {skill} --dataset-dir {eval} --split {split} --output {output}'
  if (!runner && !existsSync(join(evalRepo, 'evaluator', 'eval.py'))) {
    throw new Error('evaluation runner not found; provide --runner with {skill}, {split}, and {output} placeholders')
  }
  const datasets = [...allowedSplits].map(split => dataset(evalRepo, split)).filter((item): item is DatasetSummary => Boolean(item))
  if (!datasets.some(item => item.split === 'probe')) throw new Error('evaluation repository must contain probe.jsonl')
  const campaign: Campaign = {
    version: 1,
    eval_repo: evalRepo,
    eval_commit: currentEvalCommit(evalRepo),
    runner: validateRunner(runner ?? defaultRunner),
    datasets,
    created_at: now(),
  }
  privateWrite(campaignPath(tracker), JSON.stringify(campaign, null, 2))
  return publicCampaign(campaign)
}

function loadCampaign(tracker: Tracker): Campaign {
  const path = campaignPath(tracker)
  if (!existsSync(path)) throw new Error('benchmark campaign is not initialized; run `skillhone benchmark init --eval-repo ...`')
  const value = JSON.parse(readFileSync(path, 'utf8')) as Campaign
  if (value.version !== 1) throw new Error('unsupported benchmark campaign version')
  if (currentEvalCommit(value.eval_repo) !== value.eval_commit) throw new Error('evaluation repository moved after it was frozen; initialize a new campaign')
  for (const expected of value.datasets) {
    const current = dataset(value.eval_repo, expected.split)
    if (!current || current.sha256 !== expected.sha256) throw new Error(`${expected.split}.jsonl changed after the campaign was frozen`)
  }
  return value
}

function publicCampaign(value: Campaign): WorkRow {
  return {
    version: value.version,
    eval_repository: basename(value.eval_repo),
    eval_commit: value.eval_commit,
    datasets: value.datasets,
    created_at: value.created_at,
  }
}

export function benchmarkStatus(tracker: Tracker): WorkRow {
  const campaign = loadCampaign(tracker)
  const historyPath = join(campaignDir(tracker), 'history.jsonl')
  const history = existsSync(historyPath)
    ? readFileSync(historyPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as WorkRow)
      .filter(item => item.eval_commit === campaign.eval_commit)
    : []
  return { ...publicCampaign(campaign), runs: history.reverse() }
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') return `"${value.replaceAll('"', '""')}"`
  return `'${value.replaceAll("'", "'\\''")}'`
}

function failureCategory(trace: Record<string, unknown>): string {
  const value = String(trace.category ?? trace.error ?? '').toLowerCase()
  if (/timeout|timed out/.test(value)) return 'timeout'
  if (/429|403|rate.?limit/.test(value)) return 'provider-rate-limit'
  if (/no[_ -]?answer|missing.*answer|artifact.*missing/.test(value)) return 'no-answer-produced'
  if (/agent[_ -]?(?:process|runtime)/.test(value)) return 'agent-process-error'
  if (/skill[_ -]?(?:script|runtime|subprocess)|(?:script|subprocess|process).*(?:exit|error|fail|crash)/.test(value)) return 'skill-script-error'
  if (/verif|grader|score.*error/.test(value)) return 'verification-error'
  if (/wrong[_ -]?answer|mismatch|incorrect/.test(value)) return 'wrong-answer'
  return value ? 'evaluation-failure' : 'failed'
}

function summary(raw: ScoreResult, split: Split, id: string, campaign: Campaign, output: string): WorkRow {
  const score = Number(raw.score ?? raw.pass_rate)
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('evaluation output must contain score or pass_rate between 0 and 1')
  const traces = Array.isArray(raw.traces) ? raw.traces : []
  const nTotal = Number(raw.n_total ?? traces.length)
  const nPassed = Number(raw.n_passed ?? traces.filter(item => item.passed === true).length)
  if (!Number.isInteger(nTotal) || nTotal < 0 || !Number.isInteger(nPassed) || nPassed < 0 || nPassed > nTotal) {
    throw new Error('evaluation output contains invalid n_total or n_passed counts')
  }
  const failures = new Map<string, number>()
  for (const trace of traces) {
    if (trace.passed === true) continue
    const category = failureCategory(trace)
    failures.set(category, (failures.get(category) ?? 0) + 1)
  }
  return {
    id, split, score,
    n_total: nTotal,
    n_passed: nPassed,
    failure_categories: [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([category, count]) => ({ category, count })),
    eval_commit: campaign.eval_commit,
    result_sha256: sha256(readFileSync(output)),
    created_at: now(),
  }
}

export function runBenchmark(tracker: Tracker, requestedSplit = 'probe'): WorkRow {
  if (!allowedSplits.has(requestedSplit as Split)) throw new Error('benchmark split must be probe, pr_val, or test')
  const split = requestedSplit as Split
  const campaign = loadCampaign(tracker)
  if (!campaign.datasets.some(item => item.split === split)) throw new Error(`${split}.jsonl is not part of this frozen campaign`)
  const id = `${new Date().toISOString().replace(/[-:.]/g, '')}-${split}`
  const resultsDir = join(campaignDir(tracker), 'results')
  mkdirSync(resultsDir, { recursive: true, mode: 0o700 })
  chmodSync(resultsDir, 0o700)
  const output = join(resultsDir, `${id}.json`)
  const log = join(resultsDir, `${id}.log`)
  const replacements: Record<string, string> = {
    '{skill}': shellQuote(tracker.root), '{eval}': shellQuote(campaign.eval_repo),
    '{split}': shellQuote(split), '{output}': shellQuote(output),
  }
  const command = Object.entries(replacements).reduce((text, [key, value]) => text.replaceAll(key, value), campaign.runner)
  const shell = process.platform === 'win32' ? ['cmd', ['/d', '/s', '/c', command]] as const : ['sh', ['-lc', command]] as const
  const result = spawnSync(shell[0], shell[1], {
    cwd: campaign.eval_repo,
    env: { ...process.env, DSH_HOME: benchmarkHarnessHome(tracker.home) },
    encoding: 'utf8', timeout: 2 * 60 * 60_000, maxBuffer: 16 * 1024 * 1024,
  })
  privateWrite(log, redact(`${result.stdout ?? ''}${result.stderr ?? ''}`))
  if (result.status !== 0) throw new Error(`benchmark runner failed for ${split}; inspect the private run log`)
  if (!existsSync(output) || statSync(output).size === 0) throw new Error('benchmark runner did not create its requested output file')
  chmodSync(output, 0o600)
  let raw: ScoreResult
  try { raw = JSON.parse(readFileSync(output, 'utf8')) as ScoreResult }
  catch { throw new Error('benchmark output is not valid JSON') }
  const infrastructureError = (Array.isArray(raw.traces) ? raw.traces : []).find(trace => {
    if (trace.passed === true) return false
    const value = String(trace.category ?? trace.error ?? '').toLowerCase().trim()
    return infrastructureFailures.has(value) || /(?:^|\b)429(?:\b|$)|too many requests|rate.?limit/.test(value)
  })
  if (infrastructureError) {
    throw new Error(`benchmark infrastructure failed for ${split}; inspect the private run log and retry without recording a score`)
  }
  const safe = summary(raw, split, id, campaign, output)
  const historyPath = join(campaignDir(tracker), 'history.jsonl')
  appendFileSync(historyPath, `${JSON.stringify(safe)}\n`, { mode: 0o600 })
  chmodSync(historyPath, 0o600)
  return safe
}

export function recordBenchmarkIssue(
  tracker: Tracker,
  result: WorkRow,
  validationBaseline?: WorkRow,
): WorkRow | undefined {
  const total = Number(result.n_total)
  const passed = Number(result.n_passed)
  const failed = total - passed
  if (!Number.isInteger(failed) || failed <= 0) return undefined
  const categories = Array.isArray(result.failure_categories) ? result.failure_categories as WorkRow[] : []
  const primary = String(categories[0]?.category ?? 'evaluation-failure')
  const issueResult = tracker.createIssue(
    `Benchmark: ${primary} on ${String(result.split)} (${failed}/${total} failed)`,
    `Frozen evaluation ${String(result.eval_commit).slice(0, 12)} scored ${result.score} ` +
      `(${passed}/${total} passed). Redacted failure categories: ${JSON.stringify(categories)}. ` +
      'Raw evaluation tasks, verifier code, gold answers, and result files remain outside the Skill repository.',
  )
  const issueNumber = Number(issueResult.issue.number)
  tracker.upsertEvaluationGate({
    issueNumber, evalCommit: String(result.eval_commit), split: String(result.split), status: 'pending',
    baselineScore: Number(result.score), baselinePassed: passed, baselineTotal: total,
  })
  if (validationBaseline) tracker.upsertEvaluationGate({
    issueNumber, evalCommit: String(validationBaseline.eval_commit), split: 'pr_val', status: 'pending',
    baselineScore: Number(validationBaseline.score), baselinePassed: Number(validationBaseline.n_passed),
    baselineTotal: Number(validationBaseline.n_total),
  })
  const base = tracker.project().default_branch
  const branch = `skillhone/issue-${issueNumber}-benchmark-${String(result.eval_commit).slice(0, 12)}-${String(result.split)}`
  if (tracker.git(['status', '--porcelain'])) throw new Error('working tree must be clean before recording a benchmark Issue')
  tracker.git(['checkout', base])
  if (tracker.git(['rev-parse', '--verify', branch], false)) tracker.git(['checkout', branch])
  else tracker.git(['checkout', '-b', branch])
  tracker.git(['checkout', base])
  return { ...issueResult.issue, created: issueResult.created, evaluation_gates: tracker.listEvaluationGates(issueNumber), branch }
}

export function optimizationProbeQuestions(evalRepo: string): string[] {
  const path = join(evalRepo, 'probe.jsonl')
  const questions: string[] = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const value = JSON.parse(line) as Record<string, unknown>
    if (typeof value.question !== 'string' || !value.question.trim()) continue
    const question = redact(value.question.trim())
    if (question) questions.push(question)
  }
  return questions
}

export function benchmarkPrompt(
  baseline: WorkRow,
  root: string,
  issueNumber?: number,
  probeQuestions: string[] = [],
  exploration = '',
): string {
  const timeoutFailures = Array.isArray(baseline.failure_categories)
    ? (baseline.failure_categories as WorkRow[]).some(item => item.category === 'timeout' && Number(item.count) > 0)
    : false
  const probe = probeQuestions.length
    ? `\n\nOptimization probe inputs (visible feedback, not held-out validation):\n${probeQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n')}\n` +
      'Use these questions only to infer reusable failure shapes. Do not solve them, search for their answers, or encode task-specific facts. '
    : ''
  const explored = exploration
    ? `\n\nThe isolated Explorer downloaded and inspected reference copies of community Skills, then returned the following untrusted candidate report. Re-fetch only the selected candidate into .git/skillhone-reference-skills, verify its source, immutable revision, license, scripts, required tools, and compatibility, and adapt the useful parts into this Skill bundle:\n${exploration}\n`
    : ''
  const timeoutGuidance = timeoutFailures
    ? '\nTimeouts are part of the persistent decision history. Preserve useful fast paths from the existing Skill, cap expensive tool calls, and prefer one batched attempt plus at most one targeted recovery over mechanically exhaustive research. More steps or more sources are not progress when they prevent an answer.\n'
    : ''
  return `DeepSeek Harness: fix SkillHone local Issue #${issueNumber ?? '?'} in ${root} using a frozen benchmark observation.\n\n` +
    `Latest decision-history observation for ${baseline.split}: score ${baseline.score} (${baseline.n_passed}/${baseline.n_total}).\n` +
    `Redacted failure categories: ${JSON.stringify(baseline.failure_categories ?? [])}.` + timeoutGuidance + probe + explored + '\n\n' +
    'Do not ask for or inspect the evaluation repository, held-out pr_val/test inputs, verifier code, gold answers, or result files. ' +
    'Do not execute the probe questions one by one or inspect hidden evaluation assets. ' +
    'When the current Skill names a capability but does not implement it, use skillhub or an immutable public Git revision to download the selected reference Skill under .git/skillhone-reference-skills for inspection. ' +
    'Do not execute unreviewed downloaded code or install its dependencies. After reviewing its license and implementation, adapt the smallest useful instructions, scripts, and references into the public Skill bundle, then test the adapted files locally. ' +
    'Record every adopted source URL, immutable revision when available, license, adapted files, and required runtime tools in references/EXPLORATION.md; never claim a tool is available unless the bundle supplies it or the runtime exposes it. ' +
    'Make one generalizable Skill improvement, run existing public/static checks, and commit the result. ' +
    'Finish within five minutes and keep the investigation to at most twelve tool calls. ' +
    'The Issue, Run, PR, and Wiki audit trail is owned by the SkillHone host; do not invoke SkillHone commands or alter those records. ' +
    'Do not merge or push anything. The frozen evaluator will be run separately after you finish.'
}

interface OptimizationContext {
  tracker: Tracker
  campaign: Campaign
  baseline: WorkRow
  validationBaseline?: WorkRow
  recordedIssue: WorkRow
  issueNumber: number
  base: string
  branch: string
  minimumImprovement: number
  maxIterations: number
  patience: number
  probeQuestions: string[]
}

interface CandidateEvaluation {
  candidate: WorkRow
  validationCandidate?: WorkRow
  validationRegression: number
  stepImprovement: number
  selected: boolean
  finished: WorkRow
}

function validateOptimizationOptions(minimumImprovement: number, maxIterations: number, patience: number): void {
  if (!Number.isFinite(minimumImprovement) || minimumImprovement < 0 || minimumImprovement > 1) throw new Error('minimum improvement must be between 0 and 1')
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 20) throw new Error('max iterations must be between 1 and 20')
  if (!Number.isInteger(patience) || patience < 1 || patience > maxIterations) throw new Error('patience must be between 1 and max iterations')
}

function issueSnapshot(context: OptimizationContext): WorkRow {
  return {
    ...context.tracker.issueDetail(context.issueNumber),
    created: context.recordedIssue.created,
    branch: context.branch,
  }
}

function explorationPrompt(context: OptimizationContext, workspace: string, referenceRoot: string): string {
  const { issueNumber, baseline, probeQuestions } = context
  return `DeepSeek Harness Explorer role for SkillHone local Issue #${issueNumber}.\n\n` +
    `Inspect the public Skill in ${workspace}, the baseline score ${baseline.score} (${baseline.n_passed}/${baseline.n_total}), ` +
    `and these visible development questions:\n${probeQuestions.map((question, index) => `${index + 1}. ${question}`).join('\n')}\n\n` +
    `The current Skill must be treated as a complete bundle: first check whether capabilities named in SKILL.md actually have supporting scripts or references. Download reference copies only into ${referenceRoot}; this path is private scratch space under .git and must never be committed. ` +
    'Use skillhub search first (for example `skillhub search "web search" --json`), then install two to four promising public Skills into that reference directory with `skillhub install <slug> --dir <reference-dir>`. If skillhub is unavailable, use public web search and clone an immutable Git revision into the same directory. ' +
    'Read each candidate SKILL.md, scripts, references, provenance, and license. Never execute downloaded code or install its dependencies during exploration. ' +
    'Treat latency and timeout risk as first-class: compare a full-question fast path with decomposition, account for expensive search calls, and do not assume that more sources or more tool calls are better. ' +
    'Do not edit files, create commits, invoke SkillHone commands, alter host-owned audit records, or request the evaluation repository, gold answers, validators, traces, or held-out test inputs. ' +
    'Return concise Markdown with Capability Gap, Downloaded Candidate Skills, Reusable Files, and Recommendation. ' +
    'For each candidate include its registry slug, public URL, immutable revision when available, license, required runtime tools, whether it contains executable code, and the exact files worth adapting. Recommend executable code only after reading it; the Developer will independently re-fetch and review it before use.'
}

function runBenchmarkExploration(context: OptimizationContext): { failed?: WorkRow; finished: WorkRow; summary?: string } {
  const { tracker, issueNumber, branch, baseline } = context
  const record = tracker.startRun(issueNumber, 'deepseek-harness-explorer', branch)
  let exploration: { code: number; summary: string }
  try {
    exploration = tracker.protectAuditTrail(() => runIsolatedBenchmarkExploration(
      tracker, branch, tracker.home, String(record.log_path),
      (workspace, referenceRoot) => explorationPrompt(context, workspace, referenceRoot),
    ))
  } catch (error) {
    tracker.finishRun(String(record.id), 'failed')
    throw error
  }
  const finished = tracker.finishRun(String(record.id), exploration.code === 0 ? 'completed' : 'failed')
  const failed = exploration.code === 0 ? undefined : {
    status: 'exploration-failed', exit_code: exploration.code, branch, baseline,
    issue: issueSnapshot(context), exploration_run: finished,
  }
  return { ...(failed ? { failed } : {}), finished, ...(exploration.code === 0 ? { summary: exploration.summary } : {}) }
}

function candidatePrompt(
  context: OptimizationContext,
  observation: WorkRow,
  exploration: string,
  workspace: string,
  iteration: number,
): string {
  return benchmarkPrompt(observation, workspace, context.issueNumber, context.probeQuestions, exploration) +
    `\n\nThis is benchmark iteration ${iteration} of ${context.maxIterations}. ` +
    (iteration > 1
      ? 'The previous committed candidate did not pass every frozen gate. Inspect the existing branch and its public tests, then make a different focused improvement. '
      : '')
}

function runCandidateRepair(
  context: OptimizationContext,
  observation: WorkRow,
  exploration: string,
  iteration: number,
): { code: number; record: WorkRow } {
  const { tracker, base, branch, issueNumber } = context
  // Keep the source worktree detached from the candidate ref while the
  // isolated clone advances it. Updating a checked-out branch ref would leave
  // its worktree at the previous tree until an explicit reset.
  tracker.git(['checkout', base])
  const record = tracker.startRun(issueNumber, 'deepseek-harness-benchmark', branch)
  try {
    const code = tracker.protectAuditTrail(() => runIsolatedBenchmarkRepair(
      tracker, branch, tracker.home, String(record.log_path),
      workspace => candidatePrompt(context, observation, exploration, workspace, iteration),
    ))
    return { code, record }
  } catch (error) {
    tracker.finishRun(String(record.id), 'failed')
    throw error
  }
}

function updateEvaluationGates(context: OptimizationContext, evaluation: Omit<CandidateEvaluation, 'finished'>): void {
  const { tracker, issueNumber, campaign, baseline, validationBaseline } = context
  const { candidate, validationCandidate, validationRegression, selected } = evaluation
  const probePassed = Number(candidate.score) - Number(baseline.score) + scoreEpsilon >= context.minimumImprovement
  tracker.upsertEvaluationGate({
    issueNumber, evalCommit: campaign.eval_commit, split: 'probe', status: probePassed ? 'passing' : 'failing',
    baselineScore: Number(baseline.score), baselinePassed: Number(baseline.n_passed), baselineTotal: Number(baseline.n_total),
    candidateScore: Number(candidate.score), candidatePassed: Number(candidate.n_passed), candidateTotal: Number(candidate.n_total),
  })
  if (!validationBaseline || !validationCandidate) return
  tracker.upsertEvaluationGate({
    issueNumber, evalCommit: campaign.eval_commit, split: 'pr_val', status: selected && validationRegression <= 0.02 ? 'passing' : 'failing',
    baselineScore: Number(validationBaseline.score), baselinePassed: Number(validationBaseline.n_passed), baselineTotal: Number(validationBaseline.n_total),
    candidateScore: Number(validationCandidate.score), candidatePassed: Number(validationCandidate.n_passed), candidateTotal: Number(validationCandidate.n_total),
  })
}

function evaluateCandidate(context: OptimizationContext, record: WorkRow, previousScore: number): CandidateEvaluation {
  const { tracker, baseline, validationBaseline } = context
  tracker.git(['checkout', context.branch])
  const candidate = runBenchmark(tracker, 'probe')
  const probePassed = Number(candidate.score) - Number(baseline.score) + scoreEpsilon >= context.minimumImprovement
  const validationCandidate = probePassed && validationBaseline ? runBenchmark(tracker, 'pr_val') : undefined
  const validationRegression = validationBaseline
    ? (validationCandidate ? Number(validationBaseline.score) - Number(validationCandidate.score) : Number.POSITIVE_INFINITY)
    : 0
  const selected = probePassed && validationRegression <= 0.02
  const evaluation = {
    candidate,
    ...(validationCandidate ? { validationCandidate } : {}),
    validationRegression,
    stepImprovement: Number(candidate.score) - previousScore,
    selected,
  }
  updateEvaluationGates(context, evaluation)
  return { ...evaluation, finished: tracker.finishRun(String(record.id), selected ? 'completed' : 'failed') }
}

function recordAttempt(attempts: WorkRow[], iteration: number, evaluation: CandidateEvaluation): void {
  attempts.push({
    iteration, run_id: evaluation.finished.id, probe_score: evaluation.candidate.score,
    ...(evaluation.validationCandidate ? { validation_score: evaluation.validationCandidate.score } : {}),
    selected: evaluation.selected,
  })
}

function selectedWikiBody(context: OptimizationContext, evaluation: CandidateEvaluation, iteration: number, prNumber: number, merged: boolean): string {
  const { campaign, baseline, validationBaseline, maxIterations } = context
  const { candidate, validationCandidate } = evaluation
  return `Frozen eval commit ${campaign.eval_commit.slice(0, 12)}.\nProbe ${baseline.score} → ${candidate.score}.` +
    (validationBaseline && validationCandidate ? `\nPR validation ${validationBaseline.score} → ${validationCandidate.score}.` : '') +
    `\nSelected on iteration ${iteration} of ${maxIterations}.` +
    (merged
      ? `\nLocal PR #${prNumber} passed its evaluation gates and was merged locally by the saved automatic policy. No push was performed.`
      : `\nLocal PR #${prNumber} is open for review. No push or merge was performed.`)
}

function selectedResult(
  context: OptimizationContext,
  evaluation: CandidateEvaluation,
  explorationRun: WorkRow,
  attempts: WorkRow[],
  iteration: number,
): WorkRow {
  const { tracker, campaign, issueNumber, baseline, validationBaseline, branch, base } = context
  const candidate = evaluation.candidate
  const selectedMerge = mergePolicy(tracker.home, String(tracker.project().id))
  const pr = tracker.createPr({
    title: `Benchmark: improve probe score ${baseline.score} → ${candidate.score}`,
    head: branch, base, issueNumber,
    body: benchmarkPrBody({
      issueNumber, evalCommit: campaign.eval_commit,
      diff: tracker.git(['diff', '--name-status', `${base}...${branch}`], false),
      commitCount: Number(tracker.git(['rev-list', '--count', `${base}..${branch}`], false) || 0),
      baseline, candidate, mergeMode: selectedMerge.mode,
      ...(validationBaseline && evaluation.validationCandidate
        ? { validationBaseline, validationCandidate: evaluation.validationCandidate } : {}),
    }),
  })
  const slugValue = `benchmark-${slug(String(candidate.id), 80)}`
  let wiki = tracker.upsertWiki(
    slugValue, 'Benchmark-selected Skill improvement',
    selectedWikiBody(context, evaluation, iteration, Number(pr.number), false), issueNumber, Number(pr.number),
  )
  let pullRequest = pr
  if (selectedMerge.mode === 'automatic') {
    pullRequest = tracker.mergePr(Number(pr.number), true)
    wiki = tracker.upsertWiki(
      slugValue, 'Benchmark-selected Skill improvement',
      selectedWikiBody(context, evaluation, iteration, Number(pr.number), true), issueNumber, Number(pr.number),
    )
  }
  return {
    status: 'selected', iteration, attempts, branch, issue: issueSnapshot(context), exploration_run: explorationRun,
    run: evaluation.finished, baseline, candidate, validation_baseline: validationBaseline,
    validation_candidate: evaluation.validationCandidate, pull_request: pullRequest, wiki, merge_policy: selectedMerge,
  }
}

function recordRejectedWiki(context: OptimizationContext, evaluation: CandidateEvaluation, iteration: number): WorkRow {
  const { tracker, campaign, issueNumber, baseline, validationBaseline, maxIterations } = context
  return tracker.upsertWiki(
    `benchmark-${slug(String(evaluation.candidate.id), 80)}`, 'Benchmark observation: candidate not selected',
    `Frozen eval commit ${campaign.eval_commit.slice(0, 12)}.\nProbe ${baseline.score} → ${evaluation.candidate.score}.` +
    (validationBaseline && evaluation.validationCandidate ? `\nPR validation ${validationBaseline.score} → ${evaluation.validationCandidate.score}.` : '') +
    `\nIteration ${iteration} of ${maxIterations} was not selected.` +
    '\nNo local PR was created; no push or merge was performed.',
    issueNumber,
  )
}

function nextObservation(evaluation: CandidateEvaluation): WorkRow {
  const categories = Array.isArray(evaluation.candidate.failure_categories)
    ? [...evaluation.candidate.failure_categories as WorkRow[]] : []
  if (evaluation.validationRegression > 0.02) categories.push({ category: 'pr-validation-regression', count: 1 })
  return { ...evaluation.candidate, failure_categories: categories }
}

function optimizationContext(
  tracker: Tracker,
  campaign: Campaign,
  baseline: WorkRow,
  validationBaseline: WorkRow | undefined,
  recordedIssue: WorkRow,
  minimumImprovement: number,
  maxIterations: number,
  patience: number,
): OptimizationContext {
  return {
    tracker, campaign, baseline, ...(validationBaseline ? { validationBaseline } : {}), recordedIssue,
    issueNumber: Number(recordedIssue.number), base: tracker.project().default_branch,
    branch: String(recordedIssue.branch), minimumImprovement, maxIterations, patience,
    probeQuestions: optimizationProbeQuestions(campaign.eval_repo),
  }
}

export function optimizeBenchmark(
  tracker: Tracker,
  minimumImprovement = 0.02,
  maxIterations = 1,
  patience = 1,
): WorkRow {
  validateOptimizationOptions(minimumImprovement, maxIterations, patience)
  const campaign = loadCampaign(tracker)
  if (tracker.git(['status', '--porcelain'])) throw new Error('working tree must be clean before benchmark optimization')
  const baseline = runBenchmark(tracker, 'probe')
  const validationBaseline = campaign.datasets.some(item => item.split === 'pr_val') ? runBenchmark(tracker, 'pr_val') : undefined
  const recordedIssue = recordBenchmarkIssue(tracker, baseline, validationBaseline)
  if (!recordedIssue) return { status: 'no-failures', baseline, validation_baseline: validationBaseline }
  const context = optimizationContext(
    tracker, campaign, baseline, validationBaseline, recordedIssue,
    minimumImprovement, maxIterations, patience,
  )
  tracker.git(['checkout', context.base])
  const attempts: WorkRow[] = []
  let observation = baseline
  let previousScore = Number(baseline.score)
  let stalled = 0
  const exploration = runBenchmarkExploration(context)
  if (exploration.failed) return exploration.failed

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const repair = runCandidateRepair(context, observation, exploration.summary ?? '', iteration)
    if (repair.code !== 0) {
      const finished = tracker.finishRun(String(repair.record.id), 'failed')
      return {
        status: 'optimizer-failed', exit_code: repair.code, iteration, attempts, branch: context.branch,
        baseline, issue: issueSnapshot(context), exploration_run: exploration.finished, run: finished,
      }
    }
    const evaluation = evaluateCandidate(context, repair.record, previousScore)
    recordAttempt(attempts, iteration, evaluation)
    if (evaluation.selected) return selectedResult(context, evaluation, exploration.finished, attempts, iteration)
    const wiki = recordRejectedWiki(context, evaluation, iteration)
    stalled = evaluation.stepImprovement > 0 ? 0 : stalled + 1
    if (iteration === maxIterations || stalled >= patience) {
      return {
        status: 'not-selected', iteration, attempts, stopped_by: stalled >= patience ? 'patience' : 'max-iterations',
        branch: context.branch, issue: issueSnapshot(context), exploration_run: exploration.finished,
        run: evaluation.finished, baseline, candidate: evaluation.candidate, validation_baseline: validationBaseline,
        validation_candidate: evaluation.validationCandidate, wiki,
      }
    }
    previousScore = Number(evaluation.candidate.score)
    observation = nextObservation(evaluation)
  }
  throw new Error('benchmark optimization loop ended unexpectedly')
}
