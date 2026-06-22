<h1 align="center">
  <img src="docs/assets/skillhone-logo-64.png" alt="SkillHone Logo" width="36" style="vertical-align: middle;">
  &nbsp;SkillHone-Skills
</h1>

<h3 align="center">
  Continual Agent Skill Evolution<br>
  Through Persistent Decision History
</h3>

<p align="center">
  <a href="https://arxiv.org/abs/2606.08671"><img src="https://img.shields.io/badge/arXiv-2606.08671-b31b1b?style=flat-square&logo=arxiv&logoColor=white" alt="arXiv"></a>
  <img src="https://img.shields.io/badge/Runtime-Claude%20Code%20%7C%20Codex%20%7C%20OpenClaw%20%7C%20Hermes-21b998?style=flat-square" alt="Runtimes">
</p>

<p align="center">
  <strong>English</strong> &bull;
  <a href="./docs/README.zh.md">简体中文</a>
</p>

<p align="center">
  <a href="https://arxiv.org/abs/2606.08671">Paper</a> &bull;
  <a href="#why-skillhone">Why SkillHone</a> &bull;
  <a href="#vs-other-skill-evolution-projects">Compare</a> &bull;
  <a href="#install">Install</a> &bull;
  <a href="#usage">Usage</a> &bull;
  <a href="#whole-skill-optimisation">Whole-Skill Optimisation</a> &bull;
  <a href="#observability">Observability</a> &bull;
  <a href="#one-harness-across-major-runtimes">Runtimes</a> &bull;
  <a href="#evalskill-split">Eval / Skill Split</a> &bull;
  <a href="#skills-in-this-bundle">Bundle</a> &bull;
  <a href="#configure">Configure</a>
</p>

<p align="center">
  <video src="https://github.com/user-attachments/assets/42c7458f-7511-4cda-8c66-423832949804" controls width="800"></video>
</p>

---

## Why SkillHone

> **The unit of change is a skill folder, not a prompt string. Every decision is a Git artifact.**

Two things make SkillHone different from "let an LLM rewrite the `SKILL.md`
string" projects. Everything else is plumbing:

