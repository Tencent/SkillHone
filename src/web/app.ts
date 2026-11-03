// @ts-nocheck
const messages={
  en:{repositories:'Repositories',skillRepositories:'Skill repositories',code:'Code',skills:'Skills',issues:'Issues',pullRequests:'Pull requests',wiki:'Wiki',local:'Local',nothingHere:'Nothing here yet.',filter:'Filter',localRepos:'{count} local Skill repositories',updated:'Updated {time}',listSkills:'Repositories',listIssues:'Issues',listPrs:'Pull requests',listWiki:'Wiki',open:'Open',closed:'Closed',merged:'Merged',failed:'Failed',running:'Running',completed:'Completed',issue:'Issue',pr:'Pull request',wikiPage:'Wiki',repairs:'Repairs',imported:'Imported from {source} · default branch {branch}',sourceExisting:'existing Git repository',sourcePath:'local directory',sourceCodex:'Codex',sourceClaude:'Claude Code',commands:'Agent commands',opened:'Opened on {date}',updatedAt:'Updated {time}',evidence:'Issue evidence',noDescription:'No description.',trajectory:'Optimization runs',noRuns:'No optimization run recorded.',branch:'Branch: {branch}',linkedPrs:'Linked pull requests',noPr:'No repair pull request yet.',closesIssue:'Closes issue',changeSummary:'Change summary',noDiff:'No diff summary.',changedFiles:'Files changed',noFiles:'No changed files.',commits:'Commits',noCommits:'No commits.',workRecord:'Work record',noNotes:'No notes yet.',agentCommand:'Agent command',notFinished:'Not finished',issuesShort:'issues',prsShort:'pull requests',wikiShort:'wiki',runsShort:'repairs',allRepositories:'All repositories',backTo:'Back to {view}',openCount:'{count} Open',closedCount:'{count} Closed',mergedCount:'{count} Merged',searchPlaceholder:'Filter {view}',conversation:'Conversation',checks:'Checks',filesChanged:'Files changed'},
  zh:{repositories:'Repositories',skillRepositories:'Skill 仓库',code:'Code',skills:'Skills',issues:'Issues',pullRequests:'Pull Requests',wiki:'Wiki',local:'本地',nothingHere:'暂无记录。',filter:'筛选',localRepos:'{count} 个本地 Skill 仓库',updated:'更新于 {time}',listSkills:'Repositories',listIssues:'Issues',listPrs:'Pull Requests',listWiki:'Wiki',open:'开启',closed:'已关闭',merged:'已合并',failed:'失败',running:'运行中',completed:'已完成',issue:'Issue',pr:'Pull Request',wikiPage:'Wiki',repairs:'修复',imported:'导入自 {source} · 默认分支 {branch}',sourceExisting:'已有 Git 仓库',sourcePath:'本地目录',sourceCodex:'Codex',sourceClaude:'Claude Code',commands:'Agent 命令',opened:'创建于 {date}',updatedAt:'更新于 {time}',evidence:'Issue 证据',noDescription:'没有描述。',trajectory:'优化运行',noRuns:'尚无优化运行。',branch:'分支：{branch}',linkedPrs:'关联 Pull Requests',noPr:'尚无修复 Pull Request。',closesIssue:'关闭的 Issue',changeSummary:'变更摘要',noDiff:'暂无变更摘要。',changedFiles:'变更文件',noFiles:'没有变更文件。',commits:'提交',noCommits:'没有提交。',workRecord:'工作记录',noNotes:'暂无记录。',agentCommand:'Agent 命令',notFinished:'未结束',issuesShort:'Issues',prsShort:'Pull Requests',wikiShort:'Wiki',runsShort:'修复',allRepositories:'全部仓库',backTo:'返回{view}',openCount:'{count} 个开启',closedCount:'{count} 个已关闭',mergedCount:'{count} 个已合并',searchPlaceholder:'筛选{view}',conversation:'会话',checks:'检查',filesChanged:'变更文件'}
};
Object.assign(messages.en,{status:'Status',openIssues:'Open issues',openPrs:'Open pull requests',wikiPages:'Wiki pages',harnessStatus:'DeepSeek Harness',idle:'Idle',unavailable:'Unavailable',activeRuns:'{count} active runs',latestOnDemand:'tested release · official NPM · on demand',runnerUnavailable:'optional optimizer is not installed',recentRuns:'Recent optimization runs',activity:'Optimization activity',today:'Today',thisWeek:'This week',runsLabel:'runs',toolCalls:'Tool calls',notRecorded:'Not recorded',duration:'Duration',seconds:'{count}s',noRecentRuns:'No optimization runs recorded.',viewAll:'View all',lastSevenDays:'Last 7 days'});
Object.assign(messages.zh,{status:'Status',openIssues:'开启的 Issues',openPrs:'开启的 Pull Requests',wikiPages:'Wiki 页面',harnessStatus:'DeepSeek Harness',idle:'空闲',unavailable:'不可用',activeRuns:'{count} 个运行中任务',latestOnDemand:'已测试版本 · 官方 NPM · 按需安装',runnerUnavailable:'尚未安装可选优化器',recentRuns:'最近优化运行',activity:'优化活动',today:'今天',thisWeek:'本周',runsLabel:'次运行',toolCalls:'工具调用',notRecorded:'尚未记录',duration:'耗时',seconds:'{count}s',noRecentRuns:'尚无优化运行。',viewAll:'查看全部',lastSevenDays:'最近 7 天'});
Object.assign(messages.en,{triggerPolicy:'Repair and merge policy',immediate:'Immediate',scheduled:'Scheduled',everyMinutes:'Every {count} min',queued:'Queued',optimizing:'Optimizing',review:'In review',done:'Done',pipeline:'Optimization progress',managedHarness:'v{version} · managed by SkillHone',modelReady:'default model selected',modelMissing:'configure a model in Harness',policyCommand:'Trigger: {trigger} · Merge: {merge}',mergeReview:'approval inbox',mergeAutomatic:'automatic after tests'});
Object.assign(messages.zh,{triggerPolicy:'修复与合并策略',immediate:'Issue 后立即优化',scheduled:'定时优化',everyMinutes:'每 {count} 分钟',queued:'待处理',optimizing:'优化中',review:'待审阅',done:'已完成',pipeline:'优化进度',managedHarness:'v{version} · SkillHone 管理',modelReady:'已选择默认模型',modelMissing:'请在 Harness 中配置模型',policyCommand:'触发：{trigger} · 合并：{merge}',mergeReview:'进入审批收件箱',mergeAutomatic:'测试通过后自动合并'});
Object.assign(messages.en,{auditVerified:'host audit verified',auditFailed:'audit integrity failed',auditSigned:'signed',auditStandard:'standard',auditMixed:'mixed'});
Object.assign(messages.zh,{auditVerified:'宿主审计已验证',auditFailed:'审计完整性异常',auditSigned:'已签名',auditStandard:'标准',auditMixed:'混合'});
Object.assign(messages.en,{reproductionTests:'Reproduction tests',noTests:'No Issue-linked reproduction tests.',pending:'Pending',passing:'Passing'});
Object.assign(messages.zh,{reproductionTests:'复现测试',noTests:'这个 Issue 尚未关联复现测试。',pending:'待运行',passing:'通过'});
Object.assign(messages.en,{noRepositoryDocument:'This Skill repository has no README.md or SKILL.md.',documentTooLarge:'This document is too large to preview.'});
Object.assign(messages.zh,{noRepositoryDocument:'这个 Skill 仓库没有 README.md 或 SKILL.md。',documentTooLarge:'文档过大，无法预览。'});
Object.assign(messages.en,{approvalInbox:'Approval inbox',awaitingApproval:'Awaiting your approval',decisionRequired:'Your decision is required',noApprovals:'No pull requests need approval.',mergeApproval:'Merge approval required',mergeApprovalBody:'SkillHone will not merge this pull request on its own. Review the Issue, checks, commits, and files before deciding.',reviewAndMerge:'Review and merge',confirmMergeTitle:'Confirm local merge',confirmMergeBody:'This creates a merge commit on the local default branch and closes the linked Issue. Nothing is pushed.',cancel:'Cancel',mergeLocally:'Merge locally',mergedWithApproval:'Merged locally',localOnly:'Local only · never pushed',mergeFailed:'The pull request could not be merged.'});
Object.assign(messages.zh,{approvalInbox:'审批收件箱',awaitingApproval:'待你审批',decisionRequired:'需要你决定是否合并',noApprovals:'当前没有需要审批的 Pull Request。',mergeApproval:'需要合并审批',mergeApprovalBody:'SkillHone 不会自行合并这个 Pull Request。请先查看 Issue、检查结果、提交和文件，再作决定。',reviewAndMerge:'审阅并合并',confirmMergeTitle:'确认本地合并',confirmMergeBody:'这会在本地默认分支创建合并提交，并关闭关联 Issue；不会执行任何 push。',cancel:'取消',mergeLocally:'确认本地合并',mergedWithApproval:'已在本地合并',localOnly:'仅限本地 · 从不推送',mergeFailed:'Pull Request 合并失败。'});
Object.assign(messages.en,{mergeAndSyncBody:'This merges the local pull request, closes its Issue, and copies the result to the Agent runtime after creating a backup. Nothing is pushed.',mergeAndSync:'Merge and sync',syncRequired:'Merged · sync required',syncRequiredBody:'This Skill was imported in copy mode. Its Agent runtime still uses the previous version.',syncNow:'Sync to Agent',syncComplete:'Synced to Agent',syncCompleteBody:'The Agent runtime uses the merged Skill.',takeoverComplete:'Merged and active',takeoverCompleteBody:'This runtime points directly to the SkillHone repository, so no copy-back is needed.',syncBlocked:'Merged · sync blocked',syncBlockedBody:'SkillHone did not overwrite the Agent runtime because its copy-back safety check did not pass.',confirmSyncTitle:'Sync merged Skill',confirmSyncBody:'This copies the merged Skill to its Agent runtime directory and creates a backup first.',syncFailed:'The merged Skill could not be synchronized.'});
Object.assign(messages.zh,{mergeAndSyncBody:'这会合并本地 Pull Request、关闭关联 Issue，并在创建备份后把结果同步到 Agent 的 Skill 目录；不会执行任何 push。',mergeAndSync:'合并并同步',syncRequired:'已合并 · 等待同步',syncRequiredBody:'这个 Skill 使用 Copy 模式导入，Agent 当前仍在使用旧版本。',syncNow:'同步到 Agent',syncComplete:'已同步到 Agent',syncCompleteBody:'Agent 当前使用的已经是合并后的 Skill。',takeoverComplete:'已合并并生效',takeoverCompleteBody:'运行时直接指向 SkillHone 仓库，不需要复制回去。',syncBlocked:'已合并 · 同步受阻',syncBlockedBody:'Copy-back 安全检查未通过，SkillHone 没有覆盖 Agent 当前使用的版本。',confirmSyncTitle:'同步已合并的 Skill',confirmSyncBody:'这会先创建备份，再把合并后的 Skill 复制到 Agent 的运行时目录。',syncFailed:'已合并的 Skill 无法同步。'});
Object.assign(messages.en,{prDescription:'Pull request description',noPrDescription:'No review description was recorded.'});
Object.assign(messages.zh,{prDescription:'Pull Request 说明',noPrDescription:'这个 Pull Request 没有审阅说明。'});
Object.assign(messages.en,{evaluationGates:'Frozen evaluation gates',baseline:'Baseline',candidate:'Candidate',notEvaluated:'Not evaluated',failing:'Failing'});
Object.assign(messages.zh,{evaluationGates:'冻结评估门槛',baseline:'基线',candidate:'候选',notEvaluated:'尚未评估',failing:'未通过'});
Object.assign(messages.en,{
  workbench:'Workbench',yourSkills:'Your skills',skillOverview:'Skills at a glance',
  overviewHint:'Expand a Skill to see its issues and review requests.',allSkills:'All skills',
  needsApproval:'Needs approval',activeSkills:'Running',skillSearch:'Find a Skill…',
  skillName:'Skill',currentState:'Current state',noOpenIssues:'No open issues',
  noPendingReview:'No pending review',viewRepository:'Open repository',viewApprovals:'View approvals',
  approvalCount:'{count} to review',skillApprovalCount:'Across {count} skills',
  noMatchingSkills:'No skills match this filter.',clearFilters:'Clear filters',
  noSkillsTitle:'Your skills will appear here',noSkillsHint:'Import a Skill repository with your Agent to track its issues, repairs, and approvals.',
  noActiveWork:'No active work',repositoryUnavailable:'Repository unavailable',
  reviewHint:'Review the changes before merging.',approvalClear:'You’re all caught up',
  pipelineHint:'Issues move from the queue to a reviewed repair.',executorDetails:'Executor details',
  version:'Version',model:'Model',audit:'Audit',trigger:'Trigger',mergeRule:'Merge',
  refreshing:'Updating…',refreshFailed:'Update failed · retrying automatically',liveUpdates:'Updates every 5 seconds',
  onlyApprovals:'Awaiting approval only',allPullRequests:'All pull requests',
  reviewSkill:'Review {name}',updatedNow:'Just updated',
});
Object.assign(messages.zh,{
  workbench:'工作台',yourSkills:'当前 Skills',skillOverview:'Skills 总览',
  overviewHint:'展开 Skill，查看相关 Issue 和待审批的修复。',allSkills:'全部 Skills',
  needsApproval:'待审批',activeSkills:'运行中',skillSearch:'查找 Skill…',
  skillName:'Skill',currentState:'当前状态',noOpenIssues:'暂无开启的 Issue',
  noPendingReview:'暂无待审批修复',viewRepository:'查看仓库',viewApprovals:'查看待审批',
  approvalCount:'{count} 项待审批',skillApprovalCount:'涉及 {count} 个 Skills',
  noMatchingSkills:'没有符合筛选条件的 Skill。',clearFilters:'清除筛选',
  noSkillsTitle:'在这里管理你的 Skills',noSkillsHint:'让 Agent 导入 Skill 仓库后，即可查看它的 Issue、修复进度和待审批变更。',
  noActiveWork:'暂无待处理事项',repositoryUnavailable:'仓库不可用',
  reviewHint:'查看变更后，再决定是否合并。',approvalClear:'待审批事项已处理完',
  pipelineHint:'从发现问题，到完成修复与审阅。',executorDetails:'执行器详情',
  version:'版本',model:'模型',audit:'审计',trigger:'触发方式',mergeRule:'合并方式',
  refreshing:'正在更新…',refreshFailed:'更新失败 · 将自动重试',liveUpdates:'每 5 秒更新',
  onlyApprovals:'仅看待审批',allPullRequests:'全部 Pull Requests',
  reviewSkill:'审阅 {name}',updatedNow:'刚刚更新',
});


