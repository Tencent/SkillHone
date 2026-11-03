# Install SkillHone

The global CLI needs Node.js 22.19+ and Git. The CLI, local backend, and Web
workbench are compiled from the same TypeScript package. DeepSeek Harness is an
optional executor. The default `auto` path prepares repairs for the current
Agent, without requiring DSH installation or a separate model credential.

## Install

### Ask your coding Agent

Paste this into Codex, Claude Code, or another coding Agent:

```text
Install SkillHone from https://github.com/Tencent/SkillHone. Follow docs/install/skillhone.md, run the installer, make SkillHone available to this coding agent, and verify `skillhone --version`. Do not change unrelated files.
```

The Agent should inspect this guide and `package.json`, install the GitHub
`main` branch or a release `.tgz`, and report the verification result. It does
not need an API key to install, import Skills, record Issues, or open the
workbench.

### GitHub main branch

```bash
npm install -g --install-links=true \
  git+https://github.com/Tencent/SkillHone.git#main
```

This is the Git installation path for this repository. SkillHone is not published to the NPM
Registry; `npm` is only the local Node.js installer here. It clones the GitHub
`main` branch, installs the build dependencies, runs the TypeScript `prepare`
script, and links the resulting `skillhone` binary globally.
`--install-links=true` is required for Git dependencies: it makes npm pack the
prepared checkout into the global prefix instead of leaving a link to npm's
temporary clone directory. The Git installation runs SkillHone's TypeScript
`prepare` build outside any Agent sandbox, so review the repository and target
branch before installing.

Then verify:

```bash
skillhone --help
skillhone setup --agent codex
```

Replace `codex` with `cursor`, `claude-code`, `pi`, or `zcode` for the Agent performing
the installation. Use `--agent all` only when the user wants all five runtimes
connected. The installer links the two bundled Agent Skills from the globally
installed GitHub package and adds one small, marked routing rule to the selected
Agent's global instruction file. The rule only tells the Agent when to invoke
the auto-optimization Skill; the workflow remains in the Skill itself. Existing
runtime Skills are never overwritten; SkillHone stops and asks the Agent to
back them up first.

### Prebuilt GitHub Release package

Tagged releases attach `skillhone-cli-<version>.tgz`. Download the package and
install it without running a source build:

```bash
npm install -g --ignore-scripts ./skillhone-cli-<version>.tgz
```

The archive contains precompiled JavaScript, type declarations, Web assets,
the two runtime Agent Skills, and the optional Benchmark Skill. It is built by
`.github/workflows/release-package.yml`.
`--ignore-scripts` is intentional: the archive is already built, so installation
does not need to authorize or invoke a TypeScript compiler.

## Choose a repair executor

The default `auto` executor uses the current Agent through a native assignment.
It keeps the session's existing model, account, and provider. `native` selects
that path explicitly; `dsh` selects the optional managed runtime. Auto does not
silently start DSH or fall back between executors.

```bash
skillhone config show
skillhone config set --executor auto
skillhone doctor
```

New homes default to auto. Existing settings without an executor field retain
DSH compatibility; `config set --executor auto` deliberately migrates that
choice, without changing models or installing a runtime.

Native readiness means the CLI can prepare an assignment for the current Agent;
it does not mean an unattended worker is running. No new API key is required.

## Optional: configure DeepSeek Harness

For the explicit DSH executor, install the managed backend and configure its
provider/model:

```bash
skillhone setup --with-harness
skillhone config set --executor dsh
skillhone harness configure --provider deepseek --model your-model-id
# Enter the credential at the hidden terminal prompt.

# Optional: keep benchmark scoring on a separate Harness model.
skillhone harness configure --role evaluator --provider my-evaluator \
  --model my-model --base-url https://example.com/v1 --protocol openai-completions
```

This edits the active headless profile patch
(`profiles/headless/cordis.patch.yml`) and credential store with mode `0600`.
For DeepSeek, the headless native Web Search provider is wired to the same
credential reference without writing the secret into profile configuration;
it does not start a Web process. DeepSeek, Anthropic, OpenAI, and custom
providers use Harness's model routes and schema. Repairs use the headless
profile. SkillHone does not store or translate their credentials. A legacy
`settings.yaml` from an earlier Harness release remains supported: its sections
are merged into the profile and the retired file is preserved with an
`.imported` suffix.