- **Whole-skill optimisation.** Each merged PR can rewrite
  `SKILL.md`, add a new helper under `scripts/`, *and* drop a
  reference page under `references/` — in one atomic change,
  gated by the regression suite. Detail and a real PR-diff table
  in the [Whole-Skill Optimisation](#whole-skill-optimisation)
  section below.
- **GitHub-style observability, local.** Every step lands as a real
  issue, branch, commit, PR, or wiki entry on a Git server that can run
  entirely on your machine (Forgejo by default). Open the UI a reviewer
  already knows how to read, and the whole decision path is right there.

Supporting properties that make the above viable in practice:

- A hard **eval / skill split** enforced by code paths and filesystem
  permissions rather than by prompt convention, which makes accidental
  probe leakage into skill instructions much harder.
- **No runtime adapter to maintain.** SkillHone is just a bundle of skills
  following the [agentskills.io](https://agentskills.io) standard. Any
  agent runtime that already supports skills supports SkillHone — for
  example Claude Code, Codex, OpenClaw, Hermes, and any future runtime
  that speaks the same protocol.

## vs. Other Skill-Evolution Projects

| Capability | [microsoft/SkillOpt](https://github.com/microsoft/SkillOpt) | [NousResearch/hermes-agent-self-evolution](https://github.com/NousResearch/hermes-agent-self-evolution) | **SkillHone** |
|---|:---:|:---:|:---:|
| Evolves agent skills automatically                                            | ✅ | ✅ | ✅ |
| Open source, Python implementation                                            | ✅ | ✅ | ✅ |
| Held-out validation before adopting a change                                  | ✅ | ✅ | ✅ |
| **Patches the entire skill folder** — `SKILL.md` + `scripts/` + `references/` | ❌ | ❌ | ✅ |
| **GitHub-style audit trail** — every step is a git issue / PR / commit / wiki | ❌ | ❌ | ✅ |

## Install

Copy the prompt below and send it to any skill-capable AI assistant —
Claude Code, Codex, OpenClaw, Lighthouse, Kimi, and so on. The assistant
fetches the install guide, detects your runtime, and puts SkillHone in the
right place.

> Please install SkillHone by following the instructions at
> `https://raw.githubusercontent.com/Tencent/SkillHone/main/docs/install/skillhone.md`.
> Detect my agent runtime, install the `skillhone` skill into its skills
> directory, and then ask me for the model credentials needed to finish
> configuration.

To update later, re-send the same prompt and ask the assistant to refresh
the install.

## Usage

Once installed, invoke skills the way your runtime invokes any
[agentskills.io](https://agentskills.io) skill — by slash command
(`/skillhone`) or by intent. The top-level `skillhone` skill is the
recommended entry; it dispatches to the right sub-skill (see
[Skills in this Bundle](#skills-in-this-bundle) below).

Paste any of these into your agent:

> `/skillhone` optimize my `travel-qa` skill for 5 iterations.

> Use skillhone to evaluate my `travel-qa` skill against the latest
> probe split.

> Use skillhone-prd to draft a PRD for a new "code-review" skill, then
> use skillhone to seed and run a first optimisation pass.

Each sub-skill's `SKILL.md` lists its full trigger surface.

<p align="center">
  <img src="docs/assets/skillhone-framework.jpg" alt="SkillHone framework — agent runtime dispatches role-bounded optimisation and evaluation subagents over a skill repo and a skill-eval repo, recording every step into a persistent decision history" width="100%">
</p>

## Whole-Skill Optimisation

A skill is not a single file — it is a folder, containing `SKILL.md`,
`scripts/`, `references/`, and `assets/`. Mainstream skill-evolution
work today only edits one of those files, `SKILL.md`. **Editing one
file out of many cannot fix failures that live in the helper scripts
or the reference pages, and a non-trivial fraction of real failures
live exactly there.** The optimisation is structurally incomplete —
the surface available to it is one file, the surface where the
failures actually live is the whole folder.

A genuine skill is a **folder**. Alongside `SKILL.md` it carries
`scripts/` (executable helpers the agent calls — Python, shell,
anything), `references/` (schemas, lookup tables, format cheat-sheets
the agent reads on demand), and `assets/` (fixtures and templates).
SkillHone's optimisation loop reaches into all of these: diagnose a
probe failure → decide whether the fix belongs in the prose, in a new
helper script, in a reference page, or in any combination of those —
and land it as a single atomic PR gated by a regression eval. **The
whole-folder edit is the practical-value differentiator** — it is
where SkillHone stops being theoretical and starts paying for itself.

The table below lists the merged PRs from one `travel-qa` smoke run.
Each row is one merge; each diff column shows what that single PR
changed across the skill folder.

| PR | Issue it closes | Skill-folder diff (one merge) |
|---:|---|---|
| **#2** | **#1** matrix-routing 404 — 36 failures across 5 executors | `SKILL.md` +116 / −19 · `scripts/tomtom_api.py` ➕ 243 (new file) · `scripts/tsp_solver.py` ➕ 184 (new file) |
| **#4** | **#3** wrong statistic — used mean where the question asked for median | `SKILL.md` +62 / −5 |
| **#6** | **#5** model invented tool syntax + `tomtom_api.py` HTTP 403 | `SKILL.md` +27 · `scripts/tomtom_api.py` +27 / −4 ⚠ |
| **#7** | regression caught after #6 merged | `SKILL.md` 0 / −27 · `scripts/tomtom_api.py` +4 / −27 (revert) |

A prompt-only optimiser could not land PR #2: even with the prose
saying "use matrix routing", the agent still has no
`tomtom_api.py` and reproduces the same 404 in a different shape.

Full per-PR walkthrough lives in the
[`travel-qa` example](examples/travel-qa/README.md).

## Observability

Other skill-evolution projects typically persist optimisation
trajectories as flat text files on disk. SkillHone instead writes every
decision into the standard artifacts of a self-hosted Git server —
Issues, branches, pull requests, wiki pages — so the entire optimisation
process is presented in a UI any reviewer already understands. The
server (Forgejo by default) runs locally — a single `docker compose up -d`
is sufficient.

The screenshots below are taken from our own Forgejo on the
`travel-qa` skill. Each diagnosis corresponds to an Issue, each
revision to a Pull Request, and each iteration's observations to a
Wiki page.

<p align="center">
  <img src="docs/assets/issue.png" alt="Forgejo Issues view — failures that drove each revision" width="100%">
  <br>
  <em>Issues — the failures that drove each revision.</em>
</p>

<p align="center">
  <img src="docs/assets/pr.png" alt="Forgejo Pull requests view — merged skill changes" width="100%">
  <br>
  <em>Pull requests — the skill changes themselves.</em>
</p>

<p align="center">
  <img src="docs/assets/wiki.png" alt="Forgejo Wiki view — per-iteration observations" width="100%">
  <br>
  <em>Wiki — per-iteration observations that later runs read.</em>
</p>

## One Harness Across Major Runtimes

Drop the same bundle into any skill-supporting runtime —
`~/.claude/skills/`, `~/.codex/skills/`, and so on — and SkillHone is live.
For example: **Claude Code, Codex, OpenClaw, Hermes, …**

## Eval / Skill Split

The public skill repo and the private eval repo are isolated by code and
filesystem permissions, not by prompts. By default the engine reads probes
without copying them into skill instructions, and gold labels stay in the
eval repo.

## Skills in this Bundle

| Skill | What it does |
|---|---|
| **`skillhone`** | Top-level entry — wraps the CLI (`status`, `eval`, `optim`, `new`, `seed`, `serve`). |
| **`skillhone-optimization`** | Optimisation orchestrator — diagnoses failures, plans changes, lands focused PRs on the skill repo. |
| **`skillhone-evaluation`** | Runs and interprets evaluations — eval / probe / PR-validation, regression checks, trajectory diagnosis. |
| **`skillhone-prd`** | Interactive PRD builder — pins down a new skill's goal, tools, and scoring rubric before optimisation begins. |
| **`skillhone-synthesis`** *(experimental — data-synthesis skill)* | **Experimental** skill for synthesising closed-form, automatically verifiable benchmark Q/A by exploring tool environments. Used to bootstrap eval datasets; not part of the core measurement / optimisation loop and may change without notice. |
| **`forgejo`** | REST-API toolkit for the default Git backend — issues, PRs, wikis, repos, branches. |

## Configure

All SkillHone really needs from you is model credentials. Give the
assistant these values when you install — it will write the right
`~/.skillhone/settings.json` for you.

| Role | Required? | What it does |
|---|---|---|
| **Optimizer** | required | Drives the optimisation loop — proposes patches to the skill. |
| **Executor** | optional, defaults to Optimizer | Runs the skill being tested on each probe. |
| **Tester**   | optional, defaults to Optimizer | Scores / judges the executor's output. |

If you use Anthropic directly, just give the assistant your
Anthropic API key — `claude-agent-sdk` uses Anthropic's official
endpoint by default. **Only when you route through a third-party
Anthropic-compatible provider** (e.g. DeepSeek) do you need to
fill the three fields per role: `base_url` (Anthropic-format),
`api_key`, `model_name`. Example:

```ini
base_url   = https://api.deepseek.com/anthropic
api_key    = sk-xxx
model_name = deepseek-v4-pro
```

Full schema, multi-identity Forgejo tokens, and the `~/.skillhone/`
directory layout live in
[`skills/skillhone/references/configuration.md`](./skills/skillhone/references/configuration.md).

## About This Repo

SkillHone-Skills is a bundle of standard agent skills built around
the ideas in the paper "**SkillHone: A Harness for Continual Agent
Skill Evolution Through Persistent Decision History**"
([arXiv:2606.08671](https://arxiv.org/abs/2606.08671), 2026).

The SkillHone harness in the paper is built on an enterprise-internal
agent framework with no current plans for open-source release. For
the convenience of community adoption, we packaged its ideas as a
bundle of standard agent skills following the
[agentskills.io](https://agentskills.io) protocol, with
`claude-agent-sdk` as the default agent backend and Forgejo as the
default Git server. The bundle runs on any agent runtime supporting
the protocol — Claude Code, Codex, OpenClaw, Hermes, …

The core methodology remains identical: each development step is
recorded as a `(diagnosis, candidate revision, redacted evidence,
outcome)` tuple — the **persistent decision history**;
role-separated optimisation and evaluation subagents prevent
practice feedback from leaking into skill instructions; and the
eval / skill split is enforced by code paths and filesystem
permissions. Due to differences between agent frameworks, there are
some implementation-level distinctions (e.g., role separation is
enforced through skill mount boundaries and code paths instead of
framework-native subagent policies).

## Star History

<a href="https://www.star-history.com/#Tencent/SkillHone&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=Tencent/SkillHone&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=Tencent/SkillHone&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=Tencent/SkillHone&type=Date" />
  </picture>
</a>

## Citation

```bibtex
@misc{li2026skillhoneharnesscontinualagent,
  title         = {SkillHone: A Harness for Continual Agent Skill Evolution Through Persistent Decision History},
  author        = {Zhiwei Li and Yong Hu},
  year          = {2026},
  eprint        = {2606.08671},
  archivePrefix = {arXiv},
  primaryClass  = {cs.LG},
  url           = {https://arxiv.org/abs/2606.08671},
}
```

## License

SkillHone is released under the [MIT License](./LICENSE).

---

<p align="center">
  <sub>
    An open-source implementation of the SkillHone paper. <br>
    Demo video rendered with <a href="https://github.com/heygen-com/hyperframes">HyperFrames</a>.
  </sub>
</p>
