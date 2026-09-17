---
name: skillhone-benchmark-optimization
description: Run the additional paper-compatible optimization workflow with a frozen benchmark repository. Use only when the user asks to generate or reuse an eval set, establish a baseline, improve probe or PR-validation scores, compare a Skill against a benchmark, or reproduce the evaluation loop described in the SkillHone paper. Do not use for a single defect observed during normal Agent work; use skillhone-auto-optimization for the default path.
---

# SkillHone Benchmark Optimization

Use this additional workflow when the user explicitly wants a frozen evaluation
dataset to discover which Skill failure to fix next. It is not a prerequisite
for proactive maintenance. It feeds another evidence source into the same
Issue-driven SkillHone review system:

- the Skill and Eval repositories are two distinct Git repositories;
- the Skill repository owns the files that may be changed and reviewed;
- the Eval repository exclusively owns `probe`, `pr_val`, `test`, verifiers,
  gold answers, and raw results;
- DeepSeek Harness edits only the Skill repository;
- the most frequent redacted failure category becomes a normal local Issue;
- aggregate evaluation gates live in SkillHone's local state, outside Git;
- the selected result is an Issue-linked branch, PR, and Wiki record;
- push is always forbidden; merge follows the same saved `review` or
  test-gated `automatic` policy as the fast path.

Do not copy a Benchmark item or a derived executable test into the Skill
repository's `.test/` directory. `.test/` is for the default fast path, where a
small defect observed during normal Agent work needs a visible repository
regression. In this full Benchmark path, the evaluator remains the only holder
of the evaluation contract.

## 1. Prepare the evaluation repository

Use a trusted evaluation repository supplied by the user. The repository must
be committed and clean before it is registered. It contains:

- `probe.jsonl` for iteration feedback;
- optional `pr_val.jsonl` for candidate selection;
- optional `test.jsonl` for one held-out final measurement;
- an evaluator command that writes a JSON result containing `score` or
  `pass_rate`.

Do not generate or revise evaluation data after seeing candidate results. If
the evaluation contract changes, commit it and initialize a new campaign.

## 2. Freeze the campaign

From the Skill repository:

```bash
skillhone benchmark init --eval-repo /path/to/my-skill-eval
skillhone benchmark status
```

The default compatibility runner is:

```text
python3 evaluator/eval.py --skill-dir {skill} --dataset-dir {eval} --split {split} --output {output}
```

Use `--runner` only when the evaluation repository exposes another command.
The command must accept the `{skill}`, `{split}`, and `{output}` placeholders;
`{eval}` is also available.

## 3. Measure and optimize

```bash
skillhone benchmark run --split probe
skillhone benchmark optimize --min-improvement 0.02
```

`benchmark optimize` runs a baseline probe, records the most frequent redacted
failure pattern as one Issue, and runs a separate Harness Explorer. The Explorer
checks whether the current Skill actually implements the capabilities it names,
searches community registries such as SkillHub for relevant Skills, and downloads
reference copies into private scratch space under `.git/` for inspection. The
repair Harness independently re-fetches the selected reference, reviews its
license and files, and may adapt useful instructions, scripts, and references
into one generalizable revision of the complete Skill bundle. Downloaded
reference repositories themselves are never committed. SkillHone then reruns the
same frozen probe outside the optimizer. When `pr_val.jsonl` exists, its baseline is
measured up front, but only candidates that first pass the probe-improvement
gate spend the private PR-validation split; a regression larger than two points
blocks selection. SkillHone records only
aggregate gate results in local state. A selected candidate becomes an
Issue-linked local branch and PR.

The optimizer receives the probe questions because they are the reproducible
iteration feedback in the original SkillHone loop. Read every valid, non-empty
question row in file order by default; do not sample or impose an implicit row
or global character limit. Redaction still applies. Never show it probe gold
answers or verifier code, any `pr_val`/`test` questions, result files, or the
evaluation repository path.

Do not reduce this workflow to rewriting `SKILL.md`. The paper workflow evolves
the full portable bundle. When the seed Skill lacks a real search implementation,
the expected optimization is to discover reviewed search Skills and adapt the
smallest portable scripts/references needed to make the declared procedure
executable. Unreviewed downloaded code is never run directly.

## 4. Final measurement and review

Run the held-out split only after iteration is finished:

```bash
skillhone benchmark run --split test
skillhone pr list
skillhone pr view <N>
```

Do not use `test` to choose edits. Do not merge or push automatically. Review
the Skill diff, public checks, frozen eval commit, probe delta, and PR-validation
delta before asking the user whether to merge.

## Boundaries

- A runtime defect and a benchmark-discovered failure both create or reuse an
  ordinary repository-local Issue; only their evidence source differs.
- Benchmark files remain in the separate Eval repository. Only probe question
  text is supplied transiently to the optimizer; verifier code, gold answers,
  `pr_val`/`test` inputs, and raw results are never provided.
- The Skill repository stores only Skill changes. Sanitized Issue text and
  aggregate evaluation gates live in SkillHone's repository-scoped local state,
  not in the Skill Git tree.
- Raw evaluation outputs stay in private SkillHone state and are never returned
  by the Web API.
- Eval runner processes are explicit local commands and may execute verifier
  code, so only register a trusted evaluation repository.
