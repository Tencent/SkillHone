---
name: skillhone
description: >
  SkillHone — toolkit for evaluating, optimizing, and managing agent skills.
  Use when asked to "evaluate a skill", "run probe", "optimize/iterate a skill",
  "create a new skill experiment", "seed a skill repo", or "run skill benchmarks";
  also use when the user mentions a Forgejo-hosted skill repo and wants to
  measure or improve its quality. Wraps standalone scripts: status, eval,
  optim, new, seed, serve, synth.
compatibility: Requires Python 3.10+, git, and access to a Forgejo instance (or local FS).
---

# SkillHone

SkillHone is a measurement harness plus an optimization toolkit for agent
skills. The important abstraction is not a fixed workflow; it is the evidence
trail created when a skill is run against private eval tasks.

The harness has these layers:

- **Skill repo**: public behavior to improve (`SKILL.md`, scripts, references).
- **Eval repo**: private measurement contract (datasets, verifier, synthesis
  contract, task-local validators).
- **Solver workdirs**: isolated per-item sandboxes containing artifacts and
  `trajectory.jsonl`.
- **Observation records**: redacted probe results, trajectory diagnosis,
  compiler/validator diagnosis, issues, PRs, and wiki pages.

When improving a skill, identify which layer explains the failure before
changing code. A score drop may point to skill instructions, but it can also be
a harness, verifier, compiler, artifact-path, or infrastructure problem.

Standalone scripts live under `scripts/`. Pick one based on the task in front of you.

Before starting a diagnosis, development, PR review, merge, or optimization cycle on a Forgejo-backed repo, run `scripts/status.py` so you know the current issue/PR state and do not duplicate work or merge the wrong PR.

## Eval Synthesis Contract

When creating or synthesizing eval data, the task spec / README is the source of
truth for both prompts and verification. Do not generate verifiers that only
check the gold answer if the task spec also requires observable output
properties.

If the README says the answer must have a format, file, syntax, parser/compile
success, render success, required section, count range, banned token, fixed
style token, palette, local-only dependency, or other deterministic acceptance
criterion, include a corresponding `scores` key in the verifier. This applies
whether you use `skillhone-synthesis` or write a small generation script by
hand.

Subjective requirements may be approximated by deterministic proxies. Truly
uncheckable preferences should be noted as unverified, not silently ignored.

## Scripts

| Script | Use when the user asks to... | Details |
|--------|-------------------------------|---------|
| `scripts/status.py` | inspect the current Forgejo repo's issue/PR state before acting | [references/cli.md](references/cli.md) |
| `scripts/eval.py` | run a probe / test evaluation on a skill, get a score | [references/evaluation.md](references/evaluation.md) |
| `scripts/optim.py` | iterate on / optimize / auto-improve a skill | [references/optim.md](references/optim.md) |
| `scripts/new.py` | create a new skill+eval repo pair (a new experiment) | [references/cli.md](references/cli.md) |
| `scripts/seed.py` | scaffold SKILL.md / scripts/ for an empty skill repo | [references/seed.md](references/seed.md) |
| `scripts/synth.py` | synthesise a probe split into the eval repo (calls into `skillhone-synthesis`) | [references/cli.md](references/cli.md) |
| `scripts/serve.py` | listen for Forgejo webhooks (PR/issue/push) | [references/cli.md](references/cli.md) |
| `scripts/quality/static_check.py` | validate skill structure and script discoverability | [references/quality_scoring_rubric.md](references/quality_scoring_rubric.md) |

Load the relevant reference file only when you're about to run that specific script. Do not load them up front.

## Upstream binding & sync

The `skillhone` skill is bound to **<https://github.com/Tencent/SkillHone>**;
the repository is the actual implementation. When the skill is delivered
through a hub (SkillHub, an internal mirror, any `agentskills.io`-protocol
runtime), the SKILL.md alone is not enough — the runtime has to pull the
full upstream repository before the harness scripts can run.

Follow [`references/upstream.md`](references/upstream.md) whenever you need to:

- **Install for the first time** — `~/.skillhone/skills/` is empty.
- **Refresh / update / pull latest** — refresh existing skill folders.

Both run the same idempotent procedure (shallow clone + `cp -R` into
`~/.skillhone/skills/<skill>/`). Settings, run history, and the cache stay
untouched.

## Quick examples

```bash
# Status — read-only dashboard of Issues + PRs for the current Forgejo repo
python3 scripts/status.py

# Evaluate — runs probe split, writes result.json
python3 scripts/eval.py --skill-dir ./my-skill --eval-dir ./my-skill-eval \
                        --split probe --output result.json

# Optimize — agent-driven loop (5 iters, stop after 2 with no gain)
python3 scripts/optim.py --repo http://forgejo/skillhone/my-skill.git \
                         --iters 5 --patience 2

# New experiment — creates skill-repo + eval-repo on Forgejo
python3 scripts/new.py deep-research \
                       --instruction README.md --data-dir ./data --no-run

# Seed an empty skill — generate SKILL.md from a brief
python3 scripts/seed.py --repo http://forgejo/skillhone/my-skill.git

# Webhook listener
python3 scripts/serve.py --port 8790
```

## Gotchas

