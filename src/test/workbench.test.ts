import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import test from 'node:test'

const browserSource = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  .replace(/^load\(\)\.then\(restoreHash\).*$/m, '')
  .replace(/^export \{\};?\s*$/m, '')

type Hooks = {
  optimizationProgress(period: number, unit: string, now: Date): any; progressPanel(): string; taskItems(): any[]; activityGroups(): any[]
  state: Record<string, any>; load(): Promise<void>; statusPage(): string; filtered(): unknown[]; renderContent(): void
  openWorkspace(id: string): void; openRecord(id: string, reference: string | number, view: string): Promise<void>
  openRepo(id: string): Promise<void>; applyLocale(locale: string): void; goHome(): void; restoreHash(): Promise<void>; switchView(view: string): void; setHiddenSkill(id: string): void; clearFilters(): void
}

type Element = {
  innerHTML: string; textContent: string; hidden: boolean; disabled: boolean; value: string
  handlers: Map<string, (event: any) => unknown>; classes: Set<string>; classList: { add(...names: string[]): void; remove(...names: string[]): void; toggle(name: string, on?: boolean): void }
  contains(): boolean; querySelectorAll(): never[]; querySelector(): null
  setAttribute(): void; removeAttribute(): void; addEventListener(type: string, handler: (event: any) => unknown): void; focus(): void; showModal(): void; close(): void
}
function fixture(storage = new Map<string, string>()) {
  const elements = new Map<string, Element>()
  function element(id: string): Element {
    if (!elements.has(id)) {
      const classes = new Set<string>(), handlers = new Map<string, (event: any) => unknown>()
      elements.set(id, {
        innerHTML: '', textContent: '', hidden: false, disabled: false, value: '', classes, handlers,
        classList: { add(...names) { names.forEach(name => classes.add(name)) }, remove(...names) { names.forEach(name => classes.delete(name)) }, toggle(name, on) { if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name) } },
        contains() { return false }, querySelectorAll() { return [] }, querySelector() { return null },
        setAttribute() {}, removeAttribute() {}, addEventListener(type, handler) { handlers.set(type, handler) }, focus() {}, showModal() {}, close() {},
      })
    }
    return elements.get(id)!
  }
  const sandbox = {
    console, URLSearchParams, Date, JSON, Map, Set, encodeURIComponent, decodeURIComponent,
    HTMLInputElement: class {},
    document: { documentElement: { lang: 'zh-CN' }, getElementById: element, querySelectorAll() { return [] }, querySelector(selector: string) { return selector.startsWith('[data-') && element('content').innerHTML.includes(selector.slice(1, -1)) ? element(selector) : null }, addEventListener() {} },
    localStorage: { getItem(key: string) { return storage.get(key) ?? null }, setItem(key: string, value: string) { storage.set(key, value) } },
    navigator: { language: 'zh-CN' }, location: { hash: '#status', search: '' }, window: { addEventListener() {} },
    setInterval() { return 0 }, fetch: async (_path: string): Promise<{ ok: boolean; json(): Promise<unknown> }> => { throw new Error('unexpected fetch') },
  }
  const context = createContext(sandbox)
  runInContext(browserSource + '\n;globalThis.hooks={state,load,statusPage,filtered,renderContent,openWorkspace,openRecord,goHome,restoreHash,switchView,setHiddenSkill,clearFilters,openRepo,applyLocale,optimizationProgress,progressPanel,taskItems,activityGroups};', context)
  const hooks = context.hooks as Hooks
  const alpha = { id: 'alpha-id', name: 'Alpha skill', available: true, source: 'path', default_branch: 'main', issue_count: 1, pr_count: 0, wiki_count: 0, completed_run_count: 0 }
  const beta = { ...alpha, id: 'beta-id', name: 'Beta skill', issue_count: 1, pr_count: 1 }
  const issue = { number: 1, title: 'Alpha repair needed', body: 'Public reproduction', status: 'open', stage: 'failed', skill: alpha, created_at: '2026-01-01', updated_at: '2026-01-01', tests: [], runs: [], pull_requests: [] }
  const betaIssue = { ...issue, title: 'Beta private-to-scope issue', skill: beta }
  const pr = { number: 1, issue_number: 1, title: 'Beta fix awaiting review', status: 'open', decision_state: 'awaiting_approval', skill: beta, created_at: '2026-01-01', updated_at: '2026-01-01', head: 'repair', base: 'main', body: '', commits: [], files: [], runs: [] }
  const dashboard = {
    skills: [alpha, beta], issues: [issue, betaIssue], pull_requests: [pr], wiki: [], runs: [],
    harness: { state: 'running', installed: true, active_runs: 1 }, audit: { integrity: 'verified' },
    automation: { default: { mode: 'queued', interval_minutes: 60 } }, merge_policy: { mode: 'automatic' }, notifications: { approval_required: 1 },
  }
  Object.assign(hooks.state, { items: { skills: dashboard.skills, issues: dashboard.issues, prs: dashboard.pull_requests, wiki: [], runs: [] }, harness: dashboard.harness, automation: dashboard.automation })
  return { ...hooks, sandbox, element, storage, dashboard, alpha, beta, issue, pr }
}

