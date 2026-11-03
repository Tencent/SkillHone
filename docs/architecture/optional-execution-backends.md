# SkillHone 可选执行后端设计与实现

日期：2026-11-02。本设计用于普通工程维护；不是论文比较验证过的架构，也不把工程回归当作技能能力评测。

## 实现的选择

SkillHone 保留登记、Issue、Run、测试、PR、合入、回源和历史。执行修复代码的 Agent 可以选择当前会话或 DSH。

| 参数 | 行为 | 安装要求 |
|---|---|---|
| `--executor native` | 返回当前 Agent 的修复 assignment；提交后由宿主独立验收 | 不需要 DSH |
| `--executor dsh` | 使用已配置的 DSH 执行候选修复，共享验收流程 | 显式安装并配置 DSH |
| `--executor auto` | 保守选择 native；Agent 可按任务显式请求 dsh | 不自动安装或更换模型 |

参数是入口；完整实现还包括两阶段任务状态、提交绑定、错误处理和前端展示。CLI 不具备读取当前 Agent 工具列表并调用它的能力，所以 `auto` 不假装做模型智能路由。当前 Agent 根据任务判断后，显式选择合适执行器。

新 home 默认 `auto`。已有设置缺少 executor 字段时保留原 DSH 行为，避免升级偷偷改变执行方式。迁移时应分别检查 executor 和 trigger 设置，并按所需执行方式显式配置。

## 命令与状态

```sh
skillhone config set --executor auto
skillhone config set --trigger immediate
skillhone --skill example optimize 12 --executor native
skillhone --skill example execution complete RUN_ID --commit EXACT_COMMIT_SHA
skillhone --skill example execution fail RUN_ID --reason 'diagnostic'
skillhone --skill example execution cancel RUN_ID --reason 'cancelled'
skillhone --skill example retry 12 --executor dsh
```

`optimize` 和新 Issue 的 immediate 路径都返回结构化 assignment。native Run 记为 `awaiting_agent`，不会冒充后台运行。当前 Agent 在指定分支编辑和提交，再调用 complete。当前命令退出后没有存活的自动调度器；关闭 Agent 会话不会自动继续编程。持续无人值守需要后续 runtime bridge 或实际运行的 DSH dispatcher。

每仓库拒绝第二个运行中或等待中的 assignment。失败与取消保留旧 Run 和分支，retry 创建新尝试。后端切换不重跑历史问题，不改模型、账号、provider 或 DSH 安装。

## 宿主验收

创建任务时记录 base SHA、分支、Issue、测试路径/命令/文件摘要，manifest 摘要写入审计 Wiki。完成时要求：

1. assignment 尚在等待，Issue 仍打开；不能重放已结束的 Run。
2. 精确候选 SHA 与当前 HEAD、指定分支一致，候选基于冻结 base，默认分支没有漂移。
3. 工作区干净、确有新提交，既定测试契约及测试文件未被替换。
4. 同 Issue 没有另一条打开的 PR，避免公共测试入口误选其他分支。
5. 宿主独立运行关联测试，并再次检查候选和契约；随后生成 PR，按当前保存的 merge 策略处理。

执行超时优先于子进程 exit code：即使子进程处理 SIGTERM 后退出 0，也记失败。修复运行、关联回归与 benchmark runner 使用同一错误优先规则。验收不推送业务仓库；安全回源和共享分发继续各自流程。

## 隔离边界

native attached 标记 `trusted-host-session`。同权限当前会话可接触宿主数据，这不是 OS 权限隔离；CLI 两次调用之间也没有持续 SQLite 写锁。DSH 执行期间现有宿主保护标记 `host-locked`，但这本身不证明隐藏答案无法被读取。

目前两种后端都不宣称具备隐藏评测隔离。`--hidden-eval` 明确拒绝；native benchmark optimization 明确不支持，不暗中调用 DSH。普通工程修复可以使用当前已知上下文；需要隐藏答案的能力评测，必须创建实际权限受限的新角色并验证可读范围。只换角色提示或 fork none 不恢复隔离。

后续独立能力：原生 runtime bridge、真实受限评测角色及沙箱权限、长期任务控制器。它们不在本轮普通工程执行器切换中冒充已实现。

## 前端与统计

全局工作台汇总跨技能工作队列，技能工作区仅展示自己的问题、PR、测试和历史。执行器可用状态与实际 Run 状态分开：native 可用不等于自动执行；等待 Agent、DSH 运行中、失败和完成分别显示。

近 7/30/90 天、按日/周展示优化进展，完成/失败按真实结束时间计数，合入单独计数。重复尝试保留但按 Issue 归组，不能把启动数量当作成果。DSH 未安装只影响 DSH 后端，不使整个平台不可用。

## 验证范围

离线端到端回归覆盖未安装 DSH 的 native 候选、宿主测试、PR 与本地自动合入，以及错误 SHA、脏工作区、测试替换、重放、失败重试、取消、配置迁移和隐藏评测拒绝。DSH 兼容性通过已有回归和合成超时测试检查；这些测试不代表真实模型调用或部署验收。安装、全量测试和技能分发需要在目标环境中分别验证，并记录实际结果。
