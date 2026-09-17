# 附加的 Benchmark 优化流程

这是为已经拥有数据集，或者确实需要构建数据集的用户保留的论文兼容路径，属于
附加功能，不是 SkillHone 的默认流程。日常维护应让正在工作的 Agent 直接记录
可复现 Issue，再走更短的 Issue-to-PR 链路。

Benchmark 流程从用户提供的数据集开始，并保留论文中的 Skill/Eval 组织方式；
由配套 Skill 和 Harness Prompt 约束哪些内容可以交给优化器。

全量模式始终使用两个独立的 Git 仓库：

```text
Skill 仓库                            Eval 仓库
SKILL.md、scripts、references         probe.jsonl、pr_val.jsonl、test.jsonl
修复分支和待审 Diff                    evaluator、verifier、gold
                 ^                    原始轨迹和结果
                 | probe 问题与聚合、脱敏反馈
                 +-------------------- 评估器在优化器之外运行
```

DeepSeek Harness 接收 Skill 仓库、用于迭代的 probe 问题，以及聚合、脱敏后的
失败观察；不接收 Eval 仓库路径、probe 的 verifier/gold、留出的 `pr_val`/`test`
问题或原始结果文件。Benchmark 中的测试也不会被复制到 Skill 仓库的 `.test/`。

Harness 实际运行在一个临时 Git 副本中：其父目录不放 Eval 仓库，并移除 Git
remote；只有干净且已提交的候选才会导回真正的 Skill 分支。这可以阻止普通的
相邻目录发现，但不等同于容器或虚拟机级别的敌对进程隔离，因为 DSH 原生 sandbox
约束的是文件写入效果，而不是全部文件读取。

## 准备并冻结 Eval 仓库

可以复用已有 SkillHone Eval/Evo 仓库，也可以提供其他可信评估器。Eval 仓库
必须干净且已提交，其中必须有 `probe.jsonl`；`pr_val.jsonl` 和 `test.jsonl`
可选。注册前需要提交全部数据和评估器修改。

```bash
cd /path/to/my-skill
skillhone benchmark init --eval-repo /path/to/my-skill-eval
skillhone benchmark status
```

`init` 会固定 Eval Git commit，并为每个数据集计算指纹。工作树不干净、commit
或 JSONL 改变、缺少 `probe.jsonl`，以及 Eval 与 Skill 指向同一个仓库时，
Campaign 都会直接中止。

早期 SkillHone Eval 仓库的兼容 runner 是：

```text
python3 evaluator/eval.py --skill-dir {skill} --dataset-dir {eval} --split {split} --output {output}
```

其他可信评估器可以显式注册：

```bash
skillhone benchmark init \
  --eval-repo /path/to/my-skill-eval \
  --runner 'node evaluator.mjs --skill {skill} --split {split} --output {output}'
```

runner 在 DeepSeek Harness 之外执行；输出 JSON 必须包含 0 到 1 之间的 `score`
或 `pass_rate`。

## 测量与优化

```bash
skillhone benchmark run --split probe
skillhone benchmark optimize --min-improvement 0.02
```

全量优化的流程是：

1. 测量冻结的 `probe` 基线；存在 `pr_val` 时同时测量验证基线。
2. 只根据聚合计数和脱敏失败类别创建一个仓库内 Issue；原始样本留在 Eval 侧。
3. 先运行一个独立、只读的 Harness Explorer；它只能查看公开 Skill、可见 probe
   问题、公开 Agent Skill 和一手文档。候选 Skill 必须说明来源 revision、许可证、
   所需工具以及是否包含可执行代码；Explorer 不能修改 Skill，也不能读取答案、
   验证器、`pr_val` 或 `test`。
4. 把公开 Skill 仓库、可复现的 probe 问题和脱敏观察交给 DeepSeek Harness，
   让它提出一次可泛化改进。修复可以吸收经过审查、使用现有原生工具的 Prompt 型
   Skill，但不能执行下载代码或安装其依赖；probe 的 verifier/gold 与留出问题继续保密。
   默认按文件顺序读取每一条有效且非空的 probe 问题，不抽样，也不设置条数上限
   或全局字符上限；脱敏仍然生效。
5. 在 Harness 之外，用同一份冻结评估重新测量候选版本。候选未达到 probe
   提升门槛时立即拒绝，不再消耗私有 `pr_val`。
6. 把 probe 和 PR-validation 的聚合门槛写入 SkillHone 本地 SQLite，不向 Skill
   Git 提交 Benchmark 契约。
7. 只有 probe 提升达到阈值，且 PR validation 回退不超过两个百分点时，才创建
   关联该 Issue 的本地 PR。

未被选中的分支仍关联原 Issue，并留下 Wiki 工作记录，但不创建 PR。两种结果都
不会 push；合并遵循统一的 `review` 或测试门禁后的 `automatic` 策略。

## 最终留出集测量

`benchmark optimize` 永远不会读取 `test`。迭代和候选选择结束后，只运行一次
留出集：

```bash
skillhone benchmark run --split test
```

不要根据该结果继续修改。如果评估契约需要变化，应提交新的 Eval 状态并初始化
新的 Campaign。

## 快速模式与全量模式

| 模式 | 证据 | 仓库边界 |
|---|---|---|
| 快速模式（默认） | Agent 正常工作时遇到的一个可复现问题 | 一个 Skill Git 仓库；聚焦的 `.test/` 回归对修复 Agent 可见 |
| 全量 Benchmark | 用户提供的数据集，用于系统性 Skill 演进 | 两个 Git 仓库；probe 问题驱动迭代，verifier/gold 与留出问题保留在 Eval 侧 |

两种模式都会保留 Issue、分支、Harness Run、本地 PR 决策和 Wiki 历史。区别在于
证据边界：快速模式缩短小问题的修复链路；全量模式保证测量不因数据泄露失真。

## 隐私和审阅边界

- 所有 split、verifier、gold、轨迹、评估器路径和原始结果 JSON 都只在 Eval 侧
  保存；经过脱敏的 probe 问题会作为可见开发反馈临时传给 Harness。
- Harness 能看到 Skill 仓库、脱敏后的 probe 问题、聚合分数和脱敏失败类别，
  但看不到 `pr_val`/`test` 输入、答案或 verifier。
- Web API 只展示聚合评估门槛，不返回原始数据或本地 Eval 路径。
- verifier 会作为本地代码执行，因此只能注册可信 Eval 仓库。
- Benchmark 优化永远不会 push。默认 `review` 策略保留待审 PR；只有用户明确
  保存 `automatic` 策略后，才会在冻结评估门禁通过时本地合并。