Object.assign(messages.en,{
  allSkills:'All skills',status:'Overview',skillOverview:'Skills',workbench:'Workbench',repositoryWorkspace:'Repository workspace',backWorkspace:'Back to workspace',
  workQueue:'Needs attention',queueClear:'No tasks need attention.',currentIssues:'Current issues',recentActivity:'Recent activity',
  globalExecutor:'Global executor',defaultTrigger:'Default trigger',trigger:'Trigger',mergeRule:'Merge',queued:'Queued',queueTrigger:'Dispatch on demand',
  immediate:'Start immediately',scheduled:'Scheduled',activeSkills:'Running',needsApproval:'Review',failedTasks:'Failed',openIssues:'Open issues',
  hideFromOverview:'Hide from overview',restoreToOverview:'Restore to overview',hiddenSkills:'Hidden',hiddenNotice:'Hidden from the overview. Its history is still available here.',
  hiddenHelp:'Hidden repositories are excluded from overview counts and tasks. Their history is preserved.',
  visibleSkills:'Visible skills',source:'Source',defaultBranch:'Branch',repositorySummary:'Repository summary',
  testsAndRepair:'Tests and repair details',openWorkspace:'Open workspace',openCode:'View code',viewAll:'View all',
  noMatchingRecords:'No records match this filter.',clearFilters:'Clear filters',skillSearch:'Find a skill…',
  overviewHint:'Repository, current work, and repair history.',allTasks:'All tasks',activeTasks:'Running',reviewTasks:'Review',
  taskCount:'{count} tasks',completedRepairs:'Completed repairs',noCurrentIssues:'No open issues in this repository.',
  allRepositories:'All skills',scopeUnavailable:'This repository is not available in the current catalog.',
  sourceMaintenance:'Runtime maintenance',noRecentRuns:'No repair activity recorded.',
  shownSkills:'Showing {shown} of {total} skills',showMoreSkills:'Show 20 more',collapseSkills:'Collapse list',loadingWorkbench:'Loading workbench…',loadingRecord:'Loading repository record…',navigationFailed:'Could not load this record',retry:'Retry',
  optimizationProgress:'Optimization progress',lastDays:'Last {days} days',byDay:'By day',byWeek:'By week',completedRuns:'Completed runs',failedRuns:'Failed runs',mergedRepairs:'Merged repairs',
  progressNote:'Local records only. Completion and merge are separate; failed attempts may belong to resolved issues.',noProgressEvents:'No recorded optimization events in this period.',progressTrend:'Completed runs, failed runs, and merged repairs over time',progressBreakdown:'View period breakdown',period:'Period',issueResolved:'Issue resolved',issueClosedNote:'Issue closed',resolvedHistory:'This issue was resolved by a merged repair.',historicalRuns:'The runs below are historical attempts; their original results are preserved.',viewRepair:'View repair',attemptCount:'{count} attempts',attemptHistory:'View {count} run records',allActivity:'All activity',collapseActivity:'Show recent activity',hideShort:'Hide',restoreShort:'Restore',currentAgent:'Current Agent',dshExecutor:'DSH',awaiting_agent:'Waiting for current Agent',cancelled:'Cancelled',executorReady:'Ready',executorNeedsSetup:'Needs setup',globalRunning:'Global running',repairExecutor:'Repair executor',executorMode:'Execution mode',attachedSession:'Current session',managedProcess:'Managed process',executorCapability:'Capability',assignmentReady:'Can prepare assignments',autonomousReady:'Can run unattended',currentSessionModel:'Keep current session model',optionalDsh:'DSH (optional)',notInstalled:'Not installed',executionBoundary:'Execution boundary',trustedSession:'Trusted current session',lockedProcess:'Host-locked process',
});
Object.assign(messages.zh,{
  status:'总览',repositories:'技能',skillRepositories:'全部技能',code:'代码',skills:'技能',issues:'问题',pullRequests:'修复请求',wiki:'工作记录',
  listSkills:'技能',listIssues:'问题',listPrs:'修复请求',listWiki:'工作记录',issue:'问题',pr:'修复请求',wikiPage:'工作记录',
  issuesShort:'问题',prsShort:'修复请求',wikiShort:'工作记录',allRepositories:'全部技能',allSkills:'全部技能',
  workbench:'工作台',repositoryWorkspace:'仓库工作区',backWorkspace:'返回工作区',skillOverview:'技能',yourSkills:'技能',visibleSkills:'显示中的技能',
  overviewHint:'查看仓库、当前任务和修复记录。',skillSearch:'搜索技能…',skillName:'技能',
  workQueue:'需处理',queueClear:'当前没有需要处理的任务。',currentIssues:'当前问题',recentActivity:'最近活动',
  globalExecutor:'全局执行器',defaultTrigger:'默认触发',trigger:'触发',mergeRule:'合并',queued:'排队中',queueTrigger:'排队后调度',
  immediate:'立即开始',scheduled:'定时开始',optimizing:'修复中',review:'待审阅',done:'已完成',needsApproval:'待审阅',
  activeSkills:'运行中',failedTasks:'失败',openIssues:'未关闭问题',openPrs:'未关闭修复请求',wikiPages:'工作记录',
  hideFromOverview:'从总览隐藏',restoreToOverview:'恢复显示',hiddenSkills:'已隐藏',
  hiddenNotice:'此仓库已从总览隐藏，仍可在这里查看历史。',hiddenHelp:'隐藏的仓库不计入总览统计和任务，历史记录保留。',
  source:'来源',defaultBranch:'分支',repositorySummary:'仓库信息',testsAndRepair:'测试与修复详情',openWorkspace:'进入工作区',openCode:'查看代码',
  noMatchingRecords:'没有符合筛选条件的记录。',noMatchingSkills:'没有符合筛选条件的技能。',clearFilters:'清空筛选',
  noSkillsTitle:'还没有技能仓库',noSkillsHint:'导入技能仓库后，即可查看问题和修复进展。',
  allTasks:'全部任务',activeTasks:'运行中',reviewTasks:'待审阅',taskCount:'{count} 项任务',
  noCurrentIssues:'此仓库当前没有未关闭的问题。',noOpenIssues:'没有未关闭的问题',noActiveWork:'暂无任务',
  scopeUnavailable:'当前登记表中没有此仓库。',sourceMaintenance:'运行时维护',
  evidence:'问题描述与复现',noTests:'此问题尚未关联复现测试。',linkedPrs:'关联修复请求',noPr:'尚无关联修复请求。',
  closesIssue:'关联问题',reproductionTests:'复现测试',prDescription:'修复说明',noPrDescription:'尚无修复说明。',
  noApprovals:'没有待审阅的修复请求。',awaitingApproval:'待审阅',approvalInbox:'待审阅修复',onlyApprovals:'仅看待审阅',allPullRequests:'全部修复请求',
  mergeApproval:'等待审阅',mergeApprovalBody:'查看问题、测试、提交和变更文件后，可在这里合入修复。',
  mergeFailed:'修复请求合入失败。',noRecentRuns:'尚无修复活动。',noRuns:'尚无修复运行。',trajectory:'修复进展',recentRuns:'最近运行',
  completedRepairs:'已完成修复',mergeReview:'审阅后合入',mergeAutomatic:'测试通过后自动合入',
  shownSkills:'已显示 {shown} / {total} 项',showMoreSkills:'再显示 20 项',collapseSkills:'收起列表',loadingWorkbench:'正在加载工作台…',loadingRecord:'正在加载仓库记录…',navigationFailed:'记录加载失败',retry:'重试',
  optimizationProgress:'优化进展',lastDays:'近 {days} 天',byDay:'按天',byWeek:'按周',completedRuns:'完成运行',failedRuns:'失败运行',mergedRepairs:'修复合入',
  progressNote:'按本地留存记录统计；运行完成与修复合入分别计数，历史失败不等于未解决问题数。',noProgressEvents:'所选时间段没有留存的优化事件。',progressTrend:'完成运行、失败运行与修复合入的时间趋势',progressBreakdown:'查看分段明细',period:'时间段',issueResolved:'问题已解决',issueClosedNote:'问题已关闭',resolvedHistory:'此问题已通过修复请求解决。',historicalRuns:'以下为历史运行记录，保留每次尝试的原始结果。',viewRepair:'查看修复',attemptCount:'{count} 次尝试',attemptHistory:'查看 {count} 次运行记录',allActivity:'全部活动',collapseActivity:'只看最近活动',hideShort:'隐藏',restoreShort:'恢复',currentAgent:'当前 Agent',dshExecutor:'DSH',awaiting_agent:'等待当前 Agent',cancelled:'已取消',executorReady:'就绪',executorNeedsSetup:'需要配置',globalRunning:'全局运行',repairExecutor:'修复执行器',executorMode:'执行方式',attachedSession:'当前会话',managedProcess:'托管进程',executorCapability:'执行能力',assignmentReady:'可准备修复任务',autonomousReady:'可无人值守执行',currentSessionModel:'沿用当前会话模型',optionalDsh:'DSH（可选）',notInstalled:'未安装',executionBoundary:'执行边界',trustedSession:'受信任的当前会话',lockedProcess:'宿主锁定的进程',
});

