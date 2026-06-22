# SkillHone Configuration Reference

All SkillHone configuration lives under `~/.skillhone/`. This document explains
how agents read configuration to assume different roles.

## Directory Layout

```
~/.skillhone/
├── settings.json          # Global config (API endpoints, model names, tool creds)
├── identities.conf        # Forgejo agent identities (roles + tokens)
├── cache/                 # Eval repo clones (0700, private)
├── workspaces/            # Per-iteration agent workspaces
├── runs/                  # Experiment logs and results
└── logs/                  # Runtime logs
```

## settings.json

Main configuration file. All SkillHone components read from this.

```json
{
  "api_key": "<auth-key-for-vLLM>",
  "improver": {
    "api_base": "http://...",
    "model": "claude-sonnet-4-6"
  },
  "test": {
    "api_base": "http://...",
    "model": "<configured in settings.json>",
    "thinking_enabled": true,
    "context_size": 110000,
    "workers": 16,
    "temperature": 1.0,
    "top_p": 0.95,
    "top_k": 20,
    "presence_penalty": 1.5,
    "max_iterations": 250
  },
  "tools": {
    "domain_tools_base": "http://localhost:8080/tools",
    "domain_tools_readonly": "...",
    "domain_tools_admin": "..."
  },
  "forgejo": {
    "url": "http://localhost:3000",
    "owner": "skillhone"
  }
}
```

## identities.conf

INI-format file mapping agent roles to Forgejo credentials.

```ini
[developer]
username=developer
email=developer@skillhone.local
token=<forgejo-api-token>

[reviewer]
username=reviewer
email=reviewer@skillhone.local
token=<forgejo-api-token>

[issue-reporter]
username=issue-reporter
email=issue-reporter@skillhone.local
token=<forgejo-api-token>
```

## How Agents Read Config

### Reading settings.json (Python)
```python
import json
from pathlib import Path

config_path = Path.home() / ".skillhone" / "settings.json"
cfg = json.loads(config_path.read_text())

# Access Forgejo config
forgejo_url = cfg["forgejo"]["url"]
forgejo_owner = cfg["forgejo"]["owner"]
```

### Reading identities.conf (Python)
```python
import configparser
from pathlib import Path

ident_path = Path.home() / ".skillhone" / "identities.conf"
parser = configparser.ConfigParser()
parser.read(str(ident_path))

# Get developer credentials
dev_user = parser["developer"]["username"]
dev_token = parser["developer"]["token"]
```

### Setting environment for the forgejo scripts
```bash
# Read from settings.json
export FORGEJO_URL=$(python3 -c "import json; print(json.load(open('$HOME/.skillhone/settings.json'))['forgejo']['url'])")
export FORGEJO_OWNER=$(python3 -c "import json; print(json.load(open('$HOME/.skillhone/settings.json'))['forgejo']['owner'])")

# Read token for a specific role from identities.conf
export FORGEJO_TOKEN=$(python3 -c "
import configparser
p = configparser.ConfigParser()
p.read('$HOME/.skillhone/identities.conf')
print(p['developer']['token'])
")
```

### Using forgejo scripts with role
```bash
# As developer:
python3 scripts/issue.py --role developer create --title "Fix bug"

# As reviewer:
python3 scripts/pr.py --role reviewer review 5 --approve
```

## Role Simulation

Each SDLC agent (issue-reporter, developer, reviewer, etc.) operates with its
own Forgejo identity. This enables:
- Audit trail (who did what)
- Permission separation (reviewer can't push to main)
- Realistic multi-agent collaboration

To simulate a role, set `FORGEJO_TOKEN` to that role's token from identities.conf.

## Environment Variable Precedence

1. Explicit env vars (FORGEJO_URL, FORGEJO_TOKEN, etc.)
2. `_data/forgejo_config.txt` in workspace (if running in iteration)
3. `~/.skillhone/settings.json` (global fallback)
4. `~/.skillhone/identities.conf` (for role tokens)
