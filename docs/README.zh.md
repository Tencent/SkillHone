<div align="center">

# SkillHone

### 把 Agent 在工作中遇到的 Skill 故障，变成可以长期复用的改进。

Skill 的问题往往出现在真实任务里。引用的脚本丢了、API 变了、原来的说明失效了，
这些证据通常会随着对话一起消失。SkillHone 在 Agent 工作时记下问题，修复完整的
Skill 仓库，运行回归测试，再把本地 PR 交给你审阅。

*基于持久化决策历史的 Agent Skill 持续进化框架*

[![论文](https://img.shields.io/badge/Paper-EMNLP%202026%20Industry-8b1a1a)](https://arxiv.org/abs/2606.08671)
[![Gitleaks](https://github.com/Tencent/SkillHone/actions/workflows/gitleaks.yml/badge.svg)](https://github.com/Tencent/SkillHone/actions/workflows/gitleaks.yml)
[![许可证](https://img.shields.io/badge/License-MIT-green)](../LICENSE)

[安装](./install/skillhone.md) ·
[English](../README.md) ·
[示例](../examples/phoenix-tracing/) ·
[论文](https://arxiv.org/abs/2606.08671) ·
[安全](../SECURITY.md)

</div>

## 最近更新

- **[2026-09-18] Agent 工作中遇到的问题可以直接进入优化。** Coding Agent
  可以随手记录可复现的 Skill 故障。SkillHone 会排队修复、验证结果，并把本地
  PR 放进审批收件箱。
- **[2026-08-21] 论文被 EMNLP 2026 Industry Track 接收。** 论文
  *SkillHone: A Harness for Continual Agent Skill Evolution Through Persistent Decision
  History* 已被 Industry Track 接收。

## 为什么用 SkillHone

| 优势 | 带来的变化 |
|---|---|
| **从真实工作中学习** | Codex、Claude Code、Cursor、Pi、ZCode 等能够调用 CLI 的 Agent，可以在问题发生时直接记录证据。日常修复不需要先造 Benchmark。 |
| **优化完整 Skill** | 一次改动可以覆盖 `SKILL.md`、脚本、参考资料、资源和仓库测试，不局限于改写 Prompt。 |
| **先证明，再审阅** | 每次修复都关联 Issue、回归测试、Git diff、运行记录和本地 PR。没有通过验证的改动不会进入审批队列。 |
| **留下可复用的历史** | 每个 Skill 都有独立仓库和决策历史。后续 Agent 能看到哪里失败、改了什么，以及候选方案为什么被接受或拒绝。 |
| **最终决定由你做** | 审阅模式会等待用户合并。自动本地合并需要用户主动开启，而且关联测试必须通过。SkillHone 不会替用户 push。 |

需要做大规模能力优化时，仍然可以使用论文中的评估驱动模式，把冻结数据集放在
独立 Eval 仓库中。

## 用一句话安装

把下面这段话交给 Coding Agent：

> 从 `https://github.com/Tencent/SkillHone` 的 `main` 分支安装 SkillHone。
> 按照 `docs/install/skillhone.md` 完成安装，让当前 Agent 能发现 SkillHone
> Skills 和 CLI，并在不修改无关文件的前提下验证安装结果。Git 安装命令须使用
> 文档中的 `--install-links=true`。

SkillHone 直接从 GitHub 安装，不需要注册包管理账号，也不用部署额外的托管服务。

## 看它解决一个公开问题

[![SkillHone 工作台展示每个 Skill 的 Issue、修复 Run、本地 PR 和审批状态](./assets/skillhone-workbench-e2e.png)](../examples/phoenix-tracing/)

**[运行示例](../examples/phoenix-tracing/)**，查看 Agent 如何在正常工作中发现
Skill 问题、记录证据，并在 SkillHone 工作台中留下经过测试的本地 PR。

可复现示例来自 GitHub Phoenix tracing Skill 的真实缺陷。它的索引引用了四份并
不存在的文档，Agent 无法读取承诺的指导内容。这里有公开的
[Issue #2567](https://github.com/github/awesome-copilot/issues/2567)、已经合并的
[修复 #2568](https://github.com/github/awesome-copilot/pull/2568)，以及固定版本的
[`examples/phoenix-tracing`](../examples/phoenix-tracing/) 可复现样例。

## 选择适合的模式

| 模式 | 输入 | 适用场景 | 结果 |
|---|---|---|---|
| **快速模式** | Agent 工作中发现的可复现故障 | 文件缺失、脚本损坏、说明过时、API 漂移 | Issue、回归测试、聚焦修复、本地 PR |
| **全量模式** | 独立 Eval 仓库中的冻结数据集和验证器 | 更大范围的能力或质量提升 | 基线、候选迭代、验证门禁、本地 PR |

快速模式省掉了日常维护中最费力的 Benchmark 构造。真正需要代表性评估集时，再
使用全量模式。两种模式都会保留改动及其证据。

## 直接优化完整 Skill

SkillHone 把整个 Skill 仓库作为优化对象：

```text
my-skill/
├── SKILL.md
├── scripts/
├── references/
├── assets/
└── .test/
```

SkillHone 可以修复可执行脚本、更新说明和参考资料、添加隐藏回归测试，再把它们
放进一个原子 PR。因此，缺失脚本、解析器错误等问题也能真正被修复。

## 每一步都能看清

本地工作台会展示每个 Skill 的 Issue、测试、修复 Run、提交、文件变更、PR、审批
状态和 Wiki。执行修复的 Agent 无法在运行过程中改写这些历史。用户可以先查看
故障证据、回归测试、完整 Diff 和运行结果，再决定是否合并。

修复结果会一直留在本地。只有已保存的合并策略能够让它进入默认分支，push 始终
由用户单独决定。

## 研究

SkillHone 会保留诊断、修改、证据、结果和被否决方案。后续 Agent 能沿用这些决策
历史，不必反复探索同一个失败原因。

论文的开放网络实验中，进化后的 Skills 相比论文报告的商业检索 Research Agent，
在 **GAIA 上提高 15.8 分**，在 **WebWalkerQA-EN 上提高 3.2 分**。当前仓库保留
了这套评估驱动方法，同时把运行时反馈加入为更快的修复证据来源。

> Zhiwei Li and Yong Hu. **SkillHone: A Harness for Continual Agent Skill
> Evolution Through Persistent Decision History.** EMNLP 2026 Industry Track.
> [arXiv:2606.08671](https://arxiv.org/abs/2606.08671)

SkillHone 使用 [MIT License](../LICENSE)。第三方组件及许可证见
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)。
