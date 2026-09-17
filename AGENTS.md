# Agent Guide

This repository provides skills for running a SkillHone optimization project.
Use this file to decide which bundled skill to load and how to sequence the
workflow. Installation and environment setup live in
`docs/install/developer.md`; do not load that file unless setup is actually
needed.

## Pick The Right Skill

- Use `skills/skillhone/` when the user wants to inspect Issues, PRs, Wiki work
  records, repair trajectories, or completed optimizations, or manage a local
  skill repair.
- Use `skills/skillhone-auto-optimization/` when normal Agent execution exposes
  a reproducible defect in a skill and should create/reuse an Issue in that
  Git repository before dispatching a focused repair into a local PR.
- Use `skills/skillhone-benchmark-optimization/` when the user wants the
  evaluation-driven paper workflow: freeze a separate eval repository, measure
  probe/PR-validation splits, and select a Skill improvement by score.
- Use `skills/skillhone/scripts/quality/` for static checks and rubric review of
  a skill directory.
- Use the TypeScript `skillhone` CLI (`src/cli.ts`, built as `dist/cli.js`) for
  the runtime-neutral local Issue/PR/Run/Wiki workflow and Web workbench.

## Typical Optimization Flow

1. Confirm the target skill Git repository.
2. Inspect local Issue/PR/Wiki state with `skillhone status`.
3. Read only the relevant skill instructions, starting with `skills/skillhone/SKILL.md`.
4. Reproduce the defect with a focused public or hidden repository test.
5. Create or reuse one local Issue with sanitized evidence.
6. Let the saved trigger policy dispatch DeepSeek Harness without per-Issue
   confirmation. For the default queued policy, run `skillhone --repo <path>
   dispatch` and consume the repository queue serially.
7. Review the local PR, changed files, commits, tests, linked trajectory, and Wiki record.
8. Merge only after explicit confirmation; never push automatically.

When the user supplies a target Skill repository path, that path is
authoritative for status, duplicate detection, Issues, Runs, PRs, and Wiki. Do
not redirect work to a same-name or byte-identical catalog repository.

The runtime-maintenance flow does not require a separate evaluation repository.
Load the Benchmark skill only when the user explicitly asks for benchmark work.

The runtime-defect rule applies to every target Skill, not only to files in the
SkillHone source repository. When an Agent finds a missing referenced file, a
failing repository test, or another reproducible defect—especially below
`~/.skillhone/skills/`—it must invoke `skillhone-auto-optimization` before
editing implementation files or installing dependencies. The reporting Agent
may add only a focused `.test/` reproduction before creating/reusing the Issue.
If Harness is unavailable, record the Issue and report the blocker; never repair
the target directly on `main` as a fallback.

For benchmark work, keep the two repositories distinct: the Skill repository
owns code and local PRs, while the evaluation repository owns frozen datasets
and verifier logic. Never copy raw eval items or derived benchmark tests into
the Skill repository, Issues, or Harness prompts. The Skill repository's
`.test/` directory belongs to the fast runtime-defect path, not the full
Benchmark path.

## Data Boundaries

- Treat eval/test data as private to the evaluator. Do not copy gold answers or
  full hidden eval questions into skill instructions, issues, PRs, or README.
- Put redacted summaries in Issues; keep raw traces in local run artifacts.
- Do not add task-specific datasets, private infrastructure, private model
  names, or company-specific examples to reusable SkillHone skills.

## When Editing This Repository

- Keep `README.md` short and user-facing.
- Keep setup commands in `docs/install/developer.md`.
- Avoid committing generated files such as `__pycache__/`, `.pyc`, logs, run
  outputs, local config, or local upstream skill copies.
- Before committing, run focused checks for touched scripts and inspect
  `git status --short --untracked-files=all`.