When requested, SkillHone installs the tested `@deepseek-ai/dsh@0.2.1-rc.2` release into its private runtime and uses
that launcher for DSH repairs. It deliberately does not prefer an arbitrary global `dsh`, because
Harness changes quickly and an older global executable can silently change the
CLI or session-event contract. The package is resolved from the official
`https://registry.npmjs.org` registry rather than inheriting a machine-wide
mirror setting.

This pin controls only SkillHone's private copy: packages are installed under
`~/.skillhone/harness/node_modules/`, with separate configuration and credentials
in `~/.skillhone/harness/home/`. It does not upgrade, downgrade, or reconfigure
your global `dsh`. A custom `--home` or `SKILLHONE_HOME` relocates this private
runtime; the child process receives its own `DSH_HOME`.

The managed root also receives narrow dependency overrides for the minimum
patched zod v4, undici v8, fflate, and `@modelcontextprotocol/client` releases.
They are limited to the affected ranges, leave zod v3 consumers and unrelated
root configuration alone, and are the same policy used by the dependency audit.

## First use

Import one directory or discover Skills already installed for Codex, Cursor, and Claude
Code. Every imported Skill becomes an independent managed Git repository:

```bash
skillhone init --from codex --mode copy --merge review
skillhone init --from cursor --mode copy --merge review
skillhone init --from claude-code --mode takeover --merge automatic
skillhone skills list
skillhone web --open
```

The Agent must ask two questions before running `init`. First, `copy` leaves the
original runtime Skill in place and later applies a merged result with
`skillhone sync apply <name>`, while `takeover` backs up the original and links
that runtime directly to `~/.skillhone/skills/<name>`, so a merged fix is usable
immediately. Second, `review` leaves passing PRs in the approval inbox, while
`automatic` allows a passing PR to merge locally without another prompt. Both paths create
one independent Git repository per Skill; neither silently moves or overwrites
the user's existing files, and neither ever pushes.

Then target a repository by Skill name from any directory:

```bash
skillhone --skill web-search issue create \
  --title "Missing command" --body "Safe reproduction"
skillhone --skill web-search optimize 1 --executor native
# Repair/commit the returned assignment using the current Agent, then the host runs:
skillhone --skill web-search execution complete <run-id> --commit <exact-commit-sha>
```

`optimize` returns `run_id`, assigned `worktree`/`branch`, reproduction tests,
and `completion_args` (an argv vector). Its waiting state is not a completed repair. Give a
repair role only the safe reproduction and workspace; it must not call
SkillHone, edit host audit records or registered tests, merge, or push. The host
reviews the exact commit and reruns the gate before applying the saved merge
policy. Use `execution fail` or `execution cancel` to end an abandoned assignment.
Native work is a trusted host session, not hidden-evaluation isolation; a
subagent without inherited turns does not establish filesystem separation.


Set `SKILLHONE_HOME` to change the local state root. No external database, Git
server, token, or webhook configuration is required.

## Connect another Agent runtime

SkillHone does not embed Codex, Cursor, or Claude Code. All runtimes discover
the same two standard skills and invoke the same `skillhone` executable.

The setup command resolves the bundled Skills from the installed CLI package,
not from `$PWD`:

```bash
skillhone setup --agent codex
skillhone setup --agent cursor
skillhone setup --agent claude-code
skillhone setup --agent pi
skillhone setup --agent zcode
```

Restart the selected Agent, then ask it to use the affected skill normally. If that work
exposes a reproducible skill defect, the auto-optimization skill tells Codex to
create or reuse a sanitized local Issue. The saved trigger policy decides
whether the next dispatcher, the reporting command, or a scheduled dispatcher
consumes the repair queue. Repair does not wait for per-Issue approval; merge
follows the independently saved policy.

Cursor and Claude Code use the same CLI contract and per-Skill repository
mapping. Native uses the current Agent's tools and session. When DSH is
explicitly selected, Harness keeps its credentials in its own store and starts
a separate child process according to the saved trigger policy. Native dispatch
or watch prepares assignments; it cannot execute an unattended Agent session.
The Issue/Run/PR history and test-gated host completion remain shared across
these execution choices.