- **`~/.skillhone/settings.json` is required** before any script runs. It holds the Forgejo URL/token and three model profiles: `improver` (drives `optim.py`), `executor` (runs the skill under eval), and optional `synthesis` (used by `synth.py`). See [references/configuration.md](references/configuration.md).
- **Start with `scripts/status.py` on Forgejo repos.** It is read-only and shows the open/closed Issue and PR state for the current repo; use it before creating issues, developing fixes, reviewing PRs, or merging.
- **`scripts/eval.py` never writes to the skill repo** — it reads SKILL.md and writes a JSON result. Safe to run read-only.
- **`scripts/optim.py` spawns subagents** (issue-reporter → developer → reviewer) via the Agent tool. Do *not* add `Agent` / `Task` to `disallowed_tools` in `settings.json.improver` or the loop will no-op.
- **Eval repo must stay private.** The optimizing agent must never see it. `optim.py` only passes the skill repo path + a redacted probe result into the loop.
- **Probe ≠ test.** A probe improvement does not guarantee a test improvement. See `references/evaluation.md` → "Probe vs Test".
- **All state lives under `~/.skillhone/`** (logs, run artifacts, workspaces). Override with `$SKILLHONE_HOME`.

## How this skill composes

```
skillhone-prd   →  skillhone-synthesis  →  skillhone  →  skillhone-evaluation  →  skillhone-optimization
(spec the PRD)     (generate eval data)    (eval/optim)    (score + diagnose)       (optimize via PR)
```

`skillhone` is the orchestrator entry point; evaluation and optimization skills
are loaded on demand inside `optim.py`'s agent loop. VCS operations are provided
by a separate backend skill such as `forgejo`.

## Orchestration: "synthesise and optimise a skill from <PRD>"

When the user asks to "synthesise and optimise a skill from `<path/to/PRD.md>`"
(typical phrasing for the worked examples under `examples/`), run the four
scripts below in order. The contract is one persistent skill repo + one
private eval repo on Forgejo, with a regression-aware synth step gating the
expensive optim phase.

1. **`scripts/new.py <skill-name> --instruction <PRD.md>`**
   Creates the public `<skill-name>` and private `<skill-name>-eval` repos
   on Forgejo. Auto-redacts the PRD's `## ...Evaluation/Verifier/Scoring/
   Rubric...` section so the public README never exposes the grading rubric
   to the improver. The unredacted PRD lands in the eval repo.

2. **`scripts/seed.py --repo <skill-url>`**
   Reads the redacted public README, generates a real (but unoptimised)
   `SKILL.md` plus minimal scaffolding, and commits as the seed point. This
   is the baseline the synth-stage regression scores against — without a
   real seed, the regression is meaningless. Skip this step ONLY when the
   PRD has no `## 3.5 Synth-stage acceptance gate` and you are intentionally
   running an old-style single-shot synth.

3. **`scripts/synth.py --repo <skill-url> --target 10 --splits probe ...`**
   Synthesises `probe.jsonl` from the eval-side PRD. When the PRD declares
   a synth-stage acceptance gate (§3.5 in the worked examples), pass
   `--target-pass-rate-max <X> --max-resynth <N>` (typical: `0.30` and `3`)
   so synth runs `eval.py --mode seed --split probe` after each draft and
   redrafts when the seed solves more than X of the probes. Each iteration's
   observations are written to the eval repo's `synthesis_observations/`
   directory and pushed alongside the final `probe.jsonl`. Without these
   flags, synth is single-shot (the historical behaviour).

   > **Synth is optional.** If you already have a curated eval set (golden
   > items from a benchmark, hand-written probes, an exported test bank,
   > etc.), skip `synth.py` entirely and push your own `probe.jsonl`
   > (and optionally `test.jsonl`) directly into the eval repo. The
   > format the rest of the harness expects is documented in
   > [`references/evaluation.md`](references/evaluation.md). As long as
   > the verifier contract is satisfied, `optim.py` does not care whether
   > the data came from `synth.py` or `git push`.

4. **`scripts/optim.py --repo <skill-url> --iters 3 --patience 2`**
   The agent-driven PR loop: diagnose probe failures → file Issue → land
   focused PR → re-evaluate → write `Iteration-N-Observation` wiki page.
   Each merged PR is one atomic skill change.

Skip steps 2 + 3's `--target-pass-rate-max` only for prototype runs where you
explicitly want to see what synth produces without a regression gate. For any
example whose PRD includes §3.5, skipping the gate defeats the point.

## References (load on demand)

- [references/evaluation.md](references/evaluation.md) — `eval.py` CLI, output JSON schema, solver architecture. Read before running `eval.py` or interpreting `result.json`.
- [references/optim.md](references/optim.md) — `optim.py` loop, subagent roles, stop conditions. Read before running `optim.py`.
- [references/seed.md](references/seed.md) — original SkillHone seed scaffold and validation rules. Read before running `seed.py`.
- [references/quality_scoring_rubric.md](references/quality_scoring_rubric.md) — rubric used by quality reviewers.
- [references/configuration.md](references/configuration.md) — `~/.skillhone/settings.json` schema, directory layout, env vars. Read on first setup or when the user asks "where do I configure X?".
- [references/cli.md](references/cli.md) — flag-by-flag reference for every script. Read when a user asks about a flag you're not sure about.
