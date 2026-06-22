# Agent Guide

This repository provides skills for running a SkillHone optimization project.
Use this file to decide which bundled skill to load and how to sequence the
workflow. Installation and environment setup live in
`docs/install/developer.md`; do not load that file unless setup is actually
needed.

## Pick The Right Skill

- Use `skills/skillhone/` when the user wants to evaluate, seed, create, or
  optimize a skill repository.
- Use `skills/skillhone-synthesis/` when the user needs closed-form benchmark
  Q/A data generated from tools or a live environment.
- Use `skills/skillhone-prd/` when the user needs a PRD or task specification
  before building a skill/eval pair.
- Use `skills/skillhone-optimization/` inside an optimization loop to diagnose
  failures, create issues, implement focused fixes, and review PRs.
- Use `skills/skillhone-evaluation/` when reviewing probe/test trajectories or
  scoring the quality of an iteration.
- Use `skills/skillhone/scripts/quality/` for static checks and rubric review of
  a skill directory.
- Use `skills/forgejo/` when you need the Forgejo backend for issues, pull
  requests, wiki pages, repos, or branches. Keep it independent so another VCS
  backend skill can replace it.

## Typical Optimization Flow

1. Confirm the target skill repo and eval repo.
2. Inspect the current Forgejo issue/PR state with `skills/skillhone/scripts/status.py`.
3. Read only the relevant skill instructions, starting with `skills/skillhone/SKILL.md`.
4. Run a probe evaluation with `skills/skillhone/scripts/eval.py`.
5. Diagnose failures using probe output and, when needed, trajectory analysis.
6. Use the improvement workflow to make one focused change per iteration.
7. Re-run probe evaluation and compare against the previous result.
8. Land changes through the git/PR workflow used by the project.

If the user has no eval data yet, create or synthesize it first. Do not start
optimizing against vague success criteria.

## Data Boundaries

- Treat eval/test data as private to the evaluator. Do not copy gold answers or
  full hidden eval questions into skill instructions, issues, PRs, or README.
- Put redacted summaries in issues and wiki pages; keep raw traces in run
  artifacts.
- Do not add task-specific datasets, private infrastructure, private model
  names, or company-specific examples to reusable SkillHone skills.

## Seed Boundary

`skillhone seed` uses SkillHone's own scaffold. Do not add external skill
authoring packages or copied third-party skill contents to this repository.

## When Editing This Repository

- Keep `README.md` short and user-facing.
- Keep setup commands in `docs/install/developer.md`.
- Avoid committing generated files such as `__pycache__/`, `.pyc`, logs, run
  outputs, local config, or local upstream skill copies.
- Before committing, run focused checks for touched scripts and inspect
  `git status --short --untracked-files=all`.