test('Workbench separates global attention from an actual repository workspace', () => {
  const f = fixture()
  const global = f.statusPage()
  assert.match(global, /data-count-key="skills">2</)
  assert.match(global, /Alpha repair needed/)
  assert.match(global, /Beta fix awaiting review/)
  assert.match(global, /排队后调度/)
  f.openWorkspace(f.alpha.id)
  const workspace = f.element('content').innerHTML
  assert.equal(f.sandbox.location.hash, 'status/alpha-id')
  assert.equal(f.element('repo-name').textContent, 'Alpha skill')
  assert.equal(f.element('scope-back').hidden, false)
  assert.match(workspace, /来源/)
  assert.match(workspace, /当前问题/)
  assert.match(workspace, /测试与修复详情/)
  assert.doesNotMatch(workspace, /data-count-key="skills"|skill-overview|Beta private-to-scope|Beta fix awaiting review/)
  assert.doesNotMatch(workspace, />Status<|>Code<|>Issues<|>Pull Requests</)
})

test('Scope changes and direct hash navigation clear incompatible searches and filters', async () => {
  const f = fixture()
  const dirty = () => Object.assign(f.state, { query: 'Beta', skillQuery: 'Beta', skillFilter: 'review', taskFilter: 'failed', approvalOnly: true, showHidden: true })
  const clean = () => {
    assert.equal(f.state.query, ''); assert.equal(f.state.skillQuery, ''); assert.equal(f.state.skillFilter, 'all')
    assert.equal(f.state.taskFilter, 'all'); assert.equal(f.state.approvalOnly, false); assert.equal(f.state.showHidden, false)
  }
  dirty(); f.openWorkspace(f.alpha.id); clean()
  dirty(); f.sandbox.location.hash = '#status/beta-id'; await f.restoreHash(); clean()
  assert.equal(f.state.skillId, f.beta.id)
  assert.doesNotMatch(f.element('content').innerHTML, /Alpha repair needed/)
  dirty(); f.goHome(); clean(); assert.equal(f.state.skillId, null)
  f.state.query = 'a search with no match'; f.state.view = 'issues'; f.renderContent()
  assert.match(f.element('content').innerHTML, /data-clear-filters/)
  f.clearFilters(); assert.equal(f.filtered().length, 2)
})

test('Hidden repositories leave global tasks and counts but retain direct-link history and executor truth', async () => {
  const f = fixture()
  f.setHiddenSkill(f.beta.id)
  assert.deepEqual(JSON.parse(f.storage.get('skillhone.hiddenSkills')!), [f.beta.id])
  const global = f.statusPage()
  assert.match(global, /data-count-key="skills">1</)
  assert.match(global, /data-count-key="approvals">0</)
  assert.doesNotMatch(global, /Beta fix awaiting review|Beta private-to-scope/)
  assert.match(global, /全局运行: <strong>1<\/strong>/)
  f.state.showHidden = true; f.renderContent()
  assert.match(f.element('content').innerHTML, /Beta skill/)
  f.sandbox.location.hash = '#status/beta-id'; await f.restoreHash()
  assert.match(f.element('content').innerHTML, /Beta fix awaiting review/)
  assert.match(f.element('content').innerHTML, /已从总览隐藏/)
  const reloaded = fixture(f.storage)
  assert.doesNotMatch(reloaded.statusPage(), /Beta fix awaiting review/)
  reloaded.setHiddenSkill(f.beta.id)
  assert.match(reloaded.statusPage(), /Beta fix awaiting review/)
})

