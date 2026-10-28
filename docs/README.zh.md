<div align="center">

# SkillHone

**让 Agent Skills 持续变好，让学到的经验留下来。**

[![论文](https://img.shields.io/badge/EMNLP_2026-Industry-286c3b)](https://aclanthology.org/2026.emnlp-industry.105/)
[![CI](https://github.com/zwliJay/SkillHone/actions/workflows/ci.yml/badge.svg)](https://github.com/zwliJay/SkillHone/actions/workflows/ci.yml)
[![许可证](https://img.shields.io/badge/License-MIT-286c3b)](../LICENSE)

[开始使用](#开始使用) · [English](../README.md) ·
[公开示例](../examples/phoenix-tracing/) · [论文](https://aclanthology.org/2026.emnlp-industry.105/)

![SkillHone：从真实故障出发，记录 Issue，修复并验证，审阅本地 PR，保留决策历史。](assets/skillhone-hero.svg)

</div>

**论文已被 EMNLP 2026 Industry Track 接收。** 在论文的开放网络实验中，相比其中的
商业 Deep Research Agent 基线，GAIA 提高 **15.8 分**，WebWalkerQA-EN 提高
**3.2 分**，且无需预先集成搜索栈。[查看论文与实验条件](https://aclanthology.org/2026.emnlp-industry.105/)。

Agent 遇到脚本丢失、引用损坏或说明过时时，SkillHone 会记下证据，修复**完整的
Skill 仓库**，再交付经过测试的本地 PR。Issue、回归测试、Diff、Run 和决策留在
一起，后续 Agent 可以沿用已有的判断。

适用于 **Codex、Claude Code、Cursor、Pi、ZCode** 等能够调用 CLI 的 Agent。
当前 Agent 报告问题，DeepSeek Harness 执行修复。

## 开始使用

把这段话交给你的 Coding Agent：

> 从 `https://github.com/zwliJay/SkillHone` 安装 SkillHone，遵循
> `docs/install/skillhone.md`，让当前 Agent 能发现 CLI 和 Skills。使用文档中的
> `--install-links=true` Git 安装命令，并验证安装结果。

偏好终端操作？[安装指南](install/skillhone.md)包含安装步骤、Provider 配置及验证方法。

## 35 秒了解 SkillHone

[![观看 SkillHone 宣传片：EMNLP 2026 接收、论文实验提升和新版工作台](assets/skillhone-promo-poster.png)](https://github.com/zwliJay/SkillHone/releases/tag/v2.0.0-rc.1)

[观看／下载 35 秒 MP4](https://github.com/zwliJay/SkillHone/releases/download/v2.0.0-rc.1/skillhone-launch.mp4)，1080p，配原创音乐。宣传片与 GIF 单独放在 Release 附件中。

<details>
<summary>展开查看当前工作台完整截图</summary>

![新版 SkillHone 工作台：Skills 列表、逐项审批数量、本地 PR 和修复历史](assets/skillhone-workbench-current.png)

查看哪些 Skills 需要处理，展开修复记录，审阅本地 PR，再决定是否合并。

</details>

**亲手复现一次修复。** [Phoenix tracing 示例](../examples/phoenix-tracing/)从四份未随 Skill 发布的引用文档开始，完整展示故障、回归测试和修复证据。公开依据：[Issue #2567](https://github.com/github/awesome-copilot/issues/2567) · [已合并的修复 #2568](https://github.com/github/awesome-copilot/pull/2568)。

## 修复之后留下什么

| 你需要 | SkillHone 保留 |
|---|---|
| 后续 Agent 能复现的问题 | 一条带脱敏证据和关联回归测试的 Issue |
| 完整的修复 | 同一个 Git Diff 中的 `SKILL.md`、脚本、引用、资源与测试变更 |
| 可以审阅的结果 | 测试结果、修复 Run、提交和本地 PR |
| 后续 Agent 能沿用的判断 | 每个 Skill 独立的 Wiki 记录和持久化决策历史 |

修复在独立分支上进行，**默认先审阅**。自动本地合并需要主动开启，且关联测试
必须通过；push 始终是用户单独授权的操作。[本地工作台](install/developer.md#run-the-workbench)
集中展示 Issue、Run、PR、审批状态和 Wiki。

## 两种优化路径

| | 运行时维护 | 评估驱动优化 |
|---|---|---|
| 从哪里开始 | 真实工作中遇到的可复现故障 | 独立 Eval 仓库中的冻结数据集与验证器 |
| 适合什么问题 | 文件缺失、脚本损坏、说明过时和 API 漂移 | 更大范围的能力与质量提升 |
| 审阅什么 | Issue、回归测试、修复和本地 PR | 基线、候选迭代、验证结果和本地 PR |
| 继续阅读 | [运行时工作流](../skills/skillhone-auto-optimization/SKILL.md) | [Benchmark 工作流](benchmark-optimization.zh.md) |

## 论文与引用

> Zhiwei Li and Yong Hu. *SkillHone: A Harness for Continual Agent Skill
> Evolution Through Persistent Decision History.* EMNLP 2026 Industry Track.
> [ACL Anthology](https://aclanthology.org/2026.emnlp-industry.105/) · [arXiv:2606.08671](https://arxiv.org/abs/2606.08671)

[BibTeX](skillhone.bib) · [CITATION.cff](../CITATION.cff)

[安全](../SECURITY.md) · [参与贡献](../CONTRIBUTING.md) ·
[MIT License](../LICENSE) · [第三方声明](../THIRD_PARTY_NOTICES.md)
