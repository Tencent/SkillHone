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
boundaries. Successful optimization automatically writes an
`issue-<N>-repair` record linked to the local Issue and PR.

## Report and repair

```bash
skillhone issue create --title <title> [--body <safe-evidence>] \
  [--test-path .test/<file> --test-command <command>]
skillhone issue test add <N> --path .test/<file> --command <command>
skillhone issue test list <N>
skillhone issue test run <N>
skillhone issue close <N>
skillhone optimize <issue-number> [--executor auto|native|dsh]
skillhone retry <issue-number> [--executor auto|native|dsh]
skillhone execution complete <run-id> --commit <exact-commit-sha>
skillhone execution fail <run-id> --reason <safe-summary>
skillhone execution cancel <run-id> --reason <safe-summary>
skillhone pr create --title <title> --head <branch> [--base main] [--issue N]
skillhone pr merge <N> --confirm
```

`auto` (the new-home default) resolves to `native`, preserving the current Agent's model,
account, and provider. `optimize` prepares a branch and returns an assignment:
`run_id`, `worktree`, `branch`, `base_commit`, registered `tests`, and
`completion_args`. It reports `waiting_for_current_agent` and
`automatically_started: false`; the Run is `awaiting_agent`, not running or failed.
Use `completion_args` as an argument vector after replacing its exact-SHA
placeholder; do not concatenate it into an unescaped shell string.
There is no `execution prepare` subcommand. Use an already returned assignment
rather than preparing another one for the same Issue.

The current Agent performs the repair using its normal tools. A delegated
repair role only edits/tests/commits the assigned workspace and returns the exact
SHA; it must not call SkillHone, alter host audit records or registered tests,
merge, or push. The host independently checks the candidate and calls
`execution complete`. Completion requires the assigned branch/HEAD and exact
commit, unchanged base and reproduction contract, a clean worktree, and passing
tests before creating a PR. Saved `review`/`automatic` merge policy is applied
by the host; no executor pushes. `execution fail` and `execution cancel` end a
pending native assignment with a safe reason.

Native execution is attached to the trusted host session. It does not hold a
cross-command audit write lock or claim hidden-evaluation isolation. Removing
inherited subagent turns is not a filesystem security boundary. Both current backends reject
`--hidden-eval`.

Explicit `--executor dsh` starts the configured managed DeepSeek Harness,
reruns linked tests after exit, and requires a real commit before recording a
PR. DSH's live child process receives an isolated home and no SkillHone home
pointer, while the host holds its audit database write lock. DSH installation
and credentials are optional for native use. A requested DSH execution never
falls back to native if its configuration is unavailable.

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

This is the optional paper-compatible path. Native `benchmark optimize` is
currently unsupported; select the explicit DSH path for supported non-hidden
campaigns instead of promising an attached native worker. `init` pins a clean evaluation
repository commit and fingerprints its `probe`, optional `pr_val`, and optional
`test` datasets. The default runner is the existing paper-compatible
`evaluator/eval.py` command; use `--runner` for another local evaluator.

Benchmark evaluation turns the most frequent redacted failure pattern into a
normal Issue. Repair then uses the same Issue branch, PR, Wiki, and review flow
as an Agent-reported problem, but its evaluation contract does not enter the
Skill repository's `.test/`. The selected repair executor receives probe questions plus aggregate, redacted
feedback; it does not receive the Eval repository path,
probe verifier/gold, held-out `pr_val`/`test` inputs, or raw result JSON. The
separate Eval Git repository owns all versioned evaluation artifacts. `test` is
explicit and is never used by `benchmark optimize`. Excluding data from the
prompt is not proof that the repair process cannot read it. Hidden evaluation
requires a genuinely separate protected environment; native `--hidden-eval`
is rejected.

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

`doctor` reports the selected executor and its capabilities. Native readiness
means an assignment can be prepared; it does not claim an unattended worker is
installed or that a model call has succeeded. With DSH selected, `doctor --probe`
adds a real model request and two temporary read-only file challenges to verify
native tool execution. Missing credential files are valid with environment
credentials. Tool-call protocol failures require checking the Harness provider
configuration; SkillHone never switches models or protocols automatically.

Plain `setup` initializes CLI state only. `setup --with-harness` installs the
tested `@deepseek-ai/dsh@0.2.1-rc.2` release into SkillHone's private runtime.
`setup --agent <runtime>` links the bundled `skillhone` and
`skillhone-auto-optimization` Skills into that Agent's standard discovery
directory. It resolves them from the installed CLI package rather than the
current working directory and refuses to overwrite an existing Skill.
`configure` takes the provider and model as flags, reads the API key with
hidden terminal input, and updates Harness's active headless profile patch
(`profiles/headless/cordis.patch.yml`) and `.credentials.yaml`. A legacy
`settings.yaml` is recognized and safely retired after its sections are merged
into the profile. For DeepSeek, it also points the headless profile's native
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

## Executor policy

```bash
# Default: prepare work for the current Agent; never silently start DSH.
skillhone config set --executor auto
skillhone config set --executor native
# Explicit optional managed executor:
skillhone config set --executor dsh
# Repository override:
skillhone --skill web-search config set --executor native
# One attempt override, without changing the saved policy:
skillhone --skill web-search optimize 1 --executor native
```

Existing settings with no executor field keep `dsh` for compatibility. Select
`config set --executor auto` to migrate deliberately.

Executor selection is independent from queued/immediate/scheduled triggers and
review/automatic merge policy. `auto` always selects native. A native assignment
still needs the current Agent to perform it; a scheduled dispatcher is not an
unattended native model worker. DSH is installed only by explicit
`setup --with-harness` and configured through its own provider/model settings.

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

Optional tamper-evident audit history is disabled by default. Enable it only
when the user requests the stronger local verification boundary:

```bash
skillhone config set --audit signed
skillhone --skill web-search config set --audit signed
```

Signed mode stores its key in the Host credential directory, never in a Skill
repository or Harness environment. A signature mismatch blocks further audit
writes. Return to the default with `config set --audit standard`; reenabling
signed mode later establishes a new baseline from the current Host records.

## State

Catalog metadata lives at `~/.skillhone/catalog.db`. Managed repositories live
under `~/.skillhone/skills/`, while Issue/PR/Run/Wiki state remains isolated at
`~/.skillhone/projects/<project-id>/skillhone.db`. Issue, PR, Wiki, and Run
records use the same repository-scoped database. Set `SKILLHONE_HOME` or global
`--home` to override the root. Run logs remain on the Host and are not returned
to the browser.
