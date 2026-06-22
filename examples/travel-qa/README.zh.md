# Travel-QA — SkillHone 示例

<p align="left">
  <a href="./README.md">English</a> &bull; <strong>简体中文</strong>
</p>

一个完整的 SkillHone 示例:一个**旅行规划问答** skill,在
SkillHone 自动优化前后,同一组难题的通过情况显著变化 ——
此前答错的题目得以正确解出;若优化过程中引入回归,SkillHone
亦能自动检测并回滚。

题目对齐真实旅客会提出的问题 —— 不是"推荐一个城市",而是
"**找一家非连锁、有电话登记、且不在网红打卡名单上的咖啡店,
位置在我途中**"。回答此类问题需要串联多次查询并执行必要的
计算,LLM 单独作答时往往会遗漏其中一条约束。

本目录**仅提供任务规格**(`PRD.md`)。SkillHone 会自动产出
skill、题目集、回归 eval。该示例使用 TomTom Maps 作为
底层地图数据源 —— 关注的核心是 skill 本身,TomTom 仅为实现细节。

---

## 优化效果

每一次改动均落到一个独立的 Pull Request —— 任何一次修复
背后的诊断与变更都可像普通 code review 一样追溯。

下面这道题,优化前 ❌、优化后 ✅:

> *"我在阿姆斯特丹达姆广场,想开车去附近 1.5 公里内吃一顿独立
> (非连锁)的餐厅。我不想挑最近的那家(可能不够典型),想挑
> 一家开车时长接近所有候选餐厅时长**中位数**的店。200 米以内
> 的不算(步行可达)。直接告诉我这家店叫什么名字。"*

**优化前的回答:** `Palmyra Restaurant`(黎巴嫩餐厅,Nieuwezijds Voorburgwal 53)❌
模型在统计方法的选择上,以平均数近似中位数。在阿姆斯特丹运河
结构下,少数候选店的开车时长显著长于其余,中位数与平均数发生
明显偏离,据此选出的目标店错误。

**优化后的回答:** `The Corner Restaurant`(Martelaarsgracht 26)✅
其中一个 Pull Request 引入了显式的 `median` / `percentile` /
`closest-to-X` 工具函数,并在 SKILL.md 中加入一条规则:
"题目要求中位数时必须使用中位数,不得以平均数近似"。同一题在
执行模型采用正确统计方法后,答案得以纠正。

---

## 决策轨迹

每一处修复对应一个 Pull Request,每一次失败对应一个 Issue,
每一轮迭代写入一篇 wiki 观察记录。在 Forgejo 中,这条决策
轨迹与日常代码评审流程完全一致。以下截图取自本示例的实际运行。

### 整技能演进路径

SkillHone 在每一次迭代中可对 skill 仓内任何文件进行修改 ——
`SKILL.md` 指令、`scripts/` 下的辅助脚本、`references/` 中
的参考页 —— 每一处改动均落到一次常规 PR。本次运行共合入
4 个 PR(含 1 次撤销),逐文件 diff 如下:

| PR | 对应 Issue | Skill 仓 diff |
|---:|---|---|
| **#2** | **#1** matrix routing 404(5 个执行器累计 36 次失败) | `SKILL.md` +116 / −19 · `scripts/tomtom_api.py` ➕ 243(新文件) · `scripts/tsp_solver.py` ➕ 184(新文件) |
| **#4** | **#3** 统计方法选取错误(题目要求中位数,模型使用了均值) | `SKILL.md` +62 / −5 |
| **#6** | **#5** 模型臆造工具语法 + `tomtom_api.py` HTTP 403 | `SKILL.md` +27 / −0 · `scripts/tomtom_api.py` +27 / −4 ⚠️ |
| **#7** | 合入后复测检出退化 | `SKILL.md` 0 / −27 · `scripts/tomtom_api.py` +4 / −27 |

综合结果:`scripts/` 目录下新增两份辅助脚本
(`tomtom_api.py`、`tsp_solver.py`);`SKILL.md` 从 1.3 KB 扩展
至约 6 KB 的任务化指引;一次退化在数分钟内被后续 PR 撤销。
上述每一条 diff 均覆盖 skill 文件夹中的多处文件 —— SkillHone
不是 prompt 微调,而是按人工维护者的 git workflow 直接修改
仓库内文件。

<p align="center">
  <img src="../../docs/assets/issue.png" alt="Issues —— 驱动每次改动的失败原因" width="100%">
  <br>
  <em>Issues —— 驱动每次改动的失败原因。</em>
</p>

<p align="center">
  <img src="../../docs/assets/pr.png" alt="Pull requests —— skill 的具体改动" width="100%">
  <br>
  <em>Pull requests —— skill 的具体改动。</em>
</p>

<p align="center">
  <img src="../../docs/assets/wiki.png" alt="Wiki —— 每轮迭代的观察记录" width="100%">
  <br>
  <em>Wiki —— 每轮迭代的观察记录。</em>
</p>

---

## 前置条件

|  |  |
|---|---|
| **SkillHone 本地环境** | 本地 Forgejo + Python 环境,详见 [`docs/install/developer.md`](../../docs/install/developer.md) |
| **TomTom Maps API key** | <https://developer.tomtom.com/> |

```sh
export TOMTOM_API_KEY='your-key-here'
```

---

## 如何运行

在挂载了 SkillHone 的 agent runtime(Claude Code / Codex / OpenClaw / …)
中,从仓库根目录发送以下指令:

> `/skillhone help me synthesise and optimise a skill from ./examples/travel-qa/PRD.md`

后续流程由 SkillHone 自动接管。

---

## 文件清单

- [`PRD.md`](./PRD.md) —— 任务规格。`skillhone new` 会自动剥离
  `## 3. Evaluation` 段后,将其作为 improver 可见的
  `README.md` 提交至公开 skill 仓;完整原文进入私有 eval 仓。
  如需更精细地控制剥离范围,可在同目录下额外放置
  `PRD.improver_only.md`。