// SVG path data from Primer Octicons. See THIRD_PARTY_NOTICES.md.
const iconPaths={
  issue:'<path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/>',
  issueClosed:'<path d="M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z"/><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z"/>',
  pr:'<path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0 0-1.5Z"/>',
  merge:'<path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z"/>',
  repo:'<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/>',
  book:'<path d="M0 1.75A.75.75 0 0 1 .75 1h4.253c1.227 0 2.317.59 3 1.501A3.743 3.743 0 0 1 11.006 1h4.245a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75h-4.507a2.25 2.25 0 0 0-1.591.659l-.622.621a.75.75 0 0 1-1.06 0l-.622-.621A2.25 2.25 0 0 0 5.258 13H.75a.75.75 0 0 1-.75-.75Zm7.251 10.324.004-5.073-.002-2.253A2.25 2.25 0 0 0 5.003 2.5H1.5v9h3.757a3.75 3.75 0 0 1 1.994.574ZM8.755 4.75l-.004 7.322a3.752 3.752 0 0 1 1.992-.572H14.5v-9h-3.495a2.25 2.25 0 0 0-2.25 2.25Z"/>',
};

const storedLocale=localStorage.getItem('skillhone.locale');
const requestedLocale=new URLSearchParams(location.search).get('lang');
const initialLocale=requestedLocale==='en'||requestedLocale==='zh'
  ?requestedLocale
  :storedLocale||((navigator.language||'').toLowerCase().startsWith('zh')?'zh':'en');
function readHiddenSkills(){try{const value=JSON.parse(localStorage.getItem('skillhone.hiddenSkills')||'[]');return Array.isArray(value)?value.filter(id=>typeof id==='string'):[]}catch{return []}}
const state={navigationLoading:false,navigationError:null,navigationTarget:null,updateFailed:false,progressDays:7,progressBucket:'day',activityExpanded:false,hiddenSkills:readHiddenSkills(),showHidden:false,skillLimit:20,taskFilter:'all',view:'status',items:{skills:[],issues:[],prs:[],wiki:[],runs:[]},harness:{state:'unavailable',active_runs:0,launch_mode:'unavailable'},audit:{integrity:'failed'},automation:{default:{mode:'queued',interval_minutes:60}},mergePolicy:{mode:'review',scope:'default'},notifications:{approval_required:0},executor:null,skillId:null,query:'',skillQuery:'',skillFilter:'all',approvalOnly:false,locale:initialLocale,detail:null,detailType:null,prTab:'conversation',lastUpdated:null};
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const inlineMarkdown=value=>esc(value)
  .replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g,'<em>$1</em>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noreferrer">$1</a>');
