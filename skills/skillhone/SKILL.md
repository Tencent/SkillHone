---
name: skillhone
description: Local Issue, pull-request, and Wiki workbench for agent skills. Use when a user asks what skill problems, Issues, PRs, repair trajectories, work records, completed optimizations, pending fixes, or pending synchronization exist; when an Agent needs to report a reproducible skill defect; or when the user wants to initialize, inspect, optimize, review, merge, or synchronize a local skill repair. If a managed Skill has a missing referenced file, failing test, or broken command, invoke skillhone-auto-optimization before editing implementation files or installing dependencies. Uses a local SQLite/Git backend, the current Agent for new homes, and optional DeepSeek Harness, with no hosted Git service.
---

# SkillHone

Use SkillHone as the local maintenance layer for Agent-skill repositories. One
Skill always maps to one Git repository and therefore owns an isolated set of
Issue numbers, PR numbers, Wiki records, branches, tests, and repair Runs. The Catalog indexes
those repositories but never combines their state. Any Agent runtime can call
the CLI. The default `auto` executor prepares a repair assignment for the current
Agent, preserving its model, account, and provider. `native` selects this path
explicitly; `dsh` selects the optional managed DeepSeek Harness. No executor
switch or fallback is automatic. Repair authorization is independent from the
Skill ownership and merge boundaries.

## Route the user's intent first

Treat inspection and synchronization as different operations. Never turn a
status question into a write:

- “修好了吗 / did the repair succeed / 测试通过了吗 / 优化到哪了” means inspect
  only. Run `skillhone --skill <name> --json status`, then inspect the linked
  Issue, Run, and PR when needed. Report whether repair ran, tests passed, and
  the PR is open or merged. Do not merge and do not run `sync apply`.
- “已经同步了吗 / 我现在用的是新版本吗 / 需要同步吗” means inspect copy-back
  state only. Run `skillhone --json sync status <name>` and interpret the state
  table below. Do not run `sync apply`.
- “帮我同步 / 把修复应用回去 / update my installed Skill” explicitly authorizes
  copy-back. First run `sync status`; run `skillhone sync apply <name>` only
  when it returns `ready_to_sync` with `can_apply: true`.

`sync` never merges a PR. A repair can have passed tests while still waiting in
an open PR, and a merged repair can still be waiting for copy-back.

## Import existing Skills

Import one Skill directory or discover the Skills already installed for an
Agent runtime. Before importing, ask the user which ownership mode they want:

- `copy` keeps the existing runtime Skill untouched, optimizes a copy under
  `~/.skillhone/skills/`, and requires a later `sync apply` to copy a merged
  result back. A timestamped backup is made before applying.
- `takeover` (legacy alias: `managed`) backs up the existing runtime Skill and replaces it with a link to
  the repository under `~/.skillhone/skills/`, so all Agents use the centrally
  optimized copy directly.

Never choose `takeover` or replace an existing Skill without the user's answer.
Also ask whether passing local PRs should wait for review (`review`) or merge
automatically after their tests pass (`automatic`). Do not infer either choice.

```bash
skillhone init /path/to/my-skill --mode copy --merge review
skillhone init --from codex --mode takeover --merge review
skillhone import /path/to/my-skill --mode copy
skillhone import --from codex --mode takeover
skillhone import --from cursor --mode copy
skillhone import --from claude-code --mode copy
skillhone import --from pi --mode copy
skillhone import --from zcode --mode copy
skillhone import --from all --mode copy
skillhone skills list
skillhone sync status
skillhone sync apply my-skill
```

Use `init` for first-time adoption because it records both choices and imports
the Skill. Use `import` later when the global choices already exist and only a
new Skill must be added. `init` without `--mode` or `--merge` deliberately
returns `choice_required`; present those choices to the user instead of retrying
with guessed values.

Interpret `sync status` as follows:

- `awaiting_merge`: repair may be complete, but its PR is still open; inspect it.
- `ready_to_sync`: merged central copy differs; explicit `sync apply` can apply it.
- `in_sync`: the copy-mode runtime Skill already has the merged result.
- `source_changed`: the runtime Skill changed separately; do not overwrite it.
- `takeover_active`: the runtime already points at SkillHone; no copy-back exists.
- `source_missing`, `repository_not_ready`, or `takeover_disconnected`: explain
  the blocking state and stop.

In `copy` mode, `sync apply` creates a timestamped backup and is idempotent. In
`takeover` mode, a merged default branch is already the runtime version, so a
sync request should report `already-managed`, not copy files.

Each imported Skill becomes `~/.skillhone/skills/<name>`, an independent Git
repository with an initial local commit. Re-importing identical content is
idempotent; a conflicting Skill name is rejected instead of overwritten. The
importer excludes runtime state and Git metadata and rejects detected secrets
before creating Git history.

## Inspect work

