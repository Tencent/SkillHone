# Changelog

## Unreleased — DeepSeek Harness rebuild

### Added

- Agent-observed maintenance: Codex, Claude Code, Pi, or another Agent can
  record a reproducible Skill defect during normal work.
- Local SQLite Issue/PR/Run/Wiki tracking and a loopback-only Web workbench.
- Per-Skill Wiki work records, including an automatic repair page after a
  successful DeepSeek Harness run.
- Authorized repair through a persisted DeepSeek Harness headless session.
- Focused local branches, hidden `.test/`, commits, and reviewable local PRs.
- A one-command installer for the self-contained CLI and its Agent skills.
- A reproducible public `phoenix-tracing` Skill example from GitHub's
  `awesome-copilot` repository, preserving its license declarations.
- Optional evaluation-driven campaigns that pin a clean Eval/Evo commit, use
  redacted probe questions as visible development feedback, keep verifier/gold
  data and `pr_val`/`test` inputs private, and create a linked local PR only
  after the validation gates pass.

### Fixed

- Preserve the Phoenix Skill's Apache-2.0 metadata declaration, the upstream
  repository's MIT license, and visible modification notices in repaired files.
- Fall back to npm when pnpm cannot support dependency build approvals.
- Accept shell environment references during Skill import while retaining
  credential checks for literal tokens and secret defaults.
- Preserve failed repair branches and add explicit `retry ISSUE` recovery.
- Return failure exit codes for failed repairs and dispatch batches.
- Verify native tool execution with `doctor --probe` and diagnose duplicate
  tool-call IDs without changing provider configuration.
- Recognize environment-backed model configuration in the workbench and avoid
  stale setup instructions for configured installations.
- Preserve repository-local Git identity in isolated benchmark repair clones.

### Changed

- The default runtime workflow no longer requires a separate evaluation
  repository; the paper-compatible evaluation loop remains an explicit option.
- DeepSeek Harness replaces Claude Agent SDK as the repair runtime.
- Runtime maintenance no longer requires Forgejo or another hosted Git service.

### Security

- Model credentials stay in Harness-owned credential storage and are redacted
  from Issues, PRs, SkillHone settings, logs, Web responses, examples, and
  screenshots.
- Reporting follows the saved queued, immediate, or scheduled trigger policy.
  SkillHone never pushes; local merge is automatic only when the user has
  explicitly selected that policy.
- Harness prompts receive redacted probe question text as visible development
  feedback. Verifiers, gold answers, `pr_val`/`test` inputs, result files, and
  Eval repository paths are never included in Issue text, benchmark PR text,
  Harness prompts, or Web data.