test('Detail refresh failure is visible and retried even when the dashboard has not changed', async () => {
  const f = fixture()
  Object.assign(f.state, { view: 'issues', skillId: f.alpha.id, detailType: 'issues', detail: f.issue })
  let attempts = 0
  f.sandbox.fetch = async path => path === '/api/dashboard' ? { ok: true, json: async () => f.dashboard }
    : ++attempts === 1 ? { ok: false, json: async () => ({ error: 'public temporary detail failure' }) }
      : { ok: true, json: async () => ({ ...f.issue, body: 'Recovered detail' }) }
  await f.load()
  assert.equal(f.element('update-state').classes.has('stale'), true)
  assert.match(f.element('update-state').textContent, /更新失败/)
  assert.equal(f.state.detail.body, f.issue.body)
  await f.load()
  assert.equal(attempts, 2)
  assert.equal(f.state.detail.body, 'Recovered detail')
  assert.equal(f.element('update-state').classes.has('stale'), false)
})

test('Unchanged dashboard still refreshes repository documents and PR files without resetting the tab', async () => {
  const f = fixture()
  let revision = 0
  Object.assign(f.state, { view: 'skills', skillId: f.alpha.id, detailType: 'skills', detail: { ...f.alpha, document: { name: 'README.md', content: 'old' } } })
  f.sandbox.fetch = async path => ({ ok: true, json: async () => path === '/api/dashboard' ? f.dashboard : { ...f.alpha, document: { name: 'README.md', content: `Document ${++revision}` } } })
  await f.load(); await f.load()
  assert.equal(f.state.detail.document.content, 'Document 2')
  Object.assign(f.state, { view: 'prs', skillId: f.beta.id, detailType: 'prs', detail: f.pr, prTab: 'files' })
  f.sandbox.fetch = async path => ({ ok: true, json: async () => path === '/api/dashboard' ? f.dashboard : { ...f.pr, files: [{ path: `revision-${++revision}.txt`, status: 'M', patch: '+public change' }] } })
  await f.load(); await f.load()
  assert.equal(f.state.prTab, 'files')
  assert.equal(f.state.detail.files[0].path, 'revision-4.txt')
  assert.match(f.element('content').innerHTML, /data-pr-tab="files" aria-selected="true"/)
  assert.match(f.element('content').innerHTML, /public change/)
})