Run commands in the affected Skill repository, or select an imported Skill by
name from anywhere. If the user supplies a repository path, that path is
authoritative: use `--repo <path>` for the entire workflow and do not substitute
a same-name or byte-identical catalog repository.

```bash
skillhone status
skillhone issue list
skillhone pr list
skillhone wiki list
skillhone web --open
skillhone --skill web-search status
skillhone --skill web-search issue list
```

When the user asks to see current Issues, PRs, Wiki work records, repair trajectories, completed
optimizations, or pending work, prefer `skillhone web --open`. If opening a
browser is inappropriate, return the JSON form instead:

```bash
skillhone --json status
skillhone --json issue view <N>
skillhone --json pr view <N>
skillhone --json wiki view <slug>
```

The Web workbench puts the per-Skill Issue, PR, and Wiki counts on the first
screen. Status also includes an approval inbox for every open local PR. Its
four record views are Skills, Issues, Pull Requests, and Wiki.
Cross-Skill lists are for discovery only and always display the owning Skill.
Optimization Runs appear inside their linked Issue/PR as a trajectory rather
than as a separate product concept.

## Keep work records

Wiki pages are lightweight repository-scoped notes, not another Git repository
or hosted Wiki service. Agents can create or update them through the CLI:

```bash
skillhone wiki create --title "Parser repair" --body "What failed and what changed" --issue 1 --pr 1
skillhone wiki update parser-repair --body "Tests passed; ready for review."
skillhone wiki list
```

A completed repair writes or updates `issue-<N>-repair`, linking its Run and
local PR. For native execution this happens at host completion, not merely
when `optimize` prepares an assignment. Wiki text is redacted
before persistence just like Issue and PR text.

## Report a defect

Create an Issue only for a reproducible target-skill defect. Reject transient
provider failures, rate limits, user configuration errors, and duplicates.

This rule governs the target Skill regardless of the current Agent or working
directory. In particular, a defect below `~/.skillhone/skills/` must be handed
to `skillhone-auto-optimization` before the reporting Agent edits production
files or installs dependencies. If optimization is unavailable, keep the Issue
queued and report the blocker instead of repairing directly on `main`.

```bash
skillhone issue create \
  --title "Documented parser command is missing" \
  --body "Safe reproduction and expected behavior"

skillhone issue test add 1 \
  --path .test/test_parser.py \
  --command "python3 .test/test_parser.py"
```

The reporting Agent should create the smallest repository-local reproduction
test it can justify, then attach it to the Issue. SkillHone reruns attached tests
after repair and does not create a local PR while any test still fails.
Run Python checks with `PYTHONDONTWRITEBYTECODE=1`, and remove only generated
Python caches before the final repository-status report.

Issue text must not contain credentials, private prompts, hidden eval data, raw
trajectories, or absolute local paths. SkillHone applies an additional redaction
pass before persistence.

## Optimize and review

The saved trigger controls when work is prepared; the executor controls who
performs it. Inspect the configured executor with `skillhone config show`.
`auto` is the new-home default and resolves to `native`, never silently to DSH.
Existing settings without an executor field retain `dsh` for compatibility; use
`config set --executor auto` to deliberately adopt the current-Agent path.

```bash
skillhone config set --executor auto
skillhone --repo /path/to/skill optimize 1 --executor native
```

Native optimization returns an assignment with `run_id`, `worktree`, `branch`,
`base_commit`, registered `tests`, and a `completion_args`. Its state is
`waiting_for_current_agent`, with `automatically_started: false`; this is a
prepared task, not proof that an Agent has started or finished it. If Issue
reporting or dispatch already returned an assignment, reuse that Run.

Use the current Agent's normal tools to repair the assigned branch and commit.
Where delegation is available, give an independent repair role only the safe
reproduction, assigned path, branch, and test commands. Do not switch models,
accounts, or providers. The repair role must not call SkillHone, edit host audit
records, change registered reproduction tests, recurse into dispatch, merge, or
push. It returns the exact commit SHA, changed files, test results, and limits.

The host independently reviews the candidate, then fills the exact SHA in the
returned `completion_args` argument vector and executes it without joining it
as an unescaped shell string:

```bash
skillhone --repo /path/to/skill execution complete <run-id> --commit <exact-commit-sha>
# End an unsuccessful or abandoned assignment explicitly:
skillhone --repo /path/to/skill execution fail <run-id> --reason "Safe failure summary"
skillhone --repo /path/to/skill execution cancel <run-id> --reason "Safe cancellation summary"
```

Completion verifies the assigned branch, exact candidate, unchanged test
contract, clean worktree, and current base, then reruns the registered tests.
Only a valid committed candidate passing the gate becomes a PR. The saved
`review` or `automatic` policy applies on the host; the repair role never
chooses or performs its own merge. No path pushes automatically.

