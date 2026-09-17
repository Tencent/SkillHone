# Additional Benchmark workflow

This is the paper-compatible path for users who already have or want to build a
dataset. It is an additional feature, not the default SkillHone workflow. For
ordinary maintenance, let the working Agent record a reproducible Issue and use
the shorter Issue-to-PR loop.

The Benchmark workflow starts from a user-provided dataset and keeps the
Skill/Eval organization used in the SkillHone paper. The bundled Skill and
Harness prompt enforce what is shared with the optimizer.

Full mode always uses two distinct Git repositories:

```text
Skill repository                       Eval repository
SKILL.md, scripts, references          probe.jsonl, pr_val.jsonl, test.jsonl
repair branch and reviewed diff        evaluator, verifiers, gold answers
                 ^                     raw traces and results
                 | probe questions + aggregate, redacted feedback
                 +--------------------- evaluator runs outside the optimizer
```

DeepSeek Harness receives the Skill repository, the probe questions used for
iteration, and aggregate redacted feedback. It does not receive the Eval
repository path, probe gold/verifier data, held-out `pr_val`/`test` inputs, or
raw result files. A Benchmark test is never copied into the Skill repository's
`.test/` directory.

Harness runs in a temporary Git clone whose parent contains no Eval repository
and whose Git remote is removed. Only a clean committed candidate is imported
back into the real Skill branch. This prevents accidental sibling discovery;
it is not container- or VM-grade isolation against an adversarial local
process, because DSH's native sandbox governs file effects rather than all
filesystem reads.

## Prepare and freeze the Eval repository

Reuse an existing SkillHone Eval/Evo repository or provide another trusted
evaluator. The repository must be clean and committed. It contains
`probe.jsonl`; `pr_val.jsonl` and `test.jsonl` are optional. All evaluator and
dataset changes must be committed before registration.

```bash
cd /path/to/my-skill
skillhone benchmark init --eval-repo /path/to/my-skill-eval
skillhone benchmark status
```

`init` pins the Eval Git commit and fingerprints every registered split. A
dirty worktree, changed commit, changed JSONL file, missing `probe.jsonl`, or an
Eval path that resolves to the Skill repository aborts the campaign.

The compatibility runner for earlier SkillHone Eval repositories is:

```text
python3 evaluator/eval.py --skill-dir {skill} --dataset-dir {eval} --split {split} --output {output}
```

Another trusted evaluator can be registered explicitly:

```bash
skillhone benchmark init \
  --eval-repo /path/to/my-skill-eval \
  --runner 'node evaluator.mjs --skill {skill} --split {split} --output {output}'
```

The runner executes outside DeepSeek Harness. Its output JSON must contain a
`score` or `pass_rate` between 0 and 1.

## Measure and optimize

```bash
skillhone benchmark run --split probe
skillhone benchmark optimize --min-improvement 0.02
```

The full optimization loop is:

1. Measure the frozen `probe` baseline and, when present, the `pr_val` baseline.
2. Create one repository-local Issue from aggregate counts and redacted failure
   categories. Raw examples remain Eval-side.
3. Run a separate read-only Harness Explorer against the public Skill, visible
   probe questions, public Agent Skills, and primary documentation. Candidate
   Skills must report source revision, license, required tools, and whether they
   contain executable code. Explorer cannot edit the Skill or access Eval-side
   answers, validators, `pr_val`, or `test`.
4. Give DeepSeek Harness the public Skill repository, reproducible probe
   questions, and the redacted observation, then request one generalizable
   improvement. A repair may adapt a reviewed prompt-only Skill that uses
   existing native tools, but never executes downloaded code or installs its
   dependencies. Probe gold/verifier data and held-out inputs remain private.
   By default, SkillHone reads every valid, non-empty probe question in file
   order without sampling, a row-count limit, or a global character limit;
   redaction still applies.
5. Run the same frozen evaluator separately against the candidate. A candidate
   that misses the probe-improvement gate is rejected immediately without
   spending the private `pr_val` split.
6. Record aggregate probe and PR-validation gates in SkillHone's local SQLite
   state; no Benchmark contract is committed to Skill Git.
7. Create an Issue-linked local PR only when the probe gain reaches the chosen
   threshold and PR validation does not regress by more than two points.

A non-selected branch stays linked to its Issue and receives a Wiki work
record, but no PR is created. Neither path pushes or merges.

## Final held-out measurement

`benchmark optimize` never reads `test`. Run the held-out split once, after
iteration and candidate selection are complete:

```bash
skillhone benchmark run --split test
```

Do not use that result to choose another edit. If the evaluation contract must
change, commit the new Eval state and initialize a new campaign.

## Fast mode versus full mode

| Mode | Evidence | Repository boundary |
|---|---|---|
| Fast, default | One reproducible problem observed by an Agent | One Skill Git repository; its focused `.test/` regression is visible to the repair Agent |
| Full Benchmark | A user-provided dataset used for systematic evolution | Two Git repositories; probe questions drive iteration, while verifier/gold and held-out inputs stay Eval-side |

Both modes retain an Issue, branch, Harness Run, local PR decision, and Wiki
history. They differ in the evidence boundary: fast mode favors a short repair
cycle; full mode preserves leakage-resistant measurement.

## Privacy and review boundary

- Every split, verifier code, gold answers, traces, evaluator paths, and raw
  result JSON remain stored on the Eval side. Redacted probe question text is
  supplied transiently as visible development feedback.
- Harness sees the Skill repository, redacted probe questions, aggregate
  scores, and redacted failure categories. It does not see `pr_val`/`test`
  inputs or any answer and verifier data.
- The Web API exposes aggregate evaluation gates, not raw evaluation data or
  local Eval paths.
- Only register evaluation repositories whose verifier code you trust to run
  locally.
- Benchmark optimization never pushes. The default `review` policy leaves its
  passing PR open; an explicitly saved `automatic` policy may merge it locally
  only after the frozen evaluation gates pass.