test('Late polling and navigation responses cannot replace a newly selected workspace', async () => {
  const f = fixture()
  Object.assign(f.state, { view: 'issues', skillId: f.alpha.id, detailType: 'issues', detail: f.issue })
  let release: (() => void) | undefined
  f.sandbox.fetch = async path => ({ ok: true, json: async () => path === '/api/dashboard' ? f.dashboard : new Promise(resolve => { release = () => resolve({ ...f.issue, body: 'Late response' }) }) })
  const poll = f.load()
  for (let turn = 0; turn < 8 && !release; turn++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(release)
  f.openWorkspace(f.beta.id); release(); await poll
  assert.equal(f.state.skillId, f.beta.id)
  assert.equal(f.state.detail, null)
  assert.match(f.element('content').innerHTML, /Beta fix awaiting review/)
  assert.doesNotMatch(f.element('content').innerHTML, /Late response/)
  release = undefined
  const navigation = f.openRecord(f.alpha.id, 1, 'issues')
  for (let turn = 0; turn < 8 && !release; turn++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(release)
  f.goHome(); (release as unknown as () => void)(); await navigation
  assert.equal(f.state.skillId, null)
  assert.equal(f.state.detail, null)
})


test('Large skill catalogs are bounded and paged after filtering, without losing hidden state or match totals', () => {
  const f = fixture()
  f.state.items.skills = [f.alpha, f.beta, ...Array.from({ length: 159 }, (_, index) => ({ ...f.alpha, id: `batch-${index}`, name: `Batch skill ${String(index).padStart(3, '0')}` }))]
  const rows = () => (f.element('content').innerHTML.match(/data-workspace-skill=/g) || []).length
  const click = (selector: string) => { const node = f.sandbox.document.querySelector(selector); assert.ok(node, selector); const handler = node.handlers.get('click'); assert.ok(handler); handler({}) }
  f.renderContent()
  assert.equal(rows(), 20)
  assert.match(f.element('content').innerHTML, /已显示 20 \/ 161 项/)
  assert.ok(f.element('content').innerHTML.indexOf('recent-runs') < f.element('content').innerHTML.indexOf('skill-overview'))
  click('[data-show-more-skills]')
  assert.equal(rows(), 40)
  assert.match(f.element('content').innerHTML, /已显示 40 \/ 161 项/)
  click('[data-collapse-skills]'); assert.equal(rows(), 20)
  f.setHiddenSkill('batch-7')
  click('[data-show-more-skills]')
  f.element('skill-search').handlers.get('input')!({ target: { value: 'Batch skill' } })
  assert.equal(rows(), 20)
  assert.equal(f.state.skillLimit, 20)
  assert.match(f.element('content').innerHTML, /已显示 20 \/ 158 项/)
  assert.doesNotMatch(f.element('content').innerHTML, /data-workspace-skill="batch-7"/)
  f.state.locale = 'en'; f.renderContent()
  assert.match(f.element('content').innerHTML, /Showing 20 of 158 skills/)
  f.state.skillFilter = 'review'; f.renderContent()
  assert.equal(rows(), 0)
  assert.match(f.element('content').innerHTML, /class="section-count">0<\/span>/)
  f.clearFilters()
  assert.equal(f.state.hiddenSkills.includes('batch-7'), true)
  assert.match(f.element('content').innerHTML, /Showing 20 of 160 skills/)
})

test('Failed repository and Issue navigation render the new scope error with a working retry', async () => {
  const f = fixture()
  f.openWorkspace(f.beta.id)
  f.sandbox.fetch = async () => ({ ok: false, json: async () => ({ error: 'Public record unavailable' }) })
  const record = f.openRecord(f.alpha.id, 1, 'issues')
  assert.equal(f.state.skillId, f.alpha.id)
  assert.match(f.element('content').innerHTML, /正在加载仓库记录/)
  assert.doesNotMatch(f.element('content').innerHTML, /Beta fix awaiting review/)
  await record
  assert.equal(f.state.navigationLoading, false)
  assert.match(f.element('content').innerHTML, /记录加载失败/)
  assert.match(f.element('content').innerHTML, /Public record unavailable/)
  f.sandbox.fetch = async () => ({ ok: true, json: async () => f.issue })
  const retry = f.sandbox.document.querySelector('[data-retry-navigation]')?.handlers.get('click')
  assert.ok(retry)
  retry({})
  for (let turn = 0; turn < 8 && f.state.navigationLoading; turn++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.state.detail.title, f.issue.title)
  assert.equal(f.state.navigationError, null)
  f.sandbox.fetch = async () => { throw new Error('Public code unavailable') }
  await f.openRepo(f.beta.id)
  assert.equal(f.state.skillId, f.beta.id)
  assert.equal(f.state.view, 'skills')
  assert.match(f.element('content').innerHTML, /Public code unavailable/)
  f.openWorkspace(f.beta.id)
  assert.equal(f.state.navigationError, null)
  assert.match(f.element('content').innerHTML, /Beta fix awaiting review/)
})

test('Language changes update both healthy and stale update indicators immediately', async () => {
  const f = fixture()
  f.applyLocale('en')
  assert.match(f.element('update-state').innerHTML, /Updates every 5 seconds/)
  Object.assign(f.state, { view: 'issues', skillId: f.alpha.id, detailType: 'issues', detail: f.issue })
  f.sandbox.fetch = async path => path === '/api/dashboard' ? { ok: true, json: async () => f.dashboard } : { ok: false, json: async () => ({ error: 'public failure' }) }
  await f.load()
  assert.equal(f.element('update-state').classes.has('stale'), true)
  f.applyLocale('zh')
  assert.equal(f.element('update-state').classes.has('stale'), true)
  assert.match(f.element('update-state').textContent, /更新失败/)
  f.applyLocale('en')
  assert.equal(f.element('update-state').classes.has('stale'), true)
  assert.match(f.element('update-state').textContent, /Update failed/)
})

test('Progress counts finish and merge events at calendar boundaries instead of starts or current statuses', () => {
  const f = fixture(), now = new Date(2026, 10, 2, 12), start = new Date(2026, 9, 27)
  const run = (id: string, status: string, finished_at: unknown) => ({ id, status, finished_at, started_at: new Date(2026, 9, 20).toISOString(), skill: f.alpha, issue_number: 1 })
  f.state.items.runs = [
    run('before-window', 'failed', new Date(start.getTime() - 1).toISOString()),
    run('at-start', 'completed', start.toISOString()), run('at-now', 'completed', now.toISOString()),
    run('failure-one', 'failed', new Date(now.getTime() - 1000).toISOString()),
    run('failure-two-same-issue', 'failed', new Date(2026, 9, 30).toISOString()),
    run('future', 'completed', new Date(now.getTime() + 1).toISOString()),
    run('running', 'running', now.toISOString()), run('waiting', 'awaiting_agent', now.toISOString()), run('missing-time', 'completed', null), run('invalid-time', 'failed', 'invalid'),
  ]
  f.state.items.prs = [
    { ...f.pr, skill: f.alpha, status: 'merged', created_at: new Date(2026, 9, 1).toISOString(), updated_at: start.toISOString() },
    { ...f.pr, status: 'open', updated_at: now.toISOString() },
    { ...f.pr, status: 'closed', updated_at: now.toISOString() },
    { ...f.pr, status: 'merged', updated_at: new Date(start.getTime() - 1).toISOString() },
    { ...f.pr, status: 'merged', updated_at: 'invalid' },
  ]
  const result = f.optimizationProgress(7, 'day', now)
  assert.deepEqual(JSON.parse(JSON.stringify(result.totals)), { completed: 2, failed: 2, merged: 1 })
  assert.equal(result.buckets.length, 7)
  assert.equal(result.buckets[0].completed, 1)
  assert.equal(result.buckets[0].merged, 1)
  assert.equal(result.start.getTime(), start.getTime())
  assert.equal(result.end.getTime(), now.getTime())
})

test('Progress week buckets use local Monday boundaries and clip partial calendar weeks to the selected window', () => {
  const f = fixture(), now = new Date(2026, 10, 2, 12)
  f.state.items.runs = [
    { id: 'sunday', status: 'failed', finished_at: new Date(2026, 10, 1, 23, 59, 59, 999).toISOString(), skill: f.alpha },
    { id: 'monday', status: 'completed', finished_at: new Date(2026, 10, 2).toISOString(), skill: f.alpha },
  ]
  f.state.items.prs = []
  const week = f.optimizationProgress(7, 'week', now)
  assert.equal(week.buckets.length, 2)
  assert.equal(week.buckets[0].start.getDate(), 27)
  assert.equal(week.buckets[0].failed, 1)
  assert.equal(week.buckets[1].start.getDay(), 1)
  assert.equal(week.buckets[1].completed, 1)
  assert.equal(week.buckets[1].end.getTime(), now.getTime())
  const month = f.optimizationProgress(30, 'day', now)
  assert.equal(month.buckets.length, 30)
  assert.equal(month.start.getMonth(), 9)
  assert.equal(month.start.getDate(), 4)
  const quarter = f.optimizationProgress(90, 'week', now)
  assert.equal(quarter.start.getMonth(), 7)
  assert.equal(quarter.start.getDate(), 5)
  assert.ok(quarter.buckets.slice(1).every((bucket: { start: Date }) => bucket.start.getDay() === 1))
  assert.equal(quarter.buckets[0].start.getTime(), quarter.start.getTime())
})

test('Progress scope excludes hidden repositories globally but preserves direct history and honest empty periods', () => {
  const f = fixture(), now = new Date()
  const finished_at = new Date(now.getTime() - 1000).toISOString()
  f.state.items.runs = [
    { id: 'alpha-complete', skill: f.alpha, issue_number: 1, status: 'completed', finished_at },
    { id: 'beta-fail', skill: f.beta, issue_number: 1, status: 'failed', finished_at },
  ]
  f.state.items.prs = [{ ...f.pr, status: 'merged', updated_at: finished_at }]
  f.setHiddenSkill(f.beta.id)
  assert.deepEqual(JSON.parse(JSON.stringify(f.optimizationProgress(7, 'day', now).totals)), { completed: 1, failed: 0, merged: 0 })
  f.openWorkspace(f.beta.id)
  assert.deepEqual(JSON.parse(JSON.stringify(f.optimizationProgress(7, 'day', now).totals)), { completed: 0, failed: 1, merged: 1 })
  assert.ok(f.element('content').innerHTML.indexOf('progress-title') < f.element('content').innerHTML.indexOf('workspace-columns'))
  f.state.items.runs = []; f.state.items.prs = []
  const empty = f.progressPanel()
  assert.match(empty, /所选时间段没有留存的优化事件/)
  assert.doesNotMatch(empty, /class="progress-chart"|<rect/)
})

test('Resolved issues leave the task queue while grouped activity preserves every failed attempt', () => {
  const f = fixture(), finished_at = new Date().toISOString()
  const merged = { ...f.pr, skill: f.alpha, status: 'merged', decision_state: 'merged', updated_at: finished_at }
  const closed = { ...f.issue, status: 'closed', pull_requests: [merged], runs: [] }
  f.state.items.issues = [closed, { ...f.issue, skill: f.beta, title: 'Still unresolved elsewhere' }]
  f.state.items.prs = [merged]
  f.state.items.runs = [1, 2, 3].map(number => ({ id: `attempt-${number}`, issue_number: 1, skill: f.alpha, status: 'failed', started_at: finished_at, finished_at }))
  assert.equal(f.taskItems().some((task: { item: { skill: { id: string } } }) => task.item.skill.id === f.alpha.id), false)
  assert.equal(f.taskItems().some((task: { item: { skill: { id: string } } }) => task.item.skill.id === f.beta.id), true)
  const groups = f.activityGroups()
  assert.equal(groups.length, 1)
  assert.equal(groups[0].attempts.length, 3)
  const activity = f.statusPage()
  assert.match(activity, /问题已解决/)
  assert.match(activity, /查看 3 次运行记录/)
  assert.equal((activity.match(/class="activity-attempt"/g) || []).length, 3)
  assert.equal(f.optimizationProgress(7, 'day', new Date()).totals.failed, 3)
  assert.match(f.progressPanel(), /class="progress-scale" aria-hidden="true"><span>3<\/span><span>0<\/span>/)
  Object.assign(f.state, { view: 'issues', skillId: f.alpha.id, detailType: 'issues', detail: closed })
  f.renderContent()
  assert.match(f.element('content').innerHTML, /此问题已通过修复请求解决/)
  assert.match(f.element('content').innerHTML, /data-go-pr="1"/)
  assert.ok(f.element('content').innerHTML.indexOf('resolution-banner') < f.element('content').innerHTML.indexOf('修复进展'))
})


test('Executor display separates native assignments and optional DSH from actual global running work', () => {
  const f = fixture()
  f.state.harness = { installed: false, state: 'unavailable', active_runs: 0, model_configured: false }
  f.state.executor = { requested: 'auto', selected: 'native', mode: 'attached', state: 'idle', available: true, ready_for_assignment: true, ready_for_autonomous_execution: false, audit_boundary: 'trusted-host-session', hidden_eval_isolation: false }
  const native = f.statusPage()
  assert.match(native, /全局执行器: <strong>当前 Agent<\/strong>/)
  assert.match(native, /可准备修复任务/)
  assert.match(native, /全局运行: <strong>0<\/strong>/)
  assert.match(native, /沿用当前会话模型/)
  assert.match(native, /DSH（可选）/)
  assert.doesNotMatch(native, /尚未安装可选优化器|请在 Harness 中配置模型|可无人值守执行/)
  f.state.items.runs = [{ id: 'pending', issue_number: 1, skill: f.alpha, status: 'awaiting_agent', runner: 'native-agent', started_at: new Date().toISOString() }]
  assert.equal(f.taskItems().find((task: { item: { skill: { id: string } } }) => task.item.skill.id === f.alpha.id).kind, 'awaiting_agent')
  f.state.harness.active_runs = 2
  assert.match(f.statusPage(), /全局运行: <strong>2<\/strong>/)
  f.state.items.skills[0].executor = { selected: 'dsh', available: false, ready_for_autonomous_execution: false, audit_boundary: 'host-locked' }
  f.openWorkspace(f.alpha.id)
  assert.match(f.element('content').innerHTML, /修复执行器: <strong>DSH<\/strong> · 需要配置/)
  assert.match(f.element('content').innerHTML, /全局运行: <strong>2<\/strong>/)
  f.goHome(); f.state.executor = null
  assert.match(f.statusPage(), /全局执行器: <strong>当前 Agent<\/strong>/)
  Object.assign(f.state, { view: 'issues', skillId: f.alpha.id, detailType: 'issues', detail: { ...f.issue, runs: [{ id: 'waiting', runner: 'native-agent', status: 'awaiting_agent', started_at: new Date().toISOString(), finished_at: null }] } })
  f.renderContent()
  assert.match(f.element('content').innerHTML, /<strong>当前 Agent<\/strong>/)
  assert.match(f.element('content').innerHTML, /class="status awaiting_agent"/)
  assert.doesNotMatch(f.element('content').innerHTML, /class="status failed"|class="status running"/)
})
