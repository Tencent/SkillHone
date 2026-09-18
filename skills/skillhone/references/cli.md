# SkillHone CLI

One Skill maps to one Git repository. Repository commands target the current
Git repository unless `--repo` or `--skill` appears before the command group.
Put `--json` before the group for Agent-readable output.

## Import and select Skills

```bash
skillhone init /path/to/skill --mode copy|takeover --merge review|automatic
skillhone import /path/to/skill --mode copy|takeover [--name alternate-name]
skillhone import --from codex --mode copy|takeover
skillhone import --from cursor --mode copy|takeover
skillhone import --from claude-code --mode copy|takeover
skillhone import --from pi --mode copy|takeover
skillhone import --from zcode --mode copy|takeover
skillhone import --from all --mode copy|takeover
skillhone skills list
skillhone skills show <name>
skillhone --skill <name> status
skillhone sync status [<name>]
skillhone sync apply <name>
```

Ask the user to choose the mode before import. `copy` keeps the source in place;
after the local PR is merged, `sync apply` makes a timestamped backup
and applies the managed repository back to it. `takeover` (legacy alias:
`managed`) makes a timestamped
backup immediately and links the runtime path to the repository under
`~/.skillhone/skills/`. Runtime import discovers current Codex, Cursor, or
Claude Code Skill directories. Neither mode folds multiple Skills into one
repository or overwrites an existing conflicting Skill.

Use `init` for first-time adoption. It requires two explicit user decisions:

- `--mode copy|takeover` controls where the runtime reads the Skill.
- `--merge review|automatic` controls whether a passing local PR waits for the
  approval inbox or is merged locally after its tests pass.

Calling `init` without either decision returns structured `choice_required`
output. An Agent must show those choices instead of inventing defaults. Use
`import` only for adding another Skill after the global merge policy is already
configured.

### Status versus synchronization

These user intents are deliberately separate:

| User intent | Command | Writes files? |
| --- | --- | --- |
| “Did the repair succeed?” / “修好了吗？” | `skillhone --skill <name> --json status`, then `issue view` or `pr view` | No |
| “Has it been synced?” / “我现在用的是新版本吗？” | `skillhone --json sync status <name>` | No |
| “Apply it back for me.” / “帮我同步回去。” | Check `sync status`, then `skillhone sync apply <name>` | Yes, copy mode only |

`sync status` returns one of these states:

| State | Meaning | Agent action |
| --- | --- | --- |
| `awaiting_merge` | A local PR is open. | Show the PR and test evidence; do not sync. |
| `ready_to_sync` | The merged central copy differs from the runtime copy. | Apply only after an explicit sync request. |
| `in_sync` | Both copies match. | Report success; do nothing. |
| `source_changed` | The runtime copy changed after import. | Stop and ask the user how to reconcile it. |
| `takeover_active` | The runtime points directly at SkillHone. | Report that no copy-back is needed. |
| `source_missing`, `repository_not_ready`, `takeover_disconnected` | A prerequisite is broken. | Explain the blocker; do not write. |

`sync apply` never merges a PR. It accepts only a clean default branch with no
open PR and refuses to overwrite a copy-mode runtime Skill changed since its
last import or sync. A repeated apply returns `already-synced` without creating
another backup.

## Inspect

```bash
skillhone status
skillhone issue list [--status open|closed]
skillhone issue view <N>
skillhone pr list [--status open|closed|merged]
skillhone pr view <N>
skillhone wiki list
skillhone wiki view <slug>
skillhone runs --list
skillhone web [--port 8790] [--open]
```

The Web server binds only to `127.0.0.1`. Its top-level views are Skills,
Issues, Pull Requests, and Wiki. The first screen shows Issue, PR, and Wiki
counts per Skill. Cross-repository lists retain the owning Skill on every item;
linked Runs appear as optimization trajectories in details.

## Work records

```bash
skillhone wiki create --title <title> [--slug <slug>] [--body <safe-notes>] [--issue N] [--pr N]
skillhone wiki update <slug> [--title <title>] [--body <safe-notes>] [--issue N] [--pr N]
skillhone wiki list
skillhone wiki view <slug>
```

Wiki entries live in the selected Skill's local state and never cross repository
boundaries. Successful Harness optimization automatically writes an
`issue-<N>-repair` record linked to the local Issue and PR.

## Report and repair

```bash
skillhone issue create --title <title> [--body <safe-evidence>] \
  [--test-path .test/<file> --test-command <command>]
skillhone issue test add <N> --path .test/<file> --command <command>
skillhone issue test list <N>
skillhone issue test run <N>
skillhone issue close <N>
skillhone optimize <issue-number>
skillhone retry <issue-number>
skillhone pr create --title <title> --head <branch> [--base main] [--issue N]
skillhone pr merge <N> --confirm
```

`optimize` creates a local branch, runs DeepSeek Harness, reruns every test
attached to the Issue, and records a PR only when Harness exits successfully,
all tests pass, and the branch contains a real commit. It never pushes. The
saved `review` policy requires a clean worktree and `pr merge --confirm`;
`automatic` merges locally only after the same test gate passes.

