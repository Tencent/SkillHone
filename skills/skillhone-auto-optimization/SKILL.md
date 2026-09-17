---
name: skillhone-auto-optimization
description: >
  Mandatory interception workflow for a reproducible defect encountered while
  any Agent is using a skill. Invoke this before editing implementation files or
  installing dependencies when a referenced script is missing, a documented
  command or repository test fails, or another target-skill defect is confirmed.
  First create or reuse a sanitized local Issue, then let SkillHone dispatch the
  repair into a tested Git-backed pull request. This applies regardless of the
  Agent, current working directory, or the user's original task. No eval repo or
  benchmark data is required.
---

# SkillHone Auto Optimization

This skill owns the automatic runtime-defect workflow. A normal Agent task
remains the entry point: when the selected skill fails for a reproducible reason,
dispatch here instead of folding maintenance logic into the task skill itself.

## Mandatory interception boundary

Once normal work establishes a reproducible target-skill defect, stop the
primary task and invoke this workflow **before** doing any of the following:

- creating or editing the missing implementation file;
- installing, upgrading, or changing a runtime dependency;
- changing the Skill's documented behavior to avoid the failure;
- committing directly on the default branch;
- falling back to an ad-hoc repair merely to finish the user's original task.

The only pre-Issue write allowed is the smallest focused reproduction under
`.test/` when the repository does not already contain one. If an existing test
already reproduces the defect, reuse it unchanged.

This boundary applies to Codex, Claude Code, Cursor, ZCode, Pi, DeepSeek
Harness, and any other CLI-capable Agent. It also applies when the Agent's
current working directory is the SkillHone source repository but the failing
target is elsewhere. A path under `~/.skillhone/skills/<name>/` is an explicit
managed-Skill signal: never repair such a repository directly on `main`.

Do not reinterpret this workflow as optional because the user's primary request
was to run the broken Skill. Recording and repairing the defect through
SkillHone is the way to unblock that request. If Harness is not configured,
create or reuse the Issue, report the configuration blocker, and stop; do not
perform a direct repair instead.

The local Git repository must be the repository containing the target skill.
One Skill maps to exactly one repository:

```text
skill folder: web-search
Git repository: /path/to/web-search
```

Do not create repositories named `*-e2e`, `*-test`, or with timestamps for this
workflow. Reproduction tests belong inside the affected skill, preferably under
its hidden `.test/` directory when they should not affect runtime
discovery or normal skill behavior.

An explicit target path is authoritative. When the user names a Skill directory
or the Agent is already working inside its Git repository, run every status,
duplicate, Issue, test, dispatch, PR, and Wiki command with
`skillhone --repo <that-repository>`. Do not redirect the observation to a
catalog entry merely because another repository has the same Skill name or
identical files. Use `--skill <name>` only when no repository path was supplied
and the user selected the cataloged Skill by name.

## Workflow

1. Pause the user's primary task as soon as the reproducible defect is confirmed.
2. Reproduce the observation from public target-skill state.
3. Reject provider outages, rate limits, machine-specific state, user config
   errors, private-only evidence, and non-actionable observations.
4. Select the exact target repository as described above, run
   `skillhone --repo <target-repository> status`, and search that repository's
   open and closed local Issues for the same root cause.
5. Create the smallest focused reproduction under `.test/`, then run
   `skillhone --repo <target-repository> issue create` with sanitized evidence and attach
   the test in the same command with `--test-path` and `--test-command`.
   SkillHone creates or reuses one Issue in the local project database. An
   uncommitted linked test is allowed into the repair branch; any unrelated
   working-tree change still blocks optimization.
6. Let the configured trigger policy decide how the queue is consumed, without
   asking for repair approval. `immediate` starts Harness in the Issue command.
   For `queued`, the reporting Agent must call
   `skillhone --repo <target-repository> dispatch` and let the dispatcher consume
   queued Issues serially; do not ask whether to dispatch. `scheduled` is
   consumed by `skillhone dispatch --watch` at the saved interval and likewise
   requires no per-Issue confirmation.
7. Only the dispatched repair Agent may add focused implementation files and
   repair tests. The reporting Agent must not implement the fix itself.
8. On success, the CLI reruns the Issue tests and records the committed branch
   as a local PR only when they pass. The saved merge policy either places it
   in the approval inbox or merges it locally; neither path pushes.
9. When the user asks to inspect Issues, PRs, trajectories, or completed fixes,
   run `skillhone web --open`; Runs are shown inside their linked Issue/PR.

## Agent command

```bash
skillhone --skill web-search issue create \
  --title "Documented search script is missing" \
  --body "Safe reproduction, observed failure, and expected behavior" \
  --test-path .test/test_search_cli.py \
  --test-command "python3 .test/test_search_cli.py"
```

If the user asks to initialize or centrally manage an uncataloged Skill, ask
whether they want a separately optimized copy or a centrally managed runtime
Skill, then import it with `skillhone import /path/to/web-search --mode copy` or
`--mode takeover`. Do not interrupt a defect report to require import: a Skill
that is already an independent Git repository can be maintained in place with
`--repo`. Search that same repository for duplicates first. The default
`queued` policy is already authorized for dispatcher repair. Configure
consumption timing with:

```bash
skillhone config set --trigger queued
skillhone config set --trigger immediate
skillhone config set --trigger scheduled --interval-minutes 60
skillhone dispatch --watch
```

Merge policy is separate: `review` creates an approval notification;
`automatic` is an explicit saved authorization to merge only after all linked
tests pass. Neither authorizes a push.

## Composition

```text
normal Agent task
  → target skill fails reproducibly
      → skillhone-auto-optimization
      → skillhone CLI (local Issue and PR backend)
      → trigger policy (queued / immediate / scheduled)
      → managed DeepSeek Harness (focused repair)
```

## Hard rules

- A confirmed missing referenced file or failing repository test must become an
  Issue before any implementation edit or dependency installation.
- Never dismiss this workflow as belonging only to the SkillHone source repo;
  it governs the failing target Skill wherever that repository lives.
- The reporting Agent may add a reproduction under `.test/`, but it must not
  repair production files or install the missing runtime dependency.
- Run Python reproductions and independent checks with
  `PYTHONDONTWRITEBYTECODE=1`. Before reporting the final repository state,
  remove only generated caches created by the workflow (`__pycache__/`,
  `.pytest_cache/`, `.pyc`, and `.pyo`) and confirm `git status --short` is
  otherwise clean.
- Run the CLI against the Git repository that actually contains the target skill.
- Treat a user-supplied repository path as authoritative; never substitute a
  same-name or byte-identical catalog repository.
- Never ask for permission to consume a queued repair. Repair authorization is
  encoded by the trigger policy; only merge or copy-back can require a user
  decision.
- Never create a second repository merely for automatic-maintenance tests.
- Never put credentials, private prompts, hidden eval data, or raw trajectories in Issue/PR text.
- Do not treat transient upstream failures as target-skill defects.
- Do not push anything. Merge only through the saved `review` or `automatic`
  policy; never infer a different policy from the Issue text.
