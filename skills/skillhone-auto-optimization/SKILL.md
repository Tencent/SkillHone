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
SkillHone is the way to unblock that request. For new homes, the default auto executor selects native:
it prepares work for the current Agent without a DSH installation or new model
credential. A missing optional DSH installation blocks only an explicitly
selected DSH repair; do not switch executors or providers silently.

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
6. Inspect the executor policy. `auto` resolves to `native`, using the current
   Agent; `dsh` requires an explicit choice. The saved trigger controls when work
   is prepared, not which model or provider to switch to. If Issue reporting or
   dispatch already returned a native assignment, reuse it instead of creating
   a duplicate. For a queued Issue, call the dispatcher or optimize the selected
   Issue; no extra repair approval is needed.
   Existing settings without an executor field preserve DSH compatibility;
   choose `config set --executor auto` explicitly to migrate.
7. For native execution, retain the assignment's `run_id`, `worktree`, `branch`,
   `base_commit`, tests, and `completion_args` (an argv vector, not a shell command). `awaiting_agent` means prepared
   and waiting for the current Agent; it is neither running nor failed. Use the
   current runtime's tools or independent repair role to reproduce, repair,
   test, and commit in the assigned path. Preserve the current model, account,
   and provider. Do not install or start DSH for this path.
8. Give the repair role only the safe reproduction and assigned workspace. It
   must not call SkillHone, modify host audit/state files, alter registered
   reproduction tests, dispatch another repair, merge, or push. It returns an
   exact commit SHA, changed files, test commands/results, and remaining limits.
9. The host reviews the actual candidate and independently reruns its checks,
   then calls `execution complete <run-id> --commit <exact-commit-sha>` in the
   same repository. The CLI verifies the branch/base/test contract and runs
   the test gate before making a PR. The saved merge policy applies on the
   host only. Use `execution fail` or `execution cancel` with a safe reason to
   end an assignment that cannot complete.
10. With DSH explicitly selected, dispatch starts the managed child process.
    Only that repair role edits the implementation; the host reruns tests and
    records the PR after the process exits. Missing installation/configuration
    is reported for DSH, not treated as native unavailability.
11. For Issues, PRs, trajectories, or completed fixes, use `skillhone web --open`.

The native boundary is a trusted host session, not a sandbox or a database lock
held between CLI commands. A separate role or `fork_turns=none` changes context
sharing; neither proves hidden-evaluation isolation. Both current backends reject
`--hidden-eval`; protect hidden evaluation data outside the repair environment.

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

For native execution, dispatch/watch prepares assignments; a live current Agent
must still perform them. It does not run an unattended native Agent daemon.

Merge policy is separate: `review` creates an approval notification;
`automatic` is an explicit saved authorization to merge only after all linked
tests pass. Neither authorizes a push.

### Native host commands

```bash
skillhone --repo /path/to/skill optimize 1 --executor native
# Current Agent repairs/commits the returned assignment; host verifies it:
skillhone --repo /path/to/skill execution complete <run-id> --commit <exact-commit-sha>
```

There is no `execution prepare` command: `optimize` or `retry` prepares the
assignment. A retry keeps the previous attempt and requires the same repository.

## Composition

```text
normal Agent task
  → target skill fails reproducibly
      → skillhone-auto-optimization
      → skillhone CLI (local Issue and PR backend)
      → trigger policy (queued / immediate / scheduled)
      → selected executor: current Agent (auto/native) or optional DSH
      → host verifies exact commit and test gate → local PR
```

## Hard rules

- A confirmed missing referenced file or failing repository test must become an
  Issue before any implementation edit or dependency installation.
- Never dismiss this workflow as belonging only to the SkillHone source repo;
  it governs the failing target Skill wherever that repository lives.
- Before an assignment exists, the reporting Agent may add only the focused
  reproduction under `.test/`. After native preparation, the assigned repair
  role may change the implementation; host audit and merge duties remain
  outside that role.
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
