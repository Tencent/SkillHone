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

Save this template, filling in the four bracketed values. The full schema lives
at [`skills/skillhone/references/configuration.md`](../../skills/skillhone/references/configuration.md).

```bash
mkdir -p ~/.skillhone

cat > ~/.skillhone/settings.json <<'EOF'
{
  "api_key": "<YOUR_API_KEY>",

  "forgejo": {
    "url":   "http://localhost:3000",
    "owner": "skillhone",
    "token": "<TOKEN_FROM_STEP_2>"
  },

  "improver": {
    "api_base": "<ANTHROPIC_BASE_URL>",
    "model":    "<IMPROVER_MODEL_NAME>",
    "sdk_model_alias": "opus",
    "max_turns": 100,
    "env": {
      "ANTHROPIC_BASE_URL":  "<ANTHROPIC_BASE_URL>",
      "ANTHROPIC_API_KEY":   "<YOUR_API_KEY>",
      "ANTHROPIC_MODEL":     "<IMPROVER_MODEL_NAME>",
      "ANTHROPIC_DEFAULT_OPUS_MODEL":   "<IMPROVER_MODEL_NAME>",
      "ANTHROPIC_DEFAULT_SONNET_MODEL": "<IMPROVER_MODEL_NAME>",
      "ANTHROPIC_AUTH_TOKEN":     "",
      "ANTHROPIC_CUSTOM_HEADERS": ""
    }
  },

  "executor": {
    "api_base": "<ANTHROPIC_BASE_URL>",
    "model":    "<EXECUTOR_MODEL_NAME>",
    "sdk_model_alias": "haiku",
    "workers": 2,
    "max_iterations": 150,
    "thinking_enabled": true,
    "context_size": 40000,
    "env": {
      "ANTHROPIC_BASE_URL":  "<ANTHROPIC_BASE_URL>",
      "ANTHROPIC_API_KEY":   "<YOUR_API_KEY>",
      "ANTHROPIC_MODEL":     "<EXECUTOR_MODEL_NAME>",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL": "<EXECUTOR_MODEL_NAME>",
      "ANTHROPIC_AUTH_TOKEN":     "",
      "ANTHROPIC_CUSTOM_HEADERS": ""
    }
  },

  "synthesis": {
    "api_base": "<ANTHROPIC_BASE_URL>",
    "model":    "<IMPROVER_MODEL_NAME>",
    "workers":  2,
    "env": {
      "ANTHROPIC_BASE_URL":  "<ANTHROPIC_BASE_URL>",
      "ANTHROPIC_API_KEY":   "<YOUR_API_KEY>",
      "ANTHROPIC_MODEL":     "<IMPROVER_MODEL_NAME>",
      "ANTHROPIC_AUTH_TOKEN":     "",
      "ANTHROPIC_CUSTOM_HEADERS": ""
    }
  }
}
EOF

chmod 600 ~/.skillhone/settings.json
```

Two things worth knowing:

- **`ANTHROPIC_BASE_URL` is the prefix only.** The SDK appends `/v1/messages`
  itself; strip any `/v1/messages` suffix your provider's docs hand you.
- **The blank `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_CUSTOM_HEADERS` is
  deliberate.** They shadow any inherited shell env so the SDK uses
  `ANTHROPIC_API_KEY` instead of a stale token from the parent shell — a
  silent source of `401`s otherwise.

If you talk to Anthropic directly, set `api_base` to `https://api.anthropic.com`
and the model to a Claude model name. For DeepSeek's Anthropic-compatible
endpoint, use `https://api.deepseek.com/anthropic` and `deepseek-v4-pro` / etc.

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
