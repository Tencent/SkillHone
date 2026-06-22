---
name: skillhone-evaluation
description: >
  Run and interpret skill evaluations. Use when you need to evaluate a skill,
  run probe/test/PR-val, check if a PR regresses quality, compare two versions,
  or diagnose why the score dropped. Handles the full eval lifecycle including
  solver trajectory diagnosis for tool-level error detection.
---

# SkillHone Evaluation

Run evaluations and diagnose results to inform improvement decisions.

## Evaluator Harness Model

The evaluator is not just a scorer. It is a harness that runs the skill against
private tasks and leaves a structured evidence trail:

- **Input**: a skill checkout plus an eval repo containing datasets, verifier
  logic, task contract, and optional compiler/audit helpers.
- **Execution**: each eval item runs in an isolated solver workdir. The solver
  may create files, call scripts, and write the required artifact.
- **Verification**: the eval repo verifier scores the produced answer and may
  call task-local validators, compilers, parsers, renderers, or audit helpers.
- **Output JSON**: aggregate score plus redacted per-item trace summaries.
- **Workdir evidence**: `trajectory.jsonl`, produced artifacts, and stderr-like
  signals that explain failures the score cannot explain.

This separation matters. A low score may come from weak skill instructions, but
it may also come from missing files, tool crashes, invalid compiled artifacts,
over-strict verifier rules, or infrastructure errors. Evaluation work is about
mapping the failure to the correct harness layer.

On Forgejo-backed repos, `status.py` is a read-only context check before PR
validation or merge decisions:

```bash
python3 ~/.skillhone/skills/skillhone/scripts/status.py
```

## Core capability: eval.py

```bash
# Probe — fast iteration signal
python3 ~/.skillhone/skills/skillhone/scripts/eval.py \
  --skill-dir /path/to/skill --eval-dir /path/to/eval-repo \
  --split probe --output _data/probe_result.json

# Test — final benchmark (NEVER during iteration)
python3 ~/.skillhone/skills/skillhone/scripts/eval.py \
  --skill-dir /path/to/skill --eval-dir /path/to/eval-repo \
  --split test --output test_result.json
```

The output JSON includes a `"workdir"` field pointing to solver working
directories (e.g. `/data/tmp/eval_agent_xyz/`) containing `trajectory.jsonl`
files and produced artifacts for deeper diagnosis.

## Subagents

| Subagent | What it does |
|----------|-------------|
| `trajectory-analyzer` | Reads `workdir/work_<uid>/trajectory.jsonl` files to diagnose tool errors (rate limits, wrong tool calls, script crashes). Outputs redacted `_data/trajectory_diagnosis.json` safe to share with improver. |
| `pr-quality-reviewer` | Merge gate for skill PRs — runs static check + rubric scoring, posts PR comment, returns APPROVE/REQUEST_CHANGES. |

## Trajectory Diagnosis

`probe_result.json` captures scores and some error categories, but it is only
the top of the evidence trail. It cannot fully explain runtime behavior such as:

- Wikipedia API rate limiting (HTTP 429/403)
- Agent calling `web_search` directly instead of `Bash("python3 scripts/web_search.py ...")`
- Script crashes (exit code 1 with traceback)
- The solver never writing the required artifact
- The solver writing a file in the wrong location

The `trajectory-analyzer` subagent fills this gap by reading raw solver logs. Its output distinguishes **infrastructure failures** (fix scripts/config) from **skill failures** (fix SKILL.md). This distinction is critical for avoiding wasted iterations.

## Compiler Feedback Diagnosis

Some artifact tasks are compiler-like: Mermaid, LaTeX, TypeScript, Python tests,
SQL parsers, JSON/YAML schema validators, browser renderers, and similar tools
produce actionable stderr or diagnostics. Do not reduce these failures to
`wrong_answer`.

When a failed trace produced an artifact, inspect the solver workdir from the
`workdir` field and run the task-local compiler, validator, renderer, or audit
helper on that artifact. Prefer commands and helpers shipped by the eval repo or
described in its README/contract; if none exist, use the standard local compiler
for that artifact type. Capture only concise, non-gold diagnostic summaries:

- compiler/parser command used
- first error line and location, if available
- failed rule name or failed score key, if available
- artifact-level pattern, e.g. "invalid Mermaid subgraph syntax" or "missing
  answer file"

Write this as `_data/compiler_diagnosis.json` or include it in the existing
diagnosis file. It is safe to share with the improver when it contains only
error messages, failed score names, and artifact snippets needed to identify the
syntax class; do not include gold answers or full eval questions.

If the task-local verifier already exposes detailed failed score keys, preserve
those names. They are usually better improvement signals than a rewritten
natural-language summary.

## Interpreting scores

| Field | Meaning |
|-------|---------|
| `score` | pass rate (0.0–1.0) |
| `avg_duration_s` | efficiency; rising duration with flat score = looping/waste |
| `traces[].error` | "hard timeout", "agent_process_error", or empty |
| `workdir` | path to solver trajectories for deeper analysis |

**Decision thresholds:**
- `≥ +0.02` → real improvement
- `±0.02` → noise, don't claim improvement
- `≤ −0.04` → regression, revert

## Score Provenance

Always label which harness run produced a score. In a full SkillHone run there
may be several valid scores: baseline probe, iteration probe, PR validation, and
a final driver re-score after the master agent exits. These can differ because
they may use different skill checkouts, regenerated eval data, or output paths.

When writing issues, PR comments, wiki observations, or user summaries, cite the
score source in words: split, output JSON path if available, workdir if useful,
and whether it is an internal iteration score or final harness score. Do not
collapse multiple scores into one number without naming the source.

## Splits and data visibility

| Split | Purpose | Who sees |
|-------|---------|----------|
| `probe` | Iteration signal | orchestrator (redacted traces) |
| `pr_val` | PR merge gate | orchestrator (aggregate only) |
| `test` | Final benchmark | orchestrator only, NEVER during iteration |

## Constraints

- Never run `test` during iteration — it contaminates the final benchmark.
- Never forward gold answers or full questions to the improver.
- Never pass the eval repo path to the iterating agent.
- trajectory_diagnosis.json is fully redacted (uid + counts only) — safe to share.

## Reference

- [references/scoring.md](references/scoring.md) — error category catalog, match rules, close-but-not-credited cases
