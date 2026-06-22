# Configuration & Directory Structure

## ~/.skillhone/settings.json

Copy the annotated template to get started:
```bash
mkdir -p ~/.skillhone
cp assets/settings.json ~/.skillhone/settings.json
# then edit to fill in your values
```

### Full Schema

```json
{
  "api_key": "sk-ant-...",           // Anthropic API key for the improver

  "forgejo": {
    "url": "http://localhost:3000",  // Forgejo HTTP address (no trailing slash)
    "owner": "skillhone",            // Forgejo username owning all skill repos
    "token": "..."                   // Personal Access Token (repo+issue+PR scopes)
  },

  "improver": {
    "api_base": "",                  // API proxy (blank = use official endpoint)
    "model": "claude-opus-4-5",      // Agent model for the optimization loop
    "max_turns": 100,                // Max turns per Agent session
    "env": {
      "ANTHROPIC_BASE_URL": "",
      "ANTHROPIC_API_KEY": ""
    }
  },

  "executor": {
    "api_base": "",                  // API proxy for the eval solver
    "model": "claude-haiku-4-5",     // Solver model (haiku = fast/cheap)
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
