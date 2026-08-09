# Installation

This guide walks through a fresh local SkillHone setup. The commands assume
macOS / Linux; Windows works equivalently under WSL2.

## Requirements

- Python 3.10+
- Docker with the `docker compose` plugin
- Git 2.38+
- **Required for the default LLM path (`claude-agent-sdk`):** Node.js 18+ and the `claude` CLI on `PATH`. Install with `npm install -g @anthropic-ai/claude-code`. The SDK is a thin Python wrapper that shells out to this CLI; without it `optim.py` / `synth.py` / the eval solver crash with `FileNotFoundError: claude`.

The repo expects a Forgejo instance for skill / eval repositories; the bundled
`docker-compose.yml` brings one up pre-installed (no Web setup wizard).

---

## 1. Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r skills/skillhone/assets/requirements.txt
```

Verify:

```bash
python3 -c "import json5, httpx, git, yaml, requests, claude_agent_sdk"
```

---

## 2. Forgejo backend

The bundled `docker-compose.yml` is pre-configured (SQLite + `INSTALL_LOCK=true`)
so Forgejo boots ready-to-use — no Web setup wizard.

```bash
# Optional: change host port if 3000 is taken (Cursor / Grafana / etc.)
export FORGEJO_HTTP_PORT=3000

docker compose -f skills/skillhone/assets/docker-compose.yml up -d

# Wait until API is up (~10 s):
until curl -fsS "http://localhost:${FORGEJO_HTTP_PORT}/api/v1/version" >/dev/null; do sleep 1; done
```

Create the admin user (the image ships with zero users):

```bash
ADMIN=skillhone
PW=skillhone-dev   # change in production

docker compose -f skills/skillhone/assets/docker-compose.yml \
  exec -T -u 1000 forgejo \
  forgejo admin user create \
    --username "$ADMIN" --password "$PW" \
    --email "$ADMIN@localhost" \
    --admin --must-change-password=false
```

Generate a Personal Access Token:

```bash
TOKEN=$(curl -fsS -u "$ADMIN:$PW" \
  -H 'Content-Type: application/json' \
  -X POST "http://localhost:${FORGEJO_HTTP_PORT}/api/v1/users/$ADMIN/tokens" \
  -d '{"name":"skillhone","scopes":["write:repository","write:issue","write:user","write:organization"]}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['sha1'])")

echo "$TOKEN"   # save this — Forgejo only shows it once
```

---

## 3. Mount skills into `~/.skillhone/skills/`

`synth.py` and `optim.py` mount skills from `~/.skillhone/skills/` (and
`~/.claude/skills/`) into each agent run's workspace. Copy them once:

```bash
mkdir -p ~/.skillhone/skills
for sd in skills/*/; do
  name=$(basename "$sd")
  [[ -f "$sd/SKILL.md" ]] || continue
  rm -rf "$HOME/.skillhone/skills/$name"
  cp -R "$sd" "$HOME/.skillhone/skills/$name"
done
```

Use `cp -R` (not `cp -p`) so cross-volume copies don't trip on macOS extended
attributes. Symlinks also work on regular filesystems.

---

## 4. Write `~/.skillhone/settings.json`

Save this template with a LiteLLM `provider/model` name and credentials for
each role. The full schema lives
at [`skills/skillhone/references/configuration.md`](../../skills/skillhone/references/configuration.md).

```bash
mkdir -p ~/.skillhone

cat > ~/.skillhone/settings.json <<'EOF'
{
  "forgejo": {
    "url":   "http://localhost:3000",
    "owner": "skillhone",
    "token": "<TOKEN_FROM_STEP_2>"
  },

  "improver": {
    "api_key":  "<IMPROVER_API_KEY>",
    "model":    "<PROVIDER/MODEL>",
    "api_base": "<OPTIONAL_UPSTREAM_ENDPOINT>",
    "sdk_model_alias": "opus",
    "max_turns": 100,
    "env": {}
  },

  "executor": {
    "api_key":  "<EXECUTOR_API_KEY>",
    "model":    "<PROVIDER/MODEL>",
    "api_base": "<OPTIONAL_UPSTREAM_ENDPOINT>",
    "sdk_model_alias": "haiku",
    "workers": 2,
    "max_iterations": 150,
    "thinking_enabled": true,
    "context_size": 40000,
    "env": {}
  },

  "synthesis": {
    "api_key":  "<SYNTHESIS_API_KEY>",
    "model":    "<PROVIDER/MODEL>",
    "api_base": "<OPTIONAL_UPSTREAM_ENDPOINT>",
    "workers":  2,
    "env": {}
  }
}
EOF

chmod 600 ~/.skillhone/settings.json
```

`api_base` is optional: omit it to use LiteLLM's standard endpoint for the
provider. For example, DeepSeek can use `deepseek/deepseek-chat` with no
`api_base`; Anthropic can use an `anthropic/claude-...` model. SkillHone starts
a loopback-only proxy and injects its Anthropic Messages endpoint into Claude
Agent SDK automatically. Do not configure `ANTHROPIC_BASE_URL` yourself.

The Executor and Synthesis sections are optional. Omit either section to reuse
the Improver model profile. Prefer `api_key_env` over `api_key` when credentials
are already managed in the process environment.

---

## 5. Smoke-check

```bash
# Settings load and the Forgejo token authenticates:
curl -fsS -H "Authorization: token $TOKEN" \
     "http://localhost:${FORGEJO_HTTP_PORT}/api/v1/user" | head

# All harness scripts compile:
python3 -m py_compile \
  skills/skillhone/scripts/{eval,optim,new,seed,serve,status,synth}.py
```

The harness is now ready to be driven from any agent runtime that mounts
the SkillHone skill bundle.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `curl http://localhost:3000` → connection reset | Port 3000 is taken (Cursor / Grafana / etc.). Set `FORGEJO_HTTP_PORT=3001` and redo step 2 |
| Agent gets `401 Authentication Fails` | Shell exports `ANTHROPIC_AUTH_TOKEN` for a different account. Either `unset` it or rely on the blank-string override in `settings.json` |
| `synth.py` mounts 0 skills, skipped 6 (`Operation not permitted`) | Repo lives on iCloud / mounted volume; macOS extended attributes blocked the copytree. Use `cp -R` in step 3, not symlinks |
| `forgejo admin user create` complains | Container started with `INSTALL_LOCK=false` (you brought your own compose). `docker compose down -v` and redeploy with the bundled compose |

---

## Reset

```bash
docker compose -f skills/skillhone/assets/docker-compose.yml down -v   # wipes Forgejo db + volumes
rm -rf ~/.skillhone                                                     # wipes settings, runs, history, cache
```