function renderMarkdown(value){
  const lines=String(value??'').replace(/\r/g,'').split('\n');let html='',paragraph=[],list=null,inCode=false,code=[];
  if(lines[0]?.trim()==='---'){
    const end=lines.slice(1).findIndex(line=>line.trim()==='---');
    if(end>=0){const fields=lines.slice(1,end+1).map(line=>line.match(/^([^:]+):\s*(.*)$/)).filter(Boolean);if(fields.length)html+=`<dl class="frontmatter">${fields.map(field=>`<div><dt>${esc(field[1].trim())}</dt><dd>${inlineMarkdown(field[2].trim())}</dd></div>`).join('')}</dl>`;lines.splice(0,end+2)}
  }
  const flushParagraph=()=>{if(paragraph.length){html+=`<p>${paragraph.map(inlineMarkdown).join('<br>')}</p>`;paragraph=[]}};
  const flushList=()=>{if(list){html+=`<${list.type}>${list.items.map(item=>`<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`;list=null}};
  const flushCode=()=>{html+=`<pre><code>${esc(code.join('\n'))}</code></pre>`;code=[]};
  for(const line of lines){
    if(line.startsWith('```')){if(inCode){flushCode();inCode=false}else{flushParagraph();flushList();inCode=true}continue}
    if(inCode){code.push(line);continue}
    if(!line.trim()){flushParagraph();flushList();continue}
    const heading=line.match(/^(#{1,6})\s+(.+)$/);if(heading){flushParagraph();flushList();const level=heading[1].length;html+=`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;continue}
    const bullet=line.match(/^\s*[-*+]\s+(.+)$/);const ordered=line.match(/^\s*\d+[.)]\s+(.+)$/);
    if(bullet||ordered){flushParagraph();const type=ordered?'ol':'ul';if(list&&list.type!==type)flushList();if(!list)list={type,items:[]};list.items.push((ordered||bullet)[1]);continue}
    const quote=line.match(/^>\s?(.*)$/);if(quote){flushParagraph();flushList();html+=`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`;continue}
    paragraph.push(line)
  }
  if(inCode)flushCode();flushParagraph();flushList();return html
}
const t=(key,values={})=>Object.entries(values).reduce((text,[name,value])=>text.replaceAll(`{${name}}`,String(value)),messages[state.locale][key]??key);
const svg=(name,className='')=>`<svg class="icon ${className}" aria-hidden="true" viewBox="0 0 16 16">${iconPaths[name]}</svg>`;
const nice=value=>value?new Date(value).toLocaleString(state.locale==='zh'?'zh-CN':'en-US',{dateStyle:'medium',timeStyle:'short'}):t('notFinished');
const currentSkill=()=>state.items.skills.find(item=>item.id===state.skillId)||null;
const sourceName=value=>t({existing:'sourceExisting',path:'sourcePath',codex:'sourceCodex',cursor:'Cursor','claude-code':'sourceClaude','runtime-maintenance':'sourceMaintenance'}[value]||value);
const prTitle=item=>item.issue_number?item.title.replace(new RegExp(`^Fix #${item.issue_number}:\\s*`),''):item.title;
const currentPolicy=()=>currentSkill()?.automation||state.automation.default;
const currentMergePolicy=()=>currentSkill()?.merge_policy||state.mergePolicy;
const stageLabel=stage=>t(stage||'queued');
const policyLabel=policy=>policy.mode==='scheduled'?`${t('scheduled')} · ${t('everyMinutes',{count:policy.interval_minutes})}`:t(policy.mode==='queued'?'queueTrigger':policy.mode||'queueTrigger');
const stageBadge=stage=>`<span class="stage-badge ${esc(stage||'queued')}">${esc(stageLabel(stage))}</span>`;

async function api(path,options){const response=await fetch(path,options);if(!response.ok)throw new Error((await response.json()).error||response.statusText);return response.json()}

function isHidden(id){return state.hiddenSkills.includes(id)}
function visibleSkills(){return state.items.skills.filter(skill=>!isHidden(skill.id))}
function scopedItems(view){
  const items=state.items[view]||[];
  if(state.skillId)return view==='skills'?items.filter(item=>item.id===state.skillId):items.filter(item=>item.skill?.id===state.skillId);
  return items.filter(item=>!isHidden(view==='skills'?item.id:item.skill?.id));
}
function filtered(){
  let items=scopedItems(state.view);
  if(state.view==='prs'&&state.approvalOnly)items=items.filter(item=>item.decision_state==='awaiting_approval');
  const q=state.query.toLowerCase();
  return items.filter(item=>`${item.name||''} ${item.title||''} ${item.skill?.name||''} ${item.head||''} ${item.body||''} ${item.slug||''}`.toLowerCase().includes(q));
}
function statusText(status){return t(Object.hasOwn(messages.en,status)?status:'open')}
function issueIcon(status){return svg(status==='closed'?'issueClosed':'issue',status==='closed'?'issue-closed':'issue-open')}
function prIcon(status){return svg(status==='merged'?'merge':'pr',status==='merged'?'pr-merged':status==='closed'?'pr-closed':'pr-open')}
function statusPill(status,type){const icon=type==='issue'?issueIcon(status):type==='pr'?prIcon(status):svg(status==='completed'?'issueClosed':'issue');return `<span class="status ${esc(status)}">${icon}${esc(statusText(status))}</span>`}
function countItem(iconName,value,label,className=''){return `<span>${svg(iconName,className)}<strong>${value}</strong> ${esc(label)}</span>`}
function itemHtml(item){
  if(state.view==='skills')return `<button class="item repo-row" data-workspace-skill="${esc(item.id)}"><div class="item-main"><h3>${svg('repo')}<span>${esc(item.name)}</span></h3><p>${esc(sourceName(item.source))} · ${esc(item.default_branch)}</p></div><span class="row-arrow">→</span></button>`;
  if(state.view==='wiki')return `<button class="item" data-id="${esc(item.skill.id)}" data-slug="${esc(item.slug)}"><span class="list-icon">${svg('book')}</span><div class="item-main"><h3>${esc(item.title)}</h3><p>${state.skillId?'':`${esc(item.skill.name)} · `}${esc(t('updatedAt',{time:nice(item.updated_at)}))}</p></div></button>`;
  const type=state.view==='issues'?'issue':'pr';
  return `<button class="item" data-id="${esc(item.skill.id)}" data-number="${item.number}"><span class="list-icon">${type==='issue'?issueIcon(item.status):prIcon(item.status)}</span><div class="item-main"><h3>${esc(type==='pr'?prTitle(item):item.title)} <span class="muted-number">#${item.number}</span></h3><p>${state.skillId?'':`${esc(item.skill.name)} · `}${type==='issue'?esc(t('updatedAt',{time:nice(item.updated_at)})):`${esc(item.head)} → ${esc(item.base)}`}</p></div>${type==='issue'?stageBadge(item.stage):item.decision_state==='awaiting_approval'?stageBadge('review'):statusPill(item.status,'pr')}</button>`;
}
function listSummary(items){if(state.view==='skills'||state.view==='wiki')return '';return `<div class="state-summary"><span>${esc(t('openCount',{count:items.filter(item=>item.status==='open').length}))}</span><span>${esc(t('closedCount',{count:items.filter(item=>item.status==='closed').length}))}</span>${state.view==='prs'?`<span>${esc(t('mergedCount',{count:items.filter(item=>item.status==='merged').length}))}</span>`:''}</div>`}
function clearEmpty(message){return `<div class="list-empty"><p>${esc(t(message))}</p><button class="text-button" data-clear-filters>${esc(t('clearFilters'))}</button></div>`}
function pageHeading(title,extra=''){return `<div class="page-title"><h1>${esc(title)}</h1><div class="heading-actions">${extra}</div></div>`}
function listPage(){
  if(state.view==='skills'&&!state.skillId)return `${pageHeading(t('skills'))}${skillOverview()}`;
  const items=filtered(),label=t({skills:'listSkills',issues:'listIssues',prs:'listPrs',wiki:'listWiki'}[state.view]);
  return `${pageHeading(label)}<section class="list-panel"><div class="list-toolbar">${state.view==='prs'?`<button class="filter-chip ${state.approvalOnly?'selected':''}" data-toggle-approvals aria-pressed="${state.approvalOnly}">${esc(t('onlyApprovals'))}</button>`:listSummary(items)}<label class="search"><span>⌕</span><input id="search" type="search" value="${esc(state.query)}" aria-label="${esc(t('searchPlaceholder',{view:label}))}" placeholder="${esc(t('searchPlaceholder',{view:label}))}"></label></div><div class="item-list">${items.length?items.map(itemHtml).join(''):state.query||state.approvalOnly?clearEmpty('noMatchingRecords'):`<div class="list-empty">${esc(t('nothingHere'))}</div>`}</div></section>`;
}
function runnerLabel(runner){return runner==='native-agent'?t('currentAgent'):runner==='deepseek-harness'||runner==='dsh'?t('dshExecutor'):runner}
function runTimeline(runs){if(!runs?.length)return `<p class="body-copy">${esc(t('noRuns'))}</p>`;return `<div class="timeline">${runs.map(run=>`<div class="timeline-row"><div class="timeline-head"><strong>${esc(runnerLabel(run.runner))}</strong>${statusPill(run.status,'run')}</div><p>${nice(run.started_at)} → ${nice(run.finished_at)}</p><p>${esc(t('branch',{branch:run.branch}))}</p></div>`).join('')}</div>`}
function duration(run){if(!run.finished_at)return '—';const seconds=Math.max(0,Math.round((new Date(run.finished_at)-new Date(run.started_at))/1000));return t('seconds',{count:seconds})}
function skillWork(skill){
  const belongs=item=>item.skill?.id===skill.id;
  const issues=state.items.issues.filter(belongs),approvals=state.items.prs.filter(item=>belongs(item)&&item.decision_state==='awaiting_approval'),runs=state.items.runs.filter(belongs);
  const active=runs.some(item=>item.status==='running'),awaiting=runs.some(item=>item.status==='awaiting_agent');
  const stage=skill.available===false?'unavailable':active?'optimizing':awaiting?'awaiting_agent':approvals.length?'review':issues.some(item=>item.stage==='failed')?'failed':issues.some(item=>item.status==='open')?'queued':'clear';
  return {skill,issues,approvals,runs,active,stage};
}
function workLabel(stage){return stage==='clear'?t('noActiveWork'):stage==='unavailable'?t('repositoryUnavailable'):stageLabel(stage)}
function skillOverview(){
  const all=state.items.skills.filter(skill=>state.showHidden?isHidden(skill.id):!isHidden(skill.id)).map(skillWork);
  const matches=all.filter(item=>(state.skillFilter!=='review'||item.approvals.length)&&(state.skillFilter!=='active'||item.active)&&(state.skillFilter!=='failed'||item.stage==='failed')&&item.skill.name.toLowerCase().includes(state.skillQuery.toLowerCase()))
    .sort((a,b)=>Number(b.active)-Number(a.active)||Number(Boolean(b.approvals.length))-Number(Boolean(a.approvals.length))||a.skill.name.localeCompare(b.skill.name));
  const shown=matches.slice(0,state.skillLimit);
  const hiddenCount=state.items.skills.filter(skill=>isHidden(skill.id)).length;
  const filters=[['all','allSkills',all.length],['review','needsApproval',all.filter(item=>item.approvals.length).length],['active','activeSkills',all.filter(item=>item.active).length]];
  return `<section class="list-panel skill-overview" aria-labelledby="skill-overview-title"><header class="section-header"><h2 id="skill-overview-title">${esc(t(state.showHidden?'hiddenSkills':'skills'))}<span class="section-count">${matches.length}</span></h2><button class="text-button" data-toggle-hidden aria-pressed="${state.showHidden}">${esc(t(state.showHidden?'allSkills':'hiddenSkills'))}${!state.showHidden?` (${hiddenCount})`:''}</button></header>
    ${state.showHidden?`<p class="notice">${esc(t('hiddenHelp'))}</p>`:''}
    <div class="skill-toolbar"><div class="filter-group">${filters.map(([value,key,count])=>`<button type="button" data-skill-filter="${value}" aria-pressed="${state.skillFilter===value}" class="filter-chip ${state.skillFilter===value?'selected':''}">${esc(t(key))}<span>${count}</span></button>`).join('')}</div><label class="search"><span>⌕</span><input id="skill-search" type="search" value="${esc(state.skillQuery)}" aria-label="${esc(t('skillSearch'))}" placeholder="${esc(t('skillSearch'))}"></label></div>
    <div class="skill-list">${shown.map(({skill,issues,approvals,stage})=>`<div class="skill-entry"><button class="skill-main" data-workspace-skill="${esc(skill.id)}"><span class="skill-identity">${svg('repo')}<span><strong>${esc(skill.name)}</strong><small>${esc(sourceName(skill.source))} · ${esc(skill.default_branch||'—')}</small></span></span><span class="skill-row-meta"><span class="skill-state ${esc(stage)}">${esc(workLabel(stage))}</span><span class="skill-counts">${issues.filter(item=>item.status==='open').length} ${esc(t('issues'))}${approvals.length?` · ${approvals.length} ${esc(t('needsApproval'))}`:''}</span></span><span class="row-arrow" aria-hidden="true">→</span></button><button class="quiet-button visibility-action" data-hide-skill="${esc(skill.id)}" aria-label="${esc(t(isHidden(skill.id)?'restoreToOverview':'hideFromOverview'))}: ${esc(skill.name)}" title="${esc(t(isHidden(skill.id)?'restoreToOverview':'hideFromOverview'))}">${esc(t(isHidden(skill.id)?'restoreShort':'hideShort'))}</button></div>`).join('')||clearEmpty('noMatchingSkills')}</div>${matches.length?`<footer class="skill-list-footer"><span>${esc(t('shownSkills',{shown:shown.length,total:matches.length}))}</span><div>${shown.length<matches.length?`<button class="text-button" data-show-more-skills>${esc(t('showMoreSkills'))}</button>`:''}${state.skillLimit>20&&matches.length>20?`<button class="quiet-button" data-collapse-skills>${esc(t('collapseSkills'))}</button>`:''}</div></footer>`:''}</section>`;
}
function taskItems(){
  const issues=scopedItems('issues'),prs=scopedItems('prs'),runs=scopedItems('runs');
  const tasks=prs.filter(pr=>pr.decision_state==='awaiting_approval').map(pr=>({kind:'review',type:'prs',item:pr}));
  for(const issue of issues){
    const active=runs.some(run=>run.skill?.id===issue.skill?.id&&run.issue_number===issue.number&&run.status==='running');
    if(issue.status!=='open')continue;
    if(!active&&tasks.some(task=>task.item.skill?.id===issue.skill?.id&&task.item.issue_number===issue.number))continue;
    const awaiting=runs.some(run=>run.skill?.id===issue.skill?.id&&run.issue_number===issue.number&&run.status==='awaiting_agent');
    tasks.push({kind:active?'optimizing':awaiting?'awaiting_agent':issue.stage==='failed'?'failed':'queued',type:'issues',item:issue});
  }
  const order={optimizing:0,review:1,failed:2,awaiting_agent:3,queued:4};
  return tasks.sort((a,b)=>order[a.kind]-order[b.kind]||String(b.item.updated_at||'').localeCompare(String(a.item.updated_at||'')));
}
function taskRow(task){const item=task.item;return `<button class="task-row" ${task.type==='prs'?`data-approval-skill="${esc(item.skill.id)}" data-approval-number="${item.number}"`:`data-run-skill="${esc(item.skill.id)}" data-run-issue="${item.number}"`}><span class="task-kind ${esc(task.kind)}">${task.type==='prs'?prIcon(item.status):issueIcon(item.status)}</span><span class="task-main"><strong>${esc(task.type==='prs'?prTitle(item):item.title)}</strong><small>${state.skillId?'':`${esc(item.skill.name)} · `}${esc(t(task.type==='prs'?'pr':'issue'))} #${item.number}</small></span>${stageBadge(task.kind)}<span class="row-arrow" aria-hidden="true">→</span></button>`}
function taskPanel(){
  const all=taskItems(),tasks=all.filter(task=>state.taskFilter==='all'||task.kind===state.taskFilter);
  return `<section class="list-panel task-panel" aria-labelledby="task-panel-title"><header class="section-header"><h2 id="task-panel-title">${esc(t('workQueue'))}<span class="section-count">${all.length}</span></h2><div class="filter-group">${[['all','allTasks'],['optimizing','activeTasks'],['review','reviewTasks'],['failed','failedTasks']].map(([value,key])=>`<button class="filter-chip ${state.taskFilter===value?'selected':''}" data-task-filter="${value}" aria-pressed="${state.taskFilter===value}">${esc(t(key))}</button>`).join('')}</div></header><div>${tasks.length?tasks.map(taskRow).join(''):state.taskFilter!=='all'?clearEmpty('noMatchingRecords'):`<p class="compact-empty">${esc(t('queueClear'))}</p>`}</div></section>`;
}
function activityGroups(runs=scopedItems('runs')){
  const grouped=new Map();
  for(const run of [...runs].sort((a,b)=>String(b.started_at||'').localeCompare(String(a.started_at||'')))){
    const key=`${run.skill?.id}/${run.issue_number??run.id}`;
    if(!grouped.has(key))grouped.set(key,{key,run,attempts:[]});grouped.get(key).attempts.push(run);
  }
  return [...grouped.values()].map(group=>({...group,issue:state.items.issues.find(item=>item.skill?.id===group.run.skill?.id&&item.number===group.run.issue_number),merged:state.items.prs.find(pr=>pr.skill?.id===group.run.skill?.id&&pr.issue_number===group.run.issue_number&&pr.status==='merged')}));
}
function activityPanel(runs=scopedItems('runs')){
  const groups=activityGroups(runs),shown=state.activityExpanded?groups:groups.slice(0,5);
  return `<section class="list-panel recent-runs"><header class="section-header"><h2>${esc(t('recentActivity'))}</h2>${groups.length>5?`<button class="text-button" data-toggle-activity>${esc(t(state.activityExpanded?'collapseActivity':'allActivity'))}</button>`:''}</header>${shown.length?shown.map(({key,run,attempts,issue,merged})=>{const resolution=merged?t('issueResolved'):issue?.status==='closed'?t('issueClosedNote'):null;return `<article class="activity-group"><button class="activity-row" data-run-skill="${esc(run.skill.id)}" data-run-issue="${run.issue_number}"><span class="run-state ${resolution?'completed':esc(run.status)}">${svg(resolution?'issueClosed':'issue')}</span><span class="task-main"><strong>${esc(issue?.title||`${t('issue')} #${run.issue_number}`)}</strong><small>${state.skillId?'':`${esc(run.skill.name)} · `}${esc(t('attemptCount',{count:attempts.length}))} · ${nice(run.started_at)}</small></span>${resolution?`<span class="stage-badge done">${esc(resolution)}</span>`:statusPill(run.status,'run')}</button><details class="attempt-history" data-preserve="activity-${esc(key)}"><summary>${esc(t('attemptHistory',{count:attempts.length}))}</summary><div>${attempts.map(attempt=>`<div class="activity-attempt">${statusPill(attempt.status,'run')}<span>${nice(attempt.started_at)}</span><span>${esc(duration(attempt))}</span></div>`).join('')}</div></details></article>`}).join(''):`<p class="compact-empty">${esc(t('noRecentRuns'))}</p>`}</section>`;
}

function currentExecutor(scoped=false){
  const descriptor=scoped?(currentSkill()?.executor??state.executor):state.executor;
  if(descriptor)return descriptor;
  // Older servers expose only Harness metadata. Missing optional DSH must not
  // imply that the attached current-Agent workflow is unavailable.
  const dsh=Boolean(state.harness.installed);
  return {requested:dsh?'dsh':'auto',selected:dsh?'dsh':'native',mode:dsh?'managed':'attached',state:dsh?state.harness.state:'idle',available:dsh?state.harness.model_configured!==false:true,ready_for_assignment:!dsh,ready_for_autonomous_execution:dsh&&state.harness.model_configured!==false,audit_boundary:dsh?'host-locked':'trusted-host-session'};
}
function runtimeStrip(scoped=false){
  const harness=state.harness,executor=currentExecutor(scoped),native=executor.selected==='native',name=t(native?'currentAgent':'dshExecutor');
  const policy=scoped?currentPolicy():state.automation.default,merge=scoped?currentMergePolicy():state.mergePolicy;
  const label=native?t(executor.state==='awaiting_agent'?'awaiting_agent':'assignmentReady'):t(executor.available?'executorReady':'executorNeedsSetup');
  const active=harness.active_runs??state.items.runs.filter(run=>run.status==='running').length;
  return `<div class="runtime-strip"><span class="executor-state"><i class="status-dot ${executor.available?'idle':'unavailable'}"></i>${esc(t(scoped?'repairExecutor':'globalExecutor'))}: <strong>${esc(name)}</strong> · ${esc(label)}</span><span>${esc(t('globalRunning'))}: <strong>${active}</strong></span><span>${esc(t(scoped?'trigger':'defaultTrigger'))}: <strong>${esc(policyLabel(policy))}</strong></span><span>${esc(t('mergeRule'))}: ${esc(t(merge.mode==='automatic'?'mergeAutomatic':'mergeReview'))}</span><details class="runtime-details" data-preserve="executor"><summary>${esc(t('executorDetails'))}</summary><dl><div><dt>${esc(t('executorMode'))}</dt><dd>${esc(t(native?'attachedSession':'managedProcess'))}</dd></div><div><dt>${esc(t('executorCapability'))}</dt><dd>${esc(t(native?'assignmentReady':executor.ready_for_autonomous_execution?'autonomousReady':'executorNeedsSetup'))}</dd></div><div><dt>${esc(t('model'))}</dt><dd>${esc(t(native?'currentSessionModel':harness.model_configured?'modelReady':'modelMissing'))}</dd></div><div><dt>${esc(t(native?'optionalDsh':'version'))}</dt><dd>${esc(harness.installed?harness.version||'—':t('notInstalled'))}</dd></div><div><dt>${esc(t('executionBoundary'))}</dt><dd>${esc(t(native?'trustedSession':'lockedProcess'))}</dd></div><div><dt>${esc(t('audit'))}</dt><dd>${esc(t(state.audit.integrity==='verified'?'auditVerified':'auditFailed'))}</dd></div></dl></details></div>`;
}

function localDay(date){const value=new Date(date);value.setHours(0,0,0,0);return value}
function bucketDate(date,unit){const value=localDay(date);if(unit==='week')value.setDate(value.getDate()-(value.getDay()+6)%7);return value}
function dateKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function optimizationProgress(period=state.progressDays,unit=state.progressBucket,now=new Date()){
  const days=[7,30,90].includes(period)?period:7,step=unit==='week'?7:1;
  const start=localDay(now);start.setDate(start.getDate()-days+1);
  const end=new Date(now),buckets=[],byDate=new Map();
  for(const cursor=bucketDate(start,unit);cursor<=end;cursor.setDate(cursor.getDate()+step)){
    const next=new Date(cursor);next.setDate(next.getDate()+step);
    const item={start:new Date(Math.max(cursor.getTime(),start.getTime())),end:new Date(Math.min(next.getTime()-1,end.getTime())),completed:0,failed:0,merged:0};
    buckets.push(item);byDate.set(dateKey(cursor),item);
  }
  function count(value,kind){
    if(typeof value!=='string'||!value)return;
    const time=new Date(value);if(!Number.isFinite(time.getTime())||time<start||time>end)return;
    const bucket=byDate.get(dateKey(bucketDate(time,unit)));if(bucket)bucket[kind]++;
  }
  for(const run of scopedItems('runs'))if(run.status==='completed'||run.status==='failed')count(run.finished_at,run.status);
  // mergePr is the only writer of a merged PR's updated_at; it records the
  // merge time. Creation time would misplace repairs opened in earlier periods.
  for(const pr of scopedItems('prs'))if(pr.status==='merged')count(pr.updated_at,'merged');
  const totals=buckets.reduce((sum,item)=>({completed:sum.completed+item.completed,failed:sum.failed+item.failed,merged:sum.merged+item.merged}),{completed:0,failed:0,merged:0});
  return {start,end,buckets,totals};
}
function progressDate(date){return date.toLocaleDateString(state.locale==='zh'?'zh-CN':'en-US',{month:'short',day:'numeric'})}
function progressBucketLabel(bucket){return dateKey(bucket.start)===dateKey(bucket.end)?progressDate(bucket.start):`${progressDate(bucket.start)}–${progressDate(bucket.end)}`}
function progressPanel(){
  const {start,end,buckets,totals}=optimizationProgress(),series=[['completed','completedRuns'],['failed','failedRuns'],['merged','mergedRepairs']];
  const hasEvents=totals.completed+totals.failed+totals.merged>0,max=Math.max(1,...buckets.flatMap(bucket=>series.map(([kind])=>bucket[kind]))),width=640,height=120,slot=width/buckets.length,bar=slot/5;
  const range=`${progressDate(start)}–${progressDate(end)}`;
  const graph=hasEvents?`<div class="progress-chart"><div class="progress-plot"><div class="progress-scale" aria-hidden="true"><span>${max}</span><span>0</span></div><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(t('progressTrend'))}"><title>${esc(t('progressTrend'))} · ${esc(range)}</title><g class="progress-grid">${[0,40,80,120].map(y=>`<line x1="0" x2="${width}" y1="${y}" y2="${y}"/>`).join('')}</g>${buckets.map((bucket,index)=>`<g><title>${esc(progressBucketLabel(bucket))} · ${series.map(([kind,key])=>`${esc(t(key))}: ${bucket[kind]}`).join(' · ')}</title>${series.map(([kind],offset)=>{const value=bucket[kind],h=value/max*(height-4);return `<rect class="progress-bar ${kind}" x="${index*slot+bar*(offset+1)}" y="${height-h}" width="${bar}" height="${h}"/>`}).join('')}</g>`).join('')}</svg></div><div class="progress-axis"><span>${esc(progressDate(buckets[0].start))}</span><span>${esc(progressDate(buckets[Math.floor(buckets.length/2)].start))}</span><span>${esc(progressDate(buckets[buckets.length-1].end))}</span></div></div>`:`<p class="compact-empty">${esc(t('noProgressEvents'))}</p>`;
  return `<section class="list-panel progress-panel" aria-labelledby="progress-title"><header class="section-header"><h2 id="progress-title">${esc(t('optimizationProgress'))}</h2><div class="progress-controls"><div class="filter-group">${[7,30,90].map(days=>`<button class="filter-chip ${state.progressDays===days?'selected':''}" data-progress-days="${days}" aria-pressed="${state.progressDays===days}">${esc(t('lastDays',{days}))}</button>`).join('')}</div><div class="filter-group bucket-controls">${[['day','byDay'],['week','byWeek']].map(([unit,key])=>`<button class="filter-chip ${state.progressBucket===unit?'selected':''}" data-progress-bucket="${unit}" aria-pressed="${state.progressBucket===unit}">${esc(t(key))}</button>`).join('')}</div></div></header><div class="progress-totals">${series.map(([kind,key])=>`<span><i class="series-dot ${kind}"></i>${esc(t(key))}<strong data-progress-${kind}>${totals[kind]}</strong></span>`).join('')}<small>${esc(range)}</small></div>${graph}<div class="progress-footnote">${esc(t('progressNote'))}</div>${hasEvents?`<details class="progress-breakdown" data-preserve="progress"><summary>${esc(t('progressBreakdown'))}</summary><div><table><thead><tr><th>${esc(t('period'))}</th>${series.map(([,key])=>`<th>${esc(t(key))}</th>`).join('')}</tr></thead><tbody>${buckets.map(bucket=>`<tr><th scope="row">${esc(progressBucketLabel(bucket))}</th>${series.map(([kind])=>`<td>${bucket[kind]}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`:''}</section>`;
}

function globalOverview(){
  const tasks=taskItems(),issues=scopedItems('issues'),runs=scopedItems('runs');
  return `${pageHeading(t('workbench'))}<div class="summary-bar"><span><strong data-count-key="skills">${visibleSkills().length}</strong> ${esc(t('skills'))}</span><span><strong>${runs.filter(run=>run.status==='running').length}</strong> ${esc(t('activeTasks'))}</span><span><strong>${issues.filter(issue=>issue.status==='open').length}</strong> ${esc(t('openIssues'))}</span><button data-task-filter="review"><strong data-count-key="approvals">${tasks.filter(task=>task.kind==='review').length}</strong> ${esc(t('needsApproval'))}</button><button data-task-filter="failed"><strong>${tasks.filter(task=>task.kind==='failed').length}</strong> ${esc(t('failedTasks'))}</button></div>${runtimeStrip()}<div class="overview-primary">${taskPanel()}${progressPanel()}</div><div class="workbench-columns">${activityPanel()}${skillOverview()}</div>`;
}
function workspacePage(){
  const skill=currentSkill();if(!skill)return `${pageHeading(t('repositoryWorkspace'))}<p>${esc(t('scopeUnavailable'))}</p><button class="text-button" data-go-home>${esc(t('allSkills'))}</button>`;
  const issues=scopedItems('issues'),prs=scopedItems('prs'),runs=scopedItems('runs'),open=issues.filter(issue=>issue.status==='open');
  const orderedPrs=[...prs].sort((a,b)=>Number(b.decision_state==='awaiting_approval')-Number(a.decision_state==='awaiting_approval')||String(b.updated_at||'').localeCompare(String(a.updated_at||'')));
  return `${pageHeading(skill.name,`<button class="secondary-button" data-open-skill="${esc(skill.id)}">${svg('repo')}${esc(t('openCode'))}</button>`)}
    ${isHidden(skill.id)?`<div class="notice">${esc(t('hiddenNotice'))}</div>`:''}
    <div class="repository-context"><span>${esc(t('source'))}: ${esc(sourceName(skill.source))}</span><span>${svg('repo')}${esc(t('defaultBranch'))}: <strong>${esc(skill.default_branch||'—')}</strong></span><button class="quiet-button" data-hide-skill="${esc(skill.id)}">${esc(t(isHidden(skill.id)?'restoreToOverview':'hideFromOverview'))}</button></div>
    <div class="workspace-links"><button data-view-link="issues">${issueIcon('open')}<strong>${open.length}</strong> ${esc(t('openIssues'))}</button><button data-view-link="prs">${prIcon('open')}<strong>${prs.length}</strong> ${esc(t('pullRequests'))}</button><button data-view-link="wiki">${svg('book')}<strong>${scopedItems('wiki').length}</strong> ${esc(t('wiki'))}</button><span>${runs.filter(run=>run.status==='completed').length} ${esc(t('completedRuns'))}</span></div>
    ${runtimeStrip(true)}${progressPanel()}
    <div class="workspace-columns"><section class="list-panel"><header class="section-header"><h2>${esc(t('currentIssues'))}<span class="section-count">${open.length}</span></h2><button class="text-button" data-view-link="issues">${esc(t('viewAll'))}</button></header>${open.length?open.slice(0,5).map(issue=>`<button class="workspace-issue" data-run-skill="${esc(skill.id)}" data-run-issue="${issue.number}"><span><strong>#${issue.number} ${esc(issue.title)}</strong><small>${esc(t('testsAndRepair'))}</small></span>${stageBadge(issue.stage)}</button>`).join(''):`<p class="compact-empty">${esc(t('noCurrentIssues'))}</p>`}</section>
    <section class="list-panel"><header class="section-header"><h2>${esc(t('pullRequests'))}<span class="section-count">${prs.length}</span></h2><button class="text-button" data-view-link="prs">${esc(t('viewAll'))}</button></header>${orderedPrs.length?orderedPrs.slice(0,5).map(pr=>`<button class="workspace-issue" data-approval-skill="${esc(skill.id)}" data-approval-number="${pr.number}"><span><strong>#${pr.number} ${esc(prTitle(pr))}</strong><small>${esc(pr.head)} → ${esc(pr.base)}</small></span>${pr.decision_state==='awaiting_approval'?stageBadge('review'):statusPill(pr.status,'pr')}</button>`).join(''):`<p class="compact-empty">${esc(t('noPr'))}</p>`}</section></div>${activityPanel(runs)}`;
}
function statusPage(){return state.skillId?workspacePage():globalOverview()}

function metrics(item){return `<div class="repo-metrics"><button data-view-link="issues">${issueIcon('open')}<strong>${item.issue_count}</strong><span>${esc(t('issues'))}</span></button><button data-view-link="prs">${prIcon('open')}<strong>${item.pr_count}</strong><span>${esc(t('pullRequests'))}</span></button><button data-view-link="wiki">${svg('book')}<strong>${item.wiki_count}</strong><span>${esc(t('wiki'))}</span></button><span>${svg('issueClosed','issue-closed')}<strong>${item.completed_run_count}</strong><small>${esc(t('repairs'))}</small></span></div>`}
function backButton(){return `<button class="back-link" data-action="back">← ${esc(state.view==='skills'?t('backWorkspace'):t('backTo',{view:t({issues:'issues',prs:'pullRequests',wiki:'wiki'}[state.view])}))}</button>`}
function skillDetail(item){const document=item.document;const body=document?.truncated?`<p>${esc(t('documentTooLarge'))}</p>`:document?renderMarkdown(document.content):`<p>${esc(t('noRepositoryDocument'))}</p>`;return `${backButton()}<section class="repo-overview"><div class="repo-box-head">${svg('repo')}<strong>${esc(item.name)}</strong><span>${esc(item.default_branch)}</span></div>${metrics(item)}<div class="readme-box"><div class="readme-head">${svg('book')}<strong>${esc(document?.name||'README.md')}</strong></div><section class="markdown-body">${body}</section></div></section>`}
function evaluationGateSection(gates){if(!gates?.length)return '';return `<section class="detail-section"><h2>${esc(t('evaluationGates'))}</h2><div class="evaluation-gates">${gates.map(gate=>`<div class="evaluation-gate"><span class="run-state ${esc(gate.status)}">${gate.status==='passing'?issueIcon('closed'):issueIcon('open')}</span><div><strong>${esc(gate.split)}</strong><small>${esc(t('baseline'))}: ${gate.baseline_score} (${gate.baseline_passed}/${gate.baseline_total}) → ${esc(t('candidate'))}: ${gate.candidate_score??esc(t('notEvaluated'))}${gate.candidate_score==null?'':` (${gate.candidate_passed}/${gate.candidate_total})`}</small></div><em>${esc(t(gate.status))}</em></div>`).join('')}</div></section>`}
function issueDetail(item){const merged=item.pull_requests.find(pr=>pr.status==='merged'),resolution=item.status==='closed'&&merged?`<section class="resolution-banner">${svg('issueClosed')}<div><strong>${esc(t('resolvedHistory'))}</strong><p>${esc(t('historicalRuns'))}</p></div><button class="text-button" data-go-pr="${merged.number}">${esc(t('viewRepair'))} #${merged.number}</button></section>`:'';const hasGates=Boolean(item.evaluation_gates?.length);const tests=item.tests?.length?item.tests.map(test=>`<div class="linked-record issue-test"><span class="run-state ${esc(test.status)}">${test.status==='passing'?issueIcon('closed'):issueIcon('open')}</span><span><strong>${esc(test.path)}</strong><small><code>${esc(test.command)}</code></small></span><em>${esc(t(test.status))}</em></div>`).join(''):`<p class="body-copy">${esc(t('noTests'))}</p>`;const testSection=item.tests?.length||!hasGates?`<section class="detail-section"><h2>${esc(t('reproductionTests'))}</h2>${tests}</section>`:'';return `${backButton()}<header class="record-title"><h1>${esc(item.title)} <span>#${item.number}</span></h1><div class="record-state">${statusPill(item.status,'issue')}${stageBadge(item.stage)}<p>${esc(t('opened',{date:nice(item.created_at)}))}</p></div></header><div class="conversation"><aside>${svg('issue',item.status==='closed'?'issue-closed':'issue-open')}</aside><article class="comment"><header><strong>${esc(t('evidence'))}</strong><span>${esc(nice(item.created_at))}</span></header><div><p class="body-copy">${esc(item.body)||esc(t('noDescription'))}</p></div></article></div>${testSection}${evaluationGateSection(item.evaluation_gates)}${resolution}<section class="detail-section"><h2>${esc(t('trajectory'))}</h2>${runTimeline(item.runs)}</section><section class="detail-section"><h2>${esc(t('linkedPrs'))}</h2>${item.pull_requests.length?item.pull_requests.map(pr=>`<button class="linked-record" data-go-pr="${pr.number}">${prIcon(pr.status)}<span><strong>#${pr.number} ${esc(prTitle(pr))}</strong><small>${esc(pr.head)} → ${esc(pr.base)}</small></span><em>${esc(statusText(pr.status))}</em></button>`).join(''):`<p class="body-copy">${esc(t('noPr'))}</p>`}</section>`}
function approvalPanel(item){
  if(item.decision_state==='merged'||item.status==='merged')return `<section class="approval-panel merged">${prIcon('merged')}<div><strong>${esc(t('mergedWithApproval'))}</strong><p>${esc(t('localOnly'))}</p></div></section>`;
  if(item.status!=='open')return '';
  return `<section class="approval-panel">${prIcon('open')}<div><strong>${esc(t('mergeApproval'))}</strong><p>${esc(t('mergeApprovalBody'))}</p><small>${esc(t('localOnly'))}</small></div><button class="merge-button" type="button" data-merge-pr>${esc(t('reviewAndMerge'))}</button></section>`
}
function syncPanel(sync){if(!sync)return '';if(sync.state==='takeover_active')return `<section class="approval-panel merged">${issueIcon('closed')}<div><strong>${esc(t('takeoverComplete'))}</strong><p>${esc(t('takeoverCompleteBody'))}</p></div></section>`;if(sync.state==='in_sync')return `<section class="approval-panel merged">${issueIcon('closed')}<div><strong>${esc(t('syncComplete'))}</strong><p>${esc(t('syncCompleteBody'))}</p></div></section>`;if(sync.state==='ready_to_sync')return `<section class="approval-panel">${svg('repo')}<div><strong>${esc(t('syncRequired'))}</strong><p>${esc(t('syncRequiredBody'))}</p></div><button class="merge-button" type="button" data-sync-skill>${esc(t('syncNow'))}</button></section>`;return `<section class="approval-panel">${svg('repo')}<div><strong>${esc(t('syncBlocked'))}</strong><p>${esc(t('syncBlockedBody'))}</p></div></section>`}
function diffLines(patch){if(!patch)return `<div class="diff-empty">${esc(t('noDiff'))}</div>`;return String(patch).split('\n').map(line=>{const kind=line.startsWith('@@')?'hunk':line.startsWith('+')&&!line.startsWith('+++')?'addition':line.startsWith('-')&&!line.startsWith('---')?'deletion':/^(diff --git|index |--- |\+\+\+ )/.test(line)?'meta':'context';const content=['addition','deletion','context'].includes(kind)?line.slice(1):line;return `<div class="diff-line ${kind}"><span>${kind==='addition'?'+':kind==='deletion'?'−':' '}</span><code>${esc(content)||' '}</code></div>`}).join('')}
function prDetail(item){const tabs=['conversation','commits','checks','files'];const selected=tabs.includes(state.prTab)?state.prTab:'conversation';const files=item.files?.map(file=>`<article class="file-diff"><header><b>${esc(file.status)}</b><strong>${esc(file.path)}</strong></header><div class="diff-code">${diffLines(file.patch)}</div>${file.patch_truncated?`<p class="diff-warning">${esc(t('documentTooLarge'))}</p>`:''}</article>`).join('')||`<p class="body-copy">${esc(t('noFiles'))}</p>`;const commits=item.commits?.map(commit=>`<div class="commit"><strong>${esc(commit.subject)}</strong><span>${esc(commit.short_sha)} · ${nice(commit.authored_at)}</span></div>`).join('')||`<p class="body-copy">${esc(t('noCommits'))}</p>`;const description=item.body?renderMarkdown(item.body):`<p>${esc(t('noPrDescription'))}</p>`;const tab=(id,label,count=null,icon='')=>`<button type="button" role="tab" data-pr-tab="${id}" aria-selected="${selected===id}" aria-controls="pr-panel-${id}" class="${selected===id?'active':''}">${icon}${esc(label)}${count===null?'':` <b>${count}</b>`}</button>`;const panel=(id,content)=>`<div id="pr-panel-${id}" class="pr-tab-panel" role="tabpanel" data-pr-panel="${id}"${selected===id?'':' hidden'}>${content}</div>`;const conversation=panel('conversation',`<section class="detail-section pr-description"><h2>${esc(t('prDescription'))}</h2><article class="markdown-body">${description}</article></section>${item.issue?`<section class="detail-section"><h2>${esc(t('closesIssue'))}</h2><button class="linked-record" data-go-issue="${item.issue.number}">${issueIcon(item.issue.status)}<span><strong>#${item.issue.number} ${esc(item.issue.title)}</strong></span><em>${esc(statusText(item.issue.status))}</em></button></section>`:''}`);const commitPanel=panel('commits',`<section class="detail-section"><h2>${esc(t('commits'))}</h2>${commits}</section>`);const checks=panel('checks',`<section class="detail-section"><h2>${esc(t('trajectory'))}</h2>${runTimeline(item.runs)}</section>`);const changed=panel('files',`<section class="detail-section"><h2>${esc(t('changedFiles'))}</h2><p class="diff-stat">${esc(item.diff_stat)||esc(t('noDiff'))}</p><div class="file-diffs">${files}</div></section>`);return `${backButton()}<header class="record-title"><h1>${esc(prTitle(item))} <span>#${item.number}</span></h1><div class="record-state">${statusPill(item.status,'pr')}<p>${esc(t('opened',{date:nice(item.created_at)}))} · ${esc(item.head)} → ${esc(item.base)}</p></div></header>${approvalPanel(item)}${item.status==='merged'?syncPanel(item.sync):''}<nav class="pr-subnav" role="tablist" aria-label="${esc(t('pullRequests'))}">${tab('conversation',t('conversation'),null,svg('issue'))}${tab('commits',t('commits'),item.commits?.length||0)}${tab('checks',t('checks'),item.runs?.length||0)}${tab('files',t('filesChanged'),item.files?.length||0)}</nav>${conversation}${commitPanel}${checks}${changed}`}
function wikiDetail(item){const links=[item.issue_number?`${t('issue')} #${item.issue_number}`:'',item.pr_number?`${t('pr')} #${item.pr_number}`:''].filter(Boolean).join(' · ');return `${backButton()}<header class="record-title wiki-title"><h1>${svg('book')}${esc(item.title)}</h1><div class="record-state"><p>${esc(t('updatedAt',{time:nice(item.updated_at)}))}${links?` · ${esc(links)}`:''}</p></div></header><article class="wiki-document"><header>${svg('book')}<strong>${esc(item.slug)}</strong></header><div><h2>${esc(t('workRecord'))}</h2><p class="wiki-body">${esc(item.body)||esc(t('noNotes'))}</p></div></article>`}
function detailPage(){return state.detailType==='skills'?skillDetail(state.detail):state.detailType==='issues'?issueDetail(state.detail):state.detailType==='prs'?prDetail(state.detail):wikiDetail(state.detail)}

function renderContent(){
  const content=$('content');
  const focused=content.contains(document.activeElement)?document.activeElement:null;
  const focusId=focused?.id,selection=focused instanceof HTMLInputElement?[focused.selectionStart,focused.selectionEnd]:null;
  const opened=new Set([...content.querySelectorAll('details[open]')].map(node=>node.dataset.skillEntry||node.dataset.preserve));
  content.innerHTML=state.navigationLoading?`<p class="loading-message" role="status">${esc(t('loadingRecord'))}</p>`:state.navigationError?`<section class="navigation-error" role="alert"><h1>${esc(t('navigationFailed'))}</h1><p>${esc(state.navigationError)}</p><div><button class="secondary-button" data-retry-navigation>${esc(t('retry'))}</button><button class="text-button" data-workspace-skill="${esc(state.skillId)}">${esc(t('backWorkspace'))}</button><button class="text-button" data-go-home>${esc(t('allSkills'))}</button></div></section>`:state.view==='status'?statusPage():state.detail?detailPage():listPage();
  if(state.navigationLoading)content.setAttribute('aria-busy','true');else content.removeAttribute('aria-busy');
  content.querySelectorAll('details').forEach(node=>{node.open=opened.has(node.dataset.skillEntry||node.dataset.preserve)});
  wireContent();
  if(focusId&&$(focusId)){$(focusId).focus({preventScroll:true});if(selection)$(focusId).setSelectionRange(...selection)}
}
function resetFilters(){state.query='';state.skillQuery='';state.skillFilter='all';state.skillLimit=20;state.activityExpanded=false;state.taskFilter='all';state.approvalOnly=false;state.showHidden=false}
function setScope(skillId){if(state.skillId!==skillId)resetFilters();state.skillId=skillId}
function setHiddenSkill(skillId){
  state.hiddenSkills=isHidden(skillId)?state.hiddenSkills.filter(id=>id!==skillId):[...state.hiddenSkills,skillId];
  try{localStorage.setItem('skillhone.hiddenSkills',JSON.stringify(state.hiddenSkills))}catch{/* Keep the current session usable if browser storage is unavailable. */}
  updateChrome();renderContent();
}
function reviewSkill(skillId){navigationVersion++;clearNavigation();setScope(skillId);state.approvalOnly=true;state.view='prs';state.detail=null;state.detailType=null;state.query='';changeHash(skillId?`prs/${encodeURIComponent(skillId)}?approval`:'prs?approval');updateChrome();renderContent()}
function clearFilters(){resetFilters();updateChrome();renderContent()}
function wireContent(){
  $('search')?.addEventListener('input',event=>{state.query=event.target.value;renderContent()});
  $('skill-search')?.addEventListener('input',event=>{state.skillQuery=event.target.value;state.skillLimit=20;renderContent()});
  document.querySelectorAll('[data-skill-filter]').forEach(button=>button.addEventListener('click',()=>{state.skillFilter=button.dataset.skillFilter;state.skillLimit=20;renderContent()}));
  document.querySelectorAll('[data-task-filter]').forEach(button=>button.addEventListener('click',()=>{state.taskFilter=button.dataset.taskFilter;renderContent()}));
  document.querySelectorAll('[data-progress-days]').forEach(button=>button.addEventListener('click',()=>{state.progressDays=Number(button.dataset.progressDays);state.progressBucket=state.progressDays===90?'week':'day';renderContent()}));
  document.querySelectorAll('[data-progress-bucket]').forEach(button=>button.addEventListener('click',()=>{state.progressBucket=button.dataset.progressBucket;renderContent()}));
  document.querySelector('[data-retry-navigation]')?.addEventListener('click',()=>{const target=state.navigationTarget;if(target)openDetail(target.skillId,target.view,target.reference)});
  document.querySelector('[data-show-more-skills]')?.addEventListener('click',()=>{state.skillLimit+=20;renderContent()});
  document.querySelector('[data-collapse-skills]')?.addEventListener('click',()=>{state.skillLimit=20;renderContent()});
  document.querySelector('[data-toggle-activity]')?.addEventListener('click',()=>{state.activityExpanded=!state.activityExpanded;renderContent()});
  document.querySelectorAll('[data-clear-filters],[data-clear-skill-filters]').forEach(button=>button.addEventListener('click',clearFilters));
  document.querySelector('[data-toggle-hidden]')?.addEventListener('click',()=>{state.showHidden=!state.showHidden;state.skillQuery='';state.skillFilter='all';state.skillLimit=20;renderContent()});
  document.querySelectorAll('[data-hide-skill]').forEach(button=>button.addEventListener('click',()=>setHiddenSkill(button.dataset.hideSkill)));
  document.querySelectorAll('[data-workspace-skill]').forEach(button=>button.addEventListener('click',()=>openWorkspace(button.dataset.workspaceSkill)));
  document.querySelectorAll('[data-go-home]').forEach(button=>button.addEventListener('click',goHome));
  document.querySelectorAll('[data-open-skill]').forEach(button=>button.addEventListener('click',()=>openRepo(button.dataset.openSkill)));
  document.querySelectorAll('[data-review-skill]').forEach(button=>button.addEventListener('click',()=>reviewSkill(button.dataset.reviewSkill)));
  document.querySelector('[data-toggle-approvals]')?.addEventListener('click',()=>{state.approvalOnly=!state.approvalOnly;changeHash(`prs${state.skillId?`/${encodeURIComponent(state.skillId)}`:''}${state.approvalOnly?'?approval':''}`);renderContent()});
  document.querySelectorAll('.item[data-id]').forEach(button=>button.addEventListener('click',()=>openRecord(button.dataset.id,button.dataset.slug??Number(button.dataset.number))));
  document.querySelector('[data-action="back"]')?.addEventListener('click',()=>{state.detail=null;state.detailType=null;if(state.view==='skills'){openWorkspace(state.skillId);return}changeHash(`${state.view}${state.skillId?`/${encodeURIComponent(state.skillId)}`:''}${state.view==='prs'&&state.approvalOnly?'?approval':''}`);updateChrome();renderContent()});
  document.querySelectorAll('[data-view-link],[data-status-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.viewLink||button.dataset.statusView)));
  document.querySelectorAll('[data-run-skill]').forEach(button=>button.addEventListener('click',()=>openRecord(button.dataset.runSkill,Number(button.dataset.runIssue),'issues')));
  document.querySelectorAll('[data-approval-skill]').forEach(button=>button.addEventListener('click',()=>openRecord(button.dataset.approvalSkill,Number(button.dataset.approvalNumber),'prs')));
  document.querySelectorAll('[data-pr-tab]').forEach(button=>button.addEventListener('click',()=>{state.prTab=button.dataset.prTab;renderContent();document.querySelector(`[data-pr-tab="${state.prTab}"]`)?.focus({preventScroll:true})}));
  document.querySelector('[data-merge-pr]')?.addEventListener('click',()=>openMergeDialog(state.detail));
  document.querySelector('[data-sync-skill]')?.addEventListener('click',()=>openSyncDialog(state.detail));
  document.querySelectorAll('[data-go-issue]').forEach(button=>button.addEventListener('click',()=>openRecord(state.skillId,Number(button.dataset.goIssue),'issues')));
  document.querySelectorAll('[data-go-pr]').forEach(button=>button.addEventListener('click',()=>openRecord(state.skillId,Number(button.dataset.goPr),'prs')));
}
function updateChrome(){
  const skill=currentSkill();
  $('repo-name').textContent=skill?.name||t('allSkills');
  $('scope-back').hidden=!state.skillId;
  $('skills-tab-label').textContent=state.skillId?t('code'):t('skills');
  $('project').textContent=state.skillId?'':t('localRepos',{count:visibleSkills().length});
  $('skill-count').textContent=visibleSkills().length;$('skill-count').hidden=Boolean(state.skillId);
  $('issue-count').textContent=scopedItems('issues').length;$('pr-count').textContent=scopedItems('prs').length;$('wiki-count').textContent=scopedItems('wiki').length;
  const approvals=scopedItems('prs').filter(item=>item.decision_state==='awaiting_approval').length;
  $('pr-count').classList.toggle('pending-counter',approvals>0);$('pr-count').title=t('approvalCount',{count:approvals});
  document.querySelectorAll('.tab').forEach(element=>{const active=element.dataset.view===state.view;element.classList.toggle('active',active);if(active)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current')});
}
let ignoredHash=null,navigationVersion=0;
function changeHash(hash){if(location.hash.slice(1)!==hash){ignoredHash=hash;location.hash=hash}}
function detailApiPath(){const skillId=state.skillId;if(!skillId||!state.detailType)return null;if(state.detailType==='skills')return `/api/skills/${encodeURIComponent(skillId)}`;const segment=state.detailType==='issues'?'issues':state.detailType==='prs'?'pull-requests':'wiki';const reference=state.detailType==='wiki'?state.detail?.slug:state.detail?.number;if(reference==null)return null;return `/api/skills/${encodeURIComponent(skillId)}/${segment}/${encodeURIComponent(reference)}`}
function clearNavigation(){state.navigationLoading=false;state.navigationError=null;state.navigationTarget=null}
function openWorkspace(skillId){navigationVersion++;clearNavigation();setScope(skillId);resetFilters();state.view='status';state.detail=null;state.detailType=null;changeHash(`status/${encodeURIComponent(skillId)}`);updateChrome();renderContent()}
async function openDetail(skillId,view,reference=null){
  const version=++navigationVersion;setScope(skillId);state.view=view;state.query='';if(view==='prs')state.prTab='conversation';
  state.detail=null;state.detailType=null;state.navigationLoading=true;state.navigationError=null;state.navigationTarget={skillId,view,reference};
  const segment=view==='issues'?'issues':view==='prs'?'pull-requests':'wiki';
  const path=view==='skills'?`/api/skills/${encodeURIComponent(skillId)}`:`/api/skills/${encodeURIComponent(skillId)}/${segment}/${encodeURIComponent(reference)}`;
  changeHash(view==='skills'?`repo/${encodeURIComponent(skillId)}`:`${view==='issues'?'issue':view==='prs'?'pr':'wiki'}/${encodeURIComponent(skillId)}/${encodeURIComponent(reference)}`);
  updateChrome();renderContent();
  try{
    const detail=await api(path);if(version!==navigationVersion)return;
    state.detail=detail;state.detailType=view;state.navigationTarget=null;
  }catch(error){if(version===navigationVersion)state.navigationError=error instanceof Error?error.message:String(error)}
  finally{if(version===navigationVersion){state.navigationLoading=false;updateChrome();renderContent()}}
}
async function openRepo(skillId){return openDetail(skillId,'skills')}
async function openRecord(skillId,reference,forcedView=null){return openDetail(skillId,forcedView||state.view,reference)}

async function refreshDetail(){
  const path=detailApiPath();if(!path)return;
  const token=`${state.detailType}/${state.skillId}/${state.detailType==='wiki'?state.detail?.slug:state.detail?.number}`,version=navigationVersion;
  const detail=await api(path);
  if(version===navigationVersion&&token===`${state.detailType}/${state.skillId}/${state.detailType==='wiki'?state.detail?.slug:state.detail?.number}`){state.detail=detail;renderContent()}
}
function switchView(view){navigationVersion++;clearNavigation();resetFilters();state.view=view;state.detail=null;state.detailType=null;if(view==='skills'&&state.skillId){openRepo(state.skillId);return}changeHash(state.skillId?`${view}/${encodeURIComponent(state.skillId)}`:view);updateChrome();renderContent()}
function goHome(){navigationVersion++;clearNavigation();setScope(null);resetFilters();state.view='status';state.detail=null;state.detailType=null;changeHash('status');updateChrome();renderContent()}
function updateIndicator(failed=state.updateFailed){state.updateFailed=failed;const indicator=$('update-state');if(!indicator)return;indicator.classList.toggle('stale',failed);if(failed)indicator.textContent=t('refreshFailed');else indicator.innerHTML=`<i></i>${esc(t('liveUpdates'))}`}
function applyLocale(locale){state.locale=locale;localStorage.setItem('skillhone.locale',locale);document.documentElement.lang=locale==='zh'?'zh-CN':'en';document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n)});document.querySelectorAll('[data-locale]').forEach(button=>button.classList.toggle('active',button.dataset.locale===locale));updateChrome();renderContent();updateIndicator()}
let loading=false,lastSnapshot='';
async function load(){
  if(loading)return;loading=true;
  try{
    const data=await api('/api/dashboard'),snapshot=JSON.stringify(data);state.lastUpdated=new Date();
    if(snapshot!==lastSnapshot){
      state.items={skills:data.skills,issues:data.issues,prs:data.pull_requests,wiki:data.wiki??[],runs:data.runs??[]};
      state.harness=data.harness??state.harness;state.executor=data.executor??state.executor;state.audit=data.audit??state.audit;state.automation=data.automation??state.automation;
      state.mergePolicy=data.merge_policy??state.mergePolicy;state.notifications=data.notifications??state.notifications;
      lastSnapshot=snapshot;updateChrome();renderContent();
    }
    // Detail APIs include tests, diffs, and documents that are absent from the
    // dashboard snapshot. Poll them independently and let this catch own errors.
    if(state.detail)await refreshDetail();
    updateIndicator(false);
  }catch(error){
    updateIndicator(true);
    if(!lastSnapshot)throw error;
  }finally{loading=false;if(!state.navigationLoading)$('content').removeAttribute('aria-busy')}
}

let pendingMerge=null;
function openMergeDialog(item){const copyMode=Boolean(item.sync?.origins?.some(origin=>origin.mode==='copy'));pendingMerge={skillId:String(item.skill.id),number:Number(item.number),copyMode};$('merge-pr-name').textContent=`${item.skill.name} · #${item.number} ${prTitle(item)}`;$('merge-dialog-body').textContent=t(copyMode?'mergeAndSyncBody':'confirmMergeBody');$('merge-confirm').textContent=t(copyMode?'mergeAndSync':'mergeLocally');$('merge-error').hidden=true;$('merge-error').textContent='';$('merge-confirm').disabled=false;$('merge-dialog').showModal()}
async function confirmMerge(){if(!pendingMerge)return;const target={...pendingMerge},button=$('merge-confirm');button.disabled=true;$('merge-error').hidden=true;try{const headers={'X-SkillHone-Confirm':'merge'};if(target.copyMode)headers['X-SkillHone-Sync']='apply';await api(`/api/skills/${encodeURIComponent(target.skillId)}/pull-requests/${target.number}/merge`,{method:'POST',headers});$('merge-dialog').close();await load();await openRecord(target.skillId,target.number,'prs')}catch(error){$('merge-error').textContent=error instanceof Error?error.message:t('mergeFailed');$('merge-error').hidden=false;button.disabled=false}}
let pendingSync=null;
function openSyncDialog(item){pendingSync={skillId:String(item.skill.id),number:Number(item.number)};$('sync-skill-name').textContent=item.skill.name;$('sync-error').hidden=true;$('sync-error').textContent='';$('sync-confirm').disabled=false;$('sync-dialog').showModal()}
async function confirmSync(){if(!pendingSync)return;const target={...pendingSync},button=$('sync-confirm');button.disabled=true;$('sync-error').hidden=true;try{await api(`/api/skills/${encodeURIComponent(target.skillId)}/sync`,{method:'POST',headers:{'X-SkillHone-Confirm':'sync'}});$('sync-dialog').close();await load();await openRecord(target.skillId,target.number,'prs')}catch(error){$('sync-error').textContent=error instanceof Error?error.message:t('syncFailed');$('sync-error').hidden=false;button.disabled=false}}

async function restoreHash(){
  navigationVersion++;clearNavigation();state.detail=null;state.detailType=null;resetFilters();
  const hash=location.hash.replace(/^#/,''),parts=hash.split('?')[0].split('/');
  setScope(parts[1]?decodeURIComponent(parts[1]):null);state.approvalOnly=hash.endsWith('?approval');
  if(parts[0]==='repo'&&state.skillId)return openRepo(state.skillId);
  if(['issue','pr','wiki'].includes(parts[0])&&state.skillId&&parts[2])return openRecord(state.skillId,decodeURIComponent(parts[2]),{issue:'issues',pr:'prs',wiki:'wiki'}[parts[0]]);
  if(['status','skills','issues','prs','wiki'].includes(parts[0])){state.view=parts[0];if(state.view==='skills'&&state.skillId)return openRepo(state.skillId);updateChrome();renderContent();return}
  goHome();
}

document.querySelectorAll('.icon-slot').forEach(slot=>{slot.innerHTML=svg(slot.dataset.icon)});
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>switchView(tab.dataset.view)));
document.querySelectorAll('[data-locale]').forEach(button=>button.addEventListener('click',()=>applyLocale(button.dataset.locale)));
$('home-link').addEventListener('click',event=>{event.preventDefault();goHome()});
$('scope-back').addEventListener('click',goHome);
$('merge-close').addEventListener('click',()=>$('merge-dialog').close());
$('merge-cancel').addEventListener('click',()=>$('merge-dialog').close());
$('merge-confirm').addEventListener('click',confirmMerge);
$('merge-dialog').addEventListener('close',()=>{pendingMerge=null;$('merge-confirm').disabled=false;$('merge-error').hidden=true});
$('sync-close').addEventListener('click',()=>$('sync-dialog').close());
$('sync-cancel').addEventListener('click',()=>$('sync-dialog').close());
$('sync-confirm').addEventListener('click',confirmSync);
$('sync-dialog').addEventListener('close',()=>{pendingSync=null;$('sync-confirm').disabled=false;$('sync-error').hidden=true});
document.querySelectorAll('[data-locale]').forEach(button=>button.classList.toggle('active',button.dataset.locale===state.locale));
document.documentElement.lang=state.locale==='zh'?'zh-CN':'en';
document.querySelectorAll('[data-i18n]').forEach(element=>{element.textContent=t(element.dataset.i18n)});
load().then(restoreHash).catch(error=>{$('content').innerHTML=`<div class="empty"><h2>${esc(error.message)}</h2></div>`});
window.addEventListener('hashchange',()=>{if(location.hash.slice(1)===ignoredHash){ignoredHash=null;return}restoreHash().catch(error=>{$('content').innerHTML=`<div class="empty"><h2>${esc(error.message)}</h2></div>`})});
setInterval(()=>load().catch(()=>{}),5000);
