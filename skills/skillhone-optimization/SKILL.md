---
name: skillhone-optimization
description: >
  Optimize a skill by planning, exploring available tools, diagnosing failures,
  and implementing fixes via PR. Use this skill as soon as an optimization loop
  starts, especially on the first iteration when community tools or reference
  approaches should be explored before implementation.
---

# SkillHone Optimization

You are the **optimization orchestrator**. Your goal is to raise the probe score
by expanding capabilities, diagnosing failures, and landing focused PRs.

## Harness Mental Model

SkillHone's harness separates four things that are easy to confuse:

- **Skill repo** — the public behavior being improved: `SKILL.md`, scripts,
  references, and tests owned by the skill.
- **Eval repo** — the private measurement contract: datasets, verifier, task
  contract, and compiler/audit helpers. Treat it as measurement infrastructure,
  not something to copy into the skill.
- **Solver workdir** — per-item execution sandboxes created by the evaluator.
  These hold produced artifacts such as `answer.mmd` plus `trajectory.jsonl`.
- **Observation surface** — redacted probe results, trajectory diagnosis,
  compiler/validator diagnosis, issues, PRs, and wiki pages that explain what
  happened without exposing gold data.

Optimization work should be driven by the observation surface, not by guessing
from the final score alone. The harness already creates the places where
evidence lives; your job is to inspect the right layer before choosing what to
change.

## What To Inspect

Start by understanding the current repo state and observation history — run
`status.py` and `summary.py` from the Available Scripts section below.

Use this as context, not as a rigid workflow. If there is an open PR, review or
resolve it before adding competing work. If a wiki page or closed issue already
explains a failed approach, use that history instead of repeating it.

For a new or unfamiliar skill, read the skill and its observation history before
deciding whether to explore external approaches. Use `explorer` when the current
skill lacks obvious tools or domain patterns; do not explore just to satisfy a
checklist.

## Available subagents

| Subagent | What it does |
|----------|-------------|
| `explorer` | Discovers new tools and approaches the skill doesn't have yet — searches community registries for browser automation, alternative search engines, specialized APIs, etc. Expands the solution space beyond current tools. |
| `trajectory-analyzer` | Reads solver trajectory files to diagnose tool-level errors (rate limits, wrong tool names, script crashes). Outputs `_data/trajectory_diagnosis.json` — redacted, safe to share. |
| `issue-reporter` | Analyzes probe results + trajectory diagnosis, files ONE focused Forgejo issue describing the highest-impact failure to fix next. Also writes a wiki page for iteration history. |
| `developer` | Picks up an open issue, implements the fix on a branch, opens a PR. |
| `reviewer` | Reviews a PR — approves+merges if clean, requests changes otherwise. |
| `dev-quality-reviewer` | Optional self-check before push — runs static check + rubric scoring. |

## Available scripts

```bash
# Current Forgejo repo state (issues + PRs)
python3 ~/.skillhone/skills/skillhone/scripts/status.py

# Structured failure analysis (redacted, safe output)
python3 ~/.skillhone/skills/skillhone-optimization/scripts/analyze_probe.py _data/probe_result.json

# Render durable observation markdown for Forgejo wiki
python3 ~/.skillhone/skills/skillhone-optimization/scripts/write_observation.py --probe _data/probe_result.json --title "Iteration-N-Observation"

# Forgejo summary (issues, PRs, wiki pages)
python3 ~/.skillhone/skills/forgejo/scripts/summary.py
```

## Goal

Make one improvement per cycle that raises the probe score. Key principles:

- **Diagnose before fixing.** Understand which harness layer failed:
  infrastructure, solver execution, compiler/validator, verifier design, or
  skill instructions. `probe_result.json` alone is often insufficient.
- **Use trajectory as runtime evidence.** Solver trajectories explain missing
  files, tool errors, script crashes, permission problems, and loops. They are
  not gold answers; redacted patterns are safe improvement signals.
- **Use compiler feedback for artifact tasks.** If the task output is compiled,
  parsed, rendered, type-checked, tested, or schema-validated, inspect failed
  artifacts in the eval workdir and run the relevant task-local compiler/audit
  command before filing an issue. Do not ask the developer to infer failures
  from pass/fail alone when stderr or validator diagnostics exist.
- **Persist observations to Forgejo wiki.** Local `_data/*.json` files are
  intermediate artifacts. Every iteration should leave a Forgejo wiki
  observation page containing probe summary, trajectory diagnosis, compiler
  diagnosis, and the issue/PR action taken. This is part of SkillHone's
  observation advantage.
- **Name score provenance.** A full harness run may contain baseline, internal
  iteration, PR-validation, and final re-score results. Wiki pages and issues
  should say which score JSON/workdir/split produced the number instead of
  mixing them into one unlabeled score.
- **Explore when it changes the solution space.** Community tools and local
  reference skills are useful when the skill lacks an approach, not when the
  failure is already explained by harness diagnostics.
- **One PR per cycle.** Stacking multiple fixes makes attribution impossible.
- **Track history.** Check what's already been tried (closed issues, wiki pages) to avoid repeating failed approaches.
- **Land changes via PR.** Never push directly to main.