Native execution uses a `trusted-host-session` boundary. It does not hold a
cross-command SQLite write lock or claim hidden-evaluation isolation. Starting
a subagent with no inherited turns changes its input context; it is not a
filesystem or evaluation-data security boundary. Neither current backend provides hidden-evaluation isolation; both reject
`--hidden-eval`.

To use the managed runtime instead, explicitly install/configure it and select
`--executor dsh` or save that policy. DSH's host owns a live process, locks audit
writes during that process, and records the result after it exits. Missing DSH
is only a blocker for a requested DSH execution, not for native repair.

The generated PR description must include the linked Issue, changed files,
test commands, passed/total counts, observed effect, limits, and the explicit
review/merge checklist. Do not replace it with a one-line runner summary.

If another Agent already prepared a committed branch, register it manually:

```bash
skillhone pr create --issue <N> --title "Fix ..." --head <branch> --base main
```

Choose the merge behavior during `skillhone init` or with `config set`:

```bash
skillhone config set --merge review
skillhone pr merge <N> --confirm
skillhone config set --merge automatic
```

In the Web workbench, open the PR from the Status approval inbox, review its
Issue, checks, commits, and changed files, then use the confirmation dialog.
The dialog never pushes. For a `copy` import, it explicitly confirms both the
local merge and copy-back, creates a timestamped backup, and shows whether the
merged Skill is now active in the Agent runtime. If the source changed or a
copy-back safety check fails, the PR remains merged but the Web page reports
that synchronization is blocked and offers a separate retry after the conflict
is resolved. For a `takeover` import, the merge is active immediately. In
`automatic` mode, SkillHone merges locally only after every linked Issue test
passes; automatic merges do not silently authorize copy-back.

Never push. Never merge automatically unless the user explicitly saved the
`automatic` merge policy.

Audit records remain host-owned. DSH repairs hold a database write lock while
the child process runs; attached native assignments use a trusted host session
without a lock spanning Agent commands. If the user explicitly asks for tamper-evident history, enable signed records globally
or for one Skill; do not enable the optional mode without that request:

```bash
skillhone config set --audit signed
skillhone --skill web-search config set --audit signed
```

If `status` reports failed signed integrity, stop. Do not reset the mode or
accept a new baseline on the user's behalf.

Configure when the repair queue is consumed independently from merge behavior:

```bash
skillhone config set --trigger queued
skillhone config set --trigger immediate
skillhone config set --trigger scheduled --interval-minutes 60
skillhone dispatch --watch
```

`queued` leaves work for dispatch; `immediate` handles a new Issue in the
reporting command; `scheduled` lets a watching dispatcher poll at the saved
interval. With native execution these commands prepare an assignment that the
current Agent must perform; they do not create an unattended Agent worker. With
DSH selected, they launch the configured managed process. Each Issue retains
its own branch, Run, test gate, PR, and Wiki record. Repair needs no additional
per-Issue approval; merge and synchronization retain their separate policies.

## State and installation

The Catalog lives at `~/.skillhone/catalog.db`; imported repositories live under
`~/.skillhone/skills/`; each repository's isolated state lives under
`~/.skillhone/projects/<project-id>/skillhone.db`. Override the root with
`SKILLHONE_HOME`. The browser receives no repository path, run-log path, or
credential. The server binds only to `127.0.0.1`.

Install the CLI for native assignments. Add DeepSeek Harness only when the
user chooses that optional executor:

```bash
npm install -g --install-links=true git+https://github.com/Tencent/SkillHone.git#main
skillhone setup
skillhone doctor
# Optional DSH path only:
skillhone setup --with-harness
skillhone config set --executor dsh
```

SkillHone is distributed from the GitHub `main` branch, not the NPM Registry.
A prebuilt `.tgz` from a GitHub Release is also supported.

Detailed CLI usage is in [references/cli.md](references/cli.md). For a defect
discovered during ordinary Agent work, load `skillhone-auto-optimization`.
For evaluation-driven improvement, load `skillhone-benchmark-optimization` and
use `skillhone benchmark`; benchmark failures become ordinary repository-local
Issues and then use the same Git/PR review boundary. The user must supply the
separate, committed Eval repository; SkillHone does not synthesize evaluation
data as part of this workflow.
The full Benchmark path requires a second, separate Eval Git repository. Probe
question text is supplied transiently as reproducible iteration feedback; probe verifier/gold data, held-out `pr_val`/`test` inputs, and raw
results must not enter the Skill repository or repair prompt. These payload
restrictions do not establish filesystem isolation; use a separately protected
evaluation environment when hidden data is required.
Read [references/upstream.md](references/upstream.md) only when installing from
source. An existing evaluation/Evo repository may remain available, but the
runtime-maintenance path never requires it and never waits for a benchmark
before recording a reproducible defect. Use `skillhone-benchmark-optimization`
only when the user explicitly asks to build, run, or diagnose a frozen
benchmark campaign; never load it for runtime maintenance.
