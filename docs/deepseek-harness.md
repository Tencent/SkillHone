# DeepSeek Harness integration

SkillHone keeps Skill optimization runtime-neutral at the observation boundary
and uses DeepSeek Harness to consume its repair queue.

## Boundaries

```text
observation: any Agent -> SkillHone CLI -> local Issue
repair:      saved queue policy -> DeepSeek Harness -> branch/tests/commit -> local PR + Wiki
```

Codex, Claude Code, Pi, or another CLI-capable Agent can record a reproducible
Skill defect without switching model providers. The saved trigger policy decides
whether the next dispatcher, the reporting command, or a scheduled dispatcher
consumes the queue. No per-Issue repair approval is required. DeepSeek Harness works
on an isolated branch, runs the focused tests, and creates a local commit.
SkillHone then records a local PR and Wiki work record for review.
Repair processes explicitly use Harness `workspace-write` permissions and
native tools, regardless of broader interactive defaults.

SkillHone installs the tested `@deepseek-ai/dsh@0.1.5-rc.2` release into its private runtime and uses
that launcher for every repair. It does not silently reuse an arbitrary global `dsh`, since
the Harness CLI and event contracts are evolving quickly. Resolution uses the
official `registry.npmjs.org` host rather than an ambient package mirror. The Status page
reports whether this managed runner is available and whether any recorded
repair is currently running.

Run `skillhone harness configure` when provider or default-model settings need
to change. It updates Harness's own settings and credential files from the
terminal; it does not start Web. Repair jobs use the headless profile.

Every Skill remains a separate Git repository with separate Issue, PR, Run, and
Wiki state. The Web workbench provides one index without changing ownership or
sharing Issue numbers across Skills.

## Host-owned audit boundary

SkillHone does not give the repair Agent an Issue/PR token. SkillHone owns the
local Issue, Run, PR, and Wiki database, while Harness receives only the Skill
repository as its writable workspace. For every repair, SkillHone also:

- starts Harness with an isolated user home and without `SKILLHONE_HOME`;
- holds a database write lock for the complete model/tool session, so a nested
  SkillHone or SQLite client cannot edit or close the active audit records;
- creates the PR, Wiki record, and final Run state only after Harness exits;
- verifies SQLite integrity and reports the result in CLI/Web status.

The default `standard` mode prevents the repair process from changing its
active records. Users who also want later offline edits to be detectable can
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

Together, the always-on runtime lock and optional signed history address the
audit-author concern raised in
[Issue #9](https://github.com/Tencent/SkillHone/issues/9) without giving the
repair Agent an Issue/PR credential. Signed mode is tamper-evident, not an
OS-level security boundary: use a separate OS account or sandbox if the machine
owner or a privileged process is part of the threat model.

## Why Harness owns repair

- its headless profile fits a CLI-driven repair job;
- tools and permissions stay inside the repair runtime;
- the observing Agent does not need repair credentials in its model context;
- a successful repair must produce tests and a local commit;
- no Anthropic-compatible endpoint, LiteLLM proxy, Forgejo server, webhook, or
  separate evaluation repository is required for the default fast mode.

## Integration surface

The shipped integration is deliberately small: SkillHone starts the official
Harness headless profile for a queued repair and records the resulting Git
and local workbench evidence. Reporting remains a SkillHone CLI contract, so a
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

`skillhone doctor` checks installation and model selection without making a model
request. A selected model may use environment credentials; a missing credential
file does not mean the model is unconfigured. `connectivity_verified` remains
false until an explicit `skillhone doctor --probe` succeeds in that invocation.
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