## Constraints

- **Do not edit code yourself.** Delegate to `developer`.
- **Never leak test data.** No gold answers or full eval questions in issues, PRs, or wiki.
- **Use the VCS backend skill.** For issues, PRs, wiki pages, repo metadata, or
  reviews, call the loaded backend skill scripts such as
  `~/.skillhone/skills/forgejo/scripts/*.py`. Do not call Forgejo/GitLab/Gitea
  REST APIs directly with `curl` or handcrafted HTTP.
- **Never print credentials.** Do not `cat` `_data/forgejo_config.txt`,
  `~/.skillhone/settings.json`, `identities.conf`, or environment variables that
  may contain tokens/API keys. Backend scripts read credentials themselves and
  redact logs.
- **Subagents are auto-discovered.** Use the Agent/Task tool — it loads subagent prompts automatically.
- **If there's an open PR from a previous iteration**, handle that first (dispatch reviewer) before starting a new cycle.

## Key insight: infrastructure vs skill failures

probe_result.json's `error` field only captures timeouts. It CANNOT tell you about:
- API rate limiting (HTTP 429/403) causing search failures
- Agent calling wrong tool names
- Script crashes with exit code 1

The `trajectory-analyzer` reads raw solver logs and categorizes these. If you see many "wrong_answer" failures, always check trajectory diagnosis first — the real cause might be search infrastructure, not reasoning.

## Key insight: compiler feedback is improvement signal

For compiler-like artifact tasks, the highest-signal evidence is often not the
score but the compiler/validator message. Examples:

- Mermaid renderer parse errors identify the exact invalid syntax class.
- LaTeX logs identify missing packages, undefined commands, or overfull boxes.
- TypeScript/pytest output identifies missing imports, type errors, or failing
  assertions.
- Schema validators identify missing fields and invalid enum values.

When probe failures include produced artifacts, collect a small redacted
compiler diagnosis and pass that to `issue-reporter` and `developer`. The
developer should receive the failure pattern ("subgraph labels used node-shape
syntax", "missing answer.mmd", "off-palette fill color") rather than raw hidden
eval data.

## Key insight: artifact must compile before PR / before submit

When the task output is something a public, globally-available toolchain
compiles, parses, type-checks, or renders (Mermaid via `mmdc`, Rust via
`rustc`, LaTeX via `pdflatex`, JSON Schema via a validator, TypeScript via
`tsc`, …), running that tool on the artifact before submitting is basic
engineering hygiene. The optimizer must enforce it on **two** sides:

1. **Solver side (SKILL.md instruction).** Tell the solver to invoke the
   public compiler/CLI on its own draft inside its workdir before writing
   the final artifact. We are not asking for runtime correctness — only
   that the artifact parses/compiles cleanly. If the tool exits non-zero or
   emits errors, the solver repairs and re-runs. A solver that submits an
   artifact it never tried to compile is shipping unverified output.
2. **Developer subagent side (PR self-check).** When the `developer`
   produces a SKILL.md change or a script change, it must run the same
   public toolchain against a freshly drafted sample artifact before
   opening the PR. No green local compile = no PR.

The compiler/CLI in question is **public infrastructure** — `mmdc`, `rustc`,
`pdflatex`, `tsc`, `jq`, etc. — installable from package managers, runnable
by any user, and unrelated to the eval repo. You never look inside the
eval repo for tools or rules; you use the same toolchain anyone shipping
this artifact type would use.

Common signals that this layer is missing:

- `no_answer_produced` failures, or scoring runs that report parse errors
  on artifacts the solver thought were fine.
- Pass-rate plateaus where the same compiler error keeps appearing in
  trajectory diagnosis across iterations, even though the failure mode has
  already been flagged in a prior iteration's wiki observation.

The fix is a SKILL.md change (and a `developer` self-check), not a new
workflow rule and not anything that touches the eval repo. The solver and
the developer simply both run the public compiler before declaring done.

**Anti-pattern: do not invent a new validator script.** If the task type has
a standard CLI (Mermaid → `mmdc`, Rust → `rustc`/`cargo check`, LaTeX →
`pdflatex`, TypeScript → `tsc --noEmit`, JSON Schema → `ajv`/`jq`), use it
directly. Do not write a new `scripts/validate_*.py` that re-implements
checks the eval audit already does. A custom validator drifts from the
real grader, tends to be over-strict, and has caused observed regressions
(score crash, then revert). If the standard CLI is not on PATH, install it
via the language's package manager once at the top of the SKILL.md
workflow (`npx -p @mermaid-js/mermaid-cli mmdc ...`,
`cargo install --quiet ...`, etc.) — the skill stays portable.

## References (load when needed)

- [references/iteration_patterns.md](references/iteration_patterns.md) — common failure→fix patterns
- [references/skill_structure.md](references/skill_structure.md) — what clean SKILL.md looks like
- [references/config.md](references/config.md) — settings.json fields
- [references/explore/skillhub.md](references/explore/skillhub.md), [references/explore/clawhub.md](references/explore/clawhub.md), [references/explore/local.md](references/explore/local.md) — search engines and local discovery patterns for the `explorer` subagent
