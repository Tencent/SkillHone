# Configuration & Directory Structure

## ~/.skillhone/settings.json

### LiteLLM adapter (non-Anthropic providers)

Use LiteLLM's `provider/model` model name. SkillHone starts a loopback-only
proxy automatically and points Claude Agent SDK at its Anthropic Messages
endpoint. The same schema covers Anthropic, DeepSeek, OpenAI, Gemini, and other
LiteLLM providers; you do not configure a transport or run a proxy yourself.

```jsonc
{
  "improver": {
    "api_key": "<improver provider key>",
    "api_base": "<optional improver endpoint>",
    "model": "deepseek/deepseek-chat",
    "sdk_model_alias": "opus"
  },
  "executor": {
    "api_key": "<executor provider key>",
    "api_base": "<optional executor endpoint>",
    "model": "openai/gpt-5-mini",
    "sdk_model_alias": "haiku"
  }
}
```

Each role owns its `model`, `api_key` (or `api_key_env`), optional `api_base`,
and optional `api_version`. The old top-level `api_key` is accepted only as a
backwards-compatible fallback. Upstream keys are passed to proxies through
their environments and are never written to temporary config files.

Copy the annotated template to get started:
```bash
mkdir -p ~/.skillhone
cp assets/settings.json ~/.skillhone/settings.json
# then edit to fill in your values
```

### Full Schema

```json
{
  "forgejo": {
    "url": "http://localhost:3000",  // Forgejo HTTP address (no trailing slash)
    "owner": "skillhone",            // Forgejo username owning all skill repos
    "token": "..."                   // Personal Access Token (repo+issue+PR scopes)
  },

  "improver": {
    "api_key": "...",                // This role's provider credential
    "api_base": "",                  // Optional upstream endpoint
    "model": "anthropic/claude-opus-4-5",
    "max_turns": 100,                // Max turns per Agent session
    "env": {
      "ANTHROPIC_BASE_URL": "",
      "ANTHROPIC_API_KEY": ""
    }
  },

  "executor": {
    "api_key": "...",                // May differ from improver
    "api_base": "",                  // Optional upstream endpoint
    "model": "anthropic/claude-haiku-4-5",
    "sdk_model_alias": "haiku",      // Agent SDK alias: haiku / sonnet / opus
    "workers": 8,                    // Parallel eval workers
    "max_iterations": 150,           // Max solver steps per item
    "thinking_enabled": true,        // Extended thinking
    "context_size": 40000,           // Token context window
    "temperature": 1.0,
    "top_p": 0.95,
    "top_k": 20,
    "presence_penalty": 1.5,
    "enable_process_pool": true,     // process pool (speeds up CLI start)
    "process_pool_size": 16,
    "pool_initialization_batch_size": 4,
    "pool_bare_mode": true,
    "env": {
      "ANTHROPIC_BASE_URL": "",
      "ANTHROPIC_API_KEY": "",
      "ANTHROPIC_MODEL": "claude-haiku-4-5",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4-5"
    }
  },

  "synthesis": {                     // Optional: model for generating eval data
    "api_base": "",
    "model": "claude-sonnet-4-5",
    "workers": 8
  }
}
```

> The file supports **JSON5** (comments, trailing commas) if the `json5`
> Python package is installed; falls back to standard JSON otherwise.

---

## Directory layout

```
~/.skillhone/
├── settings.json           # global config (you create this)
├── identities.conf         # optional: per-role Forgejo tokens (improver/developer/reviewer)
├── cache/                  # eval-repo clones (mode 0700, hidden from the agent)
├── logs/
│   └── skillhone.log       # global rotating log (10 MB × 5)
└── runs/<run_id>/
    ├── manifest.json
    ├── status.json
    ├── events.jsonl
    ├── run.log
    └── iterations/iter-NN/
        ├── metrics.json
        ├── probe_result.json
        ├── diff.patch
        ├── improver_trajectory.jsonl
        └── eval_traces/<uid>.jsonl
```

Set `SKILLHONE_HOME` to override the root directory.

---

## Environment variables

Every field can be overridden via env vars (`settings.json` wins; env is the fallback).

| Variable | Corresponding `settings.json` field |
|---|---|
| `SKILLHONE_HOME` | overrides the `~/.skillhone` root |
| `FORGEJO_URL` | `forgejo.url` |
| `FORGEJO_TOKEN` | `forgejo.token` |
| `FORGEJO_OWNER` | `forgejo.owner` |
| `API_KEY` | `api_key` |
| `IMPROVER_API_BASE` | `improver.api_base` |
| `IMPROVER_API_MODELS` | `improver.model` |
| `EXECUTOR_API_BASE` | `executor.api_base` |
| `EXECUTOR_API_MODELS` | `executor.model` |
| `EXECUTOR_API_THINKING_ENABLED` | `executor.thinking_enabled` |
| `EXECUTOR_API_CONTEXT_SIZE` | `executor.context_size` |
| `EXECUTOR_API_WORKERS` | `executor.workers` |
| `EXECUTOR_MAX_ITERATIONS` | `executor.max_iterations` |
| `SKILLHONE_ENABLE_PROCESS_POOL` | `executor.enable_process_pool` |
| `SKILLHONE_POOL_SIZE` | `executor.process_pool_size` |
| `SKILLHONE_POOL_BATCH_SIZE` | `executor.pool_initialization_batch_size` |
| `SKILLHONE_POOL_BARE_MODE` | `executor.pool_bare_mode` |
| `SYNTHESIS_API_BASE` | `synthesis.api_base` |
| `SYNTHESIS_API_MODELS` | `synthesis.model` |
| `SYNTHESIS_API_WORKERS` | `synthesis.workers` |

---

## `identities.conf` (optional)

Per-role Forgejo tokens — lets the improver, developer, and reviewer operate
under distinct identities:

```ini
[improver]
token = gitea_token_for_improver_bot

[developer]
token = gitea_token_for_developer_bot

[reviewer]
token = gitea_token_for_reviewer_bot
```

File lookup order (first match wins):

1. `~/.skillhone/identities.conf`
2. `/opt/forgejo/sdlc_identities.conf`
3. `/opt/gitea/sdlc_identities.conf`
