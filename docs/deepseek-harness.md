# Repair executors and optional DeepSeek Harness

SkillHone keeps the Issue, Run, test gate, local PR, and Wiki contract separate
from the executor. Native assignments use the current Agent. Managed DSH is an
explicit optional choice.

## Executor selection

| Policy | Selected executor | What the host does |
|---|---|---|
| `auto` (default) | Native current Agent | Prepares an assignment; does not launch another model runtime |
| `native` | Native current Agent | Prepares the same attached-session assignment explicitly |
| `dsh` | Managed DeepSeek Harness | Starts the configured managed child process |

```bash
skillhone config set --executor auto
skillhone --skill web-search config set --executor native
skillhone --skill web-search optimize 1 --executor native
# Optional one-attempt DSH choice, after explicit setup/configuration:
skillhone --skill web-search optimize 1 --executor dsh
```

New homes default to auto. Existing settings without an executor field retain
DSH compatibility; choose `config set --executor auto` to migrate explicitly.
Auto resolves to native. It never silently installs DSH, changes the session's
model/account/provider, or falls back to another executor. Trigger timing
(queued, immediate, scheduled) and merge policy (review, automatic) are separate
choices.

## Native assignment lifecycle

```text
current Agent observes defect -> host records Issue/test contract
  -> optimize/retry returns native assignment, Run=awaiting_agent
  -> current Agent repair role edits/tests/commits assigned workspace
  -> host independently checks exact commit and calls execution complete
  -> verified local PR + saved merge policy + Wiki record
```

`optimize` or `retry` prepares the assignment; there is no `execution prepare`
subcommand. The response includes `run_id`, `worktree`, `branch`, `base_commit`,
registered tests, and `completion_args` (an argv vector). Fill its SHA
placeholder and execute arguments directly, not as an unescaped shell string. `automatically_started` is false.
`awaiting_agent` means a live current Agent must take the work, not that an
unattended native worker is running or that repair failed.

The repair role preserves the current session's model/account/provider. It may
edit, add focused tests, and commit on the assigned branch, but must not alter
the registered reproduction tests, call SkillHone, modify host audit/state,
recursively dispatch, merge, or push. It returns the exact commit and test
results to the host. The assigned `worktree` is the path returned by the CLI;
its name does not imply a separate security sandbox.

```bash
skillhone --skill web-search execution complete <run-id> --commit <exact-commit-sha>
skillhone --skill web-search execution fail <run-id> --reason "Safe failure summary"
skillhone --skill web-search execution cancel <run-id> --reason "Safe cancellation summary"
```

The host validates the assignment, exact HEAD/branch/base, clean worktree, and
unchanged reproduction contract, then independently reruns the test gate.
Only a committed candidate that passes becomes a PR. A repair role never
approves its own merge. A queued or scheduled dispatcher can prepare native
assignments, but cannot execute the attached Agent by itself.

## Optional managed DSH runtime

SkillHone installs the tested `@deepseek-ai/dsh@0.2.1-rc.2` release into its private runtime and uses
that launcher for DSH repairs. It does not silently reuse an arbitrary global `dsh`, since
the Harness CLI and event contracts are evolving quickly. Resolution uses the
official `registry.npmjs.org` host rather than an ambient package mirror. The workbench reports the selected executor and global running count
separately. Missing DSH does not make native assignments unavailable.

The version pin applies only to SkillHone's managed runtime. By default its
packages live in `~/.skillhone/harness/node_modules/`, and its configuration and
credentials live in `~/.skillhone/harness/home/`. SkillHone sets `DSH_HOME` only
for its child processes. Installation and upgrades do not replace a globally
installed `dsh` or change the configuration of an independently used Harness.
A custom SkillHone home moves these private directories together.

The private installation root also carries a narrow, source-controlled dependency
override policy for the pinned DSH tree. It selects the minimum patched releases
of zod v4, undici v8, fflate, and `@modelcontextprotocol/client` without
replacing zod v3 consumers or any global Harness configuration. The installer
and the dependency-audit workflow read the same policy.

Run `skillhone harness configure` when provider or default-model settings need
to change. It updates the active headless profile's Cordis patch and Harness
credential store from the terminal; it does not start Web. Repair jobs use the
headless profile. A legacy `settings.yaml` from an earlier Harness release is
still recognized and is safely retired after its sections are merged into the
profile.

Every Skill remains a separate Git repository with separate Issue, PR, Run, and
Wiki state. The Web workbench provides one index without changing ownership or
sharing Issue numbers across Skills.

## Host-owned audit boundary

Both executors keep final Issue/PR/Run/Wiki decisions on the host. Their runtime
boundaries differ:

| Executor | Boundary | Limitation |
|---|---|---|
| Native | `trusted-host-session`; host-owned assignment/manifest and independent completion gate | No database write lock spans multiple Agent commands; the current Agent is trusted |
| DSH | `host-locked` while the child process is running | Protects active audit writes, not a general OS or hidden-data security boundary |

For DSH, SkillHone starts Harness with its isolated user home and without
`SKILLHONE_HOME`, holds the database write lock during the model/tool process,
then creates the PR/Wiki and final Run state after exit. It verifies SQLite
integrity and reports the result.

