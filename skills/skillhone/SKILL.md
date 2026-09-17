---
name: skillhone
description: Local Issue, pull-request, and Wiki workbench for agent skills. Use when a user asks what skill problems, Issues, PRs, repair trajectories, work records, completed optimizations, pending fixes, or pending synchronization exist; when an Agent needs to report a reproducible skill defect; or when the user wants to initialize, inspect, optimize, review, merge, or synchronize a local skill repair. If a managed Skill has a missing referenced file, failing test, or broken command, invoke skillhone-auto-optimization before editing implementation files or installing dependencies. Uses a local SQLite/Git backend and DeepSeek Harness for optimization, with no hosted Git service.
---

# SkillHone

Use SkillHone as the local maintenance layer for Agent-skill repositories. One
Skill always maps to one Git repository and therefore owns an isolated set of
Issue numbers, PR numbers, Wiki records, branches, tests, and repair Runs. The Catalog indexes
those repositories but never combines their state. Any Agent runtime can call
the CLI. DeepSeek Harness consumes the configured repair queue without a
per-Issue approval step. User choice is required at Skill ownership and merge
boundaries.

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

A successful `skillhone optimize <N>` also writes or updates
`issue-<N>-repair`, linking the Harness Run and local PR. Wiki text is redacted
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
after Harness repair and does not create a local PR while any test still fails.
Run Python checks with `PYTHONDONTWRITEBYTECODE=1`, and remove only generated
Python caches before the final repository-status report.

Issue text must not contain credentials, private prompts, hidden eval data, raw
trajectories, or absolute local paths. SkillHone applies an additional redaction
pass before persistence.

## Optimize and review

The default `queued` policy records an Issue as repair work; it does not ask
for another approval. During an active defect-report workflow, the reporting
Agent calls the repository's dispatcher directly and lets it consume queued
Issues serially:

```bash
skillhone --repo /path/to/skill dispatch
skillhone pr view <pr-number>
```

`optimize` creates a `skillhone/issue-<N>-*` branch and invokes DeepSeek Harness
headless. The repair must reproduce the defect, add focused tests (use
`.test/` when they should remain hidden), run them, and commit. A
successful run becomes a local PR only after all Issue-linked tests pass.
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

Configure when the repair queue is consumed independently from merge behavior:

```bash
skillhone config set --trigger queued
skillhone config set --trigger immediate
skillhone config set --trigger scheduled --interval-minutes 60
skillhone dispatch --watch
```

`queued` leaves work for the next dispatcher call, `immediate` consumes a new
Issue in the reporting command, and `scheduled` lets a watching dispatcher poll
at the configured interval. None requires repair approval. Dispatch is serial
per Skill repository: one Issue gets
one Harness Session, branch, test gate, PR, and Wiki record before the next
Issue starts. A repository lock prevents overlapping immediate and scheduled
repairs, and one failed Issue does not stop later queued Issues.

## State and installation

The Catalog lives at `~/.skillhone/catalog.db`; imported repositories live under
`~/.skillhone/skills/`; each repository's isolated state lives under
`~/.skillhone/projects/<project-id>/skillhone.db`. Override the root with
`SKILLHONE_HOME`. The browser receives no repository path, run-log path, or
credential. The server binds only to `127.0.0.1`.

Install the TypeScript CLI, then add DeepSeek Harness only when optimization is needed:

```bash
npm install -g --install-links=true git+https://github.com/Tencent/SkillHone.git#main
skillhone setup --with-harness
skillhone doctor
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
question text is supplied transiently to Harness as reproducible iteration
feedback; probe verifier/gold data, held-out `pr_val`/`test` inputs, and raw
results never enter the Skill repository or Harness prompt.
Read [references/upstream.md](references/upstream.md) only when installing from
source. An existing evaluation/Evo repository may remain available, but the
runtime-maintenance path never requires it and never waits for a benchmark
before recording a reproducible defect. Use `skillhone-benchmark-optimization`
only when the user explicitly asks to build, run, or diagnose a frozen
benchmark campaign; never load it for runtime maintenance.