Issue, Run, PR, and Wiki state is host-owned. During a Harness repair,
SkillHone removes its home pointer from the runner environment, gives the runner
an isolated user home, and holds the audit database under a write lock. The
runner can change and commit the Skill workspace, but cannot use a nested CLI or
SQLite connection to rewrite or close its active audit records. `status`
reports `audit.integrity` and the enforced runner-write boundary.

After resolving a failed runtime repair's cause, use `retry N` in the same
repository. It creates a new branch from the failed branch tip, preserves the
old run and branch, and applies the same tests and merge policy. It rejects
closed Issues, running repairs, open PRs, and unrelated uncommitted changes.
Do not delete or rename the old branch to work around a failed run. Dispatch
does not automatically retry failures. Repair failures return a nonzero exit
code; a dispatch batch still processes later queued Issues.

## Evaluation-driven optimization

```bash
skillhone benchmark init --eval-repo /path/to/my-skill-eval
skillhone benchmark status
skillhone benchmark run --split probe
skillhone benchmark optimize --min-improvement 0.02 [--max-iterations 3 --patience 2]
skillhone benchmark run --split test
```

This is the optional paper-compatible path. `init` pins a clean evaluation
repository commit and fingerprints its `probe`, optional `pr_val`, and optional
`test` datasets. The default runner is the existing paper-compatible
`evaluator/eval.py` command; use `--runner` for another local evaluator.

Benchmark evaluation turns the most frequent redacted failure pattern into a
normal Issue. Repair then uses the same Issue branch, PR, Wiki, and review flow
as an Agent-reported problem, but its evaluation contract does not enter the
Skill repository's `.test/`. DeepSeek Harness receives the probe questions plus
aggregate, redacted feedback; it does not receive the Eval repository path,
probe verifier/gold, held-out `pr_val`/`test` inputs, or raw result JSON. The
separate Eval Git repository owns all versioned evaluation artifacts. `test` is
explicit and is never used by `benchmark optimize`.

## Install and configure Harness

```bash
skillhone setup
skillhone setup --with-harness
skillhone setup --agent codex
skillhone setup --agent cursor
skillhone setup --agent claude-code
skillhone setup --agent pi
skillhone setup --agent zcode
skillhone doctor
skillhone doctor --probe
skillhone harness status
skillhone harness configure --provider deepseek --model your-model-id
skillhone harness configure --role evaluator --provider my-evaluator \
  --model my-model --base-url https://example.com/v1 --protocol openai-completions
```

`doctor` checks configuration without contacting the model. `doctor --probe`
adds a real model request and two temporary read-only file challenges to verify
native tool execution. Missing credential files are valid with environment
credentials. Tool-call protocol failures require checking the Harness provider
configuration; SkillHone never switches models or protocols automatically.

Plain `setup` initializes CLI state only. `setup --with-harness` installs the
tested `@deepseek-ai/dsh@0.1.5-rc.2` release into SkillHone's private runtime.
`setup --agent <runtime>` links the bundled `skillhone` and
`skillhone-auto-optimization` Skills into that Agent's standard discovery
directory. It resolves them from the installed CLI package rather than the
current working directory and refuses to overwrite an existing Skill.
`configure` takes the provider and model as flags, reads the API key with
hidden terminal input, and updates Harness's own `settings.yaml` and
`.credentials.yaml`. For DeepSeek, it also points the headless profile's native
Web Search provider at the same Harness credential reference; the key itself is
never copied into the profile patch. `--role optimizer` is the default and
selects the model used to edit a Skill. `--role evaluator` registers a second
provider and writes a credential-free Harness patch used only by benchmark
evaluation, so scoring cannot silently change the optimizer model. No Web
process is required. For CI or another protected
caller, pass `--provider`, `--model`, and `--api-key-stdin`; the key never enters
the process argument list. Custom endpoints additionally use `--base-url` and
`--protocol`. Repairs use the headless profile. SkillHone stores only a
configured/not-configured descriptor; it never copies a provider credential
into `settings.json`, Issue text, logs, or the browser.

## Trigger policy

```bash
# Durable queue; no repair approval step
skillhone config set --trigger queued

# The saved choice authorizes optimization immediately after a new Issue
skillhone config set --trigger immediate

# Queue Issues and poll them every hour
skillhone config set --trigger scheduled --interval-minutes 60
skillhone dispatch --watch

# Override one imported Skill
skillhone --skill web-search config set --trigger scheduled --interval-minutes 15
```

`queued`, `immediate`, and `scheduled` control when repair work is consumed.
They do not authorize a push and do not decide merge behavior.

```bash
# Put passing PRs in the approval inbox
skillhone config set --merge review

# Or pre-authorize test-gated local merge
skillhone config set --merge automatic
```

## State

Catalog metadata lives at `~/.skillhone/catalog.db`. Managed repositories live
under `~/.skillhone/skills/`, while Issue/PR/Run/Wiki state remains isolated at
`~/.skillhone/projects/<project-id>/skillhone.db`. Issue, PR, Wiki, and Run
records use the same repository-scoped database. Set `SKILLHONE_HOME` or global
`--home` to override the root. Run logs remain on the Host and are not returned
to the browser.