For native, an independent repair role must not edit host records or run the
completion/merge commands itself. The host rechecks the assignment and candidate.
This is a workflow and trust boundary, not the DSH process lock. Neither
executor reports hidden-evaluation isolation. `fork_turns=none` limits inherited
conversation context; it does not prevent filesystem access to evaluation data.
Both current backends reject `--hidden-eval`; protect hidden evaluations in a genuinely
separate environment instead of claiming that a fresh subagent is isolated.

For managed DSH, the default `standard` mode prevents the child process from
changing active records through the locked database. Native retains its trusted
host-session boundary. Users who also want later offline edits to be detectable can
enable the optional signed audit mode globally or for one Skill:

```sh
skillhone config set --audit signed
skillhone --skill web-search config set --audit signed
```

Signed mode keeps an HMAC key in the Host credential directory (mode `0600`),
outside every Skill repository and outside the Harness environment. Each Host
mutation reseals the repository-scoped Issue, PR, Run, Wiki, test, and
evaluation state. A missing or mismatched seal makes `audit.integrity` fail and
blocks further audit writes. `skillhone config set --audit standard` disables
the optional seal; enabling it again accepts the then-current state as a new
trusted baseline.

For DSH, the runtime lock and optional signed history address the
audit-author concern raised in
[Issue #9](https://github.com/Tencent/SkillHone/issues/9) without giving the
repair Agent an Issue/PR credential. Signed mode is tamper-evident, not an
OS-level security boundary: use a separate OS account or sandbox if the machine
owner or a privileged process is part of the threat model.

## When to choose DSH

- a managed headless process is wanted for unattended queued/scheduled repair;
- tools and permissions stay inside the repair runtime;
- the observing Agent does not need repair credentials in its model context;
- a successful repair must produce tests and a local commit;
- no Anthropic-compatible endpoint, LiteLLM proxy, Forgejo server, webhook, or
  separate evaluation repository is required for the default fast mode.

## Integration surface

When DSH is selected, SkillHone starts the official Harness headless profile
and records the resulting Git and local workbench evidence. Native uses the
attached assignment/completion contract instead. Reporting remains a SkillHone CLI contract, so a
Codex, Claude Code, Cursor, Pi, or other Agent does not need to run inside
Harness.

Harness sessions make richer integration straightforward without changing that
contract. A future DSH plugin can surface session trajectories, tool-call
analysis, and Harness Web UI views alongside SkillHone's Issue and PR records.
Those plugin views are an extension point; they are not required by or bundled
with the current local workbench.

## Review boundary

`queued`, `immediate`, and `scheduled` decide when repair work is consumed, not
whether it is authorized. Merge behavior is independent: `review` sends passing
PRs to the approval inbox, while `automatic` is an explicit saved authorization
to merge locally after all linked tests pass. Neither mode pushes.

## Analysis tools

| Tool | Use it for | Boundary |
|---|---|---|
| Harness built-in Trajectory | One repair's requests, context sources, tool calls, and results | Built into Harness; no SkillHone dependency |
| [LoongSuite OpenTelemetry plugin](https://github.com/loongsuite/dsh-plugin) | Step/LLM/tool spans, TTFT, latency, tokens, errors, and cross-run analysis through OTLP | Community plugin; keep `captureContent: false` unless prompt/tool-content export is explicitly approved |
| [DSH Usage Stats](https://github.com/Ychris12138/dsh-usage-stats) | Token totals, cache hit rate, and provider/model cost breakdowns | Community plugin; analyzes usage rather than repair correctness |

Pin a reviewed release or commit and review each plugin's permissions and data
destinations. These tools complement rather than replace SkillHone's Issue,
evaluation or repository-test gate, Git diff, PR description, and merge
decision. More integrations are listed under the
[`dsh-plugin` GitHub topic](https://github.com/topics/dsh-plugin).

## Installation checks and recovery

The private Harness installer uses pnpm 10.4 or newer when available, with
explicit build approvals for its native dependencies. If the installed pnpm is
older or its version cannot be determined, SkillHone uses npm. It never upgrades
the global package manager. Without a compatible installer it reports the
required version before attempting installation.

`skillhone doctor` reports the selected executor and its capabilities. Native
`ready_for_assignment` is distinct from `ready_for_autonomous_execution`; it
does not prove a model call or install an unattended worker. With DSH selected,
doctor checks its installation and model selection without making a request. A selected model may use environment credentials; a missing credential
file does not mean the model is unconfigured. `connectivity_verified` remains
false until an explicit `skillhone doctor --probe` succeeds for DSH in that
invocation.
The probe makes a model request and asks Harness to read two temporary challenge
files using native tools with read-only permissions. It checks the returned
values and removes the temporary files. A text-only readiness reply is insufficient.

Provider tool-call protocol errors (including duplicate call IDs) produce a
failed result with a diagnostic. SkillHone does not switch providers or protocols.
Correct the Harness configuration, run the probe again, then resume the Issue:

```sh
skillhone --repo /path/to/skill retry 1
```

Retry requires an open Issue whose latest runtime repair failed, with no running
repair or open PR. It preserves the previous branch and trajectory, starts a new
numbered branch from the previous branch tip, and reruns all linked tests before
creating a PR. Resolve or commit unrelated working-tree changes first; retry does
not discard them. Existing review or automatic local merge policy still applies.
Failed Issues are not automatically retried by `dispatch`.

`optimize`, `retry`, immediate repair, and one-shot `dispatch` return nonzero when
a repair fails. Dispatch still attempts the remaining queued Issues and reports
each result. Benchmark repair clones retain the source repository's Git author
name and email so repository-local identity works without global Git settings.
