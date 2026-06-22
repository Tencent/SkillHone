# Install SkillHone

> You are an AI assistant being asked to install **SkillHone** into the
> user's local agent-runtime environment. Follow the steps below and ask
> the user only what's needed; the rest is shell work you can run yourself.

Repository: https://github.com/Tencent/SkillHone

---

## Step 1 — Detect the active agent runtime

Probe the user's home directory for known skill folders and pick the runtime
they're using. Check in this order:

| Runtime         | Skill directory               |
|-----------------|-------------------------------|
| Claude Code     | `~/.claude/skills/`           |
| Codex           | `~/.codex/skills/`            |
| OpenClaw        | `~/.openclaw/skills/`         |
| Hermes          | `~/.hermes/skills/`           |
| Lighthouse      | `~/.lighthouse/skills/`       |
| Kimi            | `~/.kimi/skills/`             |
| Other           | any directory containing `skills/` that follows the [agentskills.io](https://agentskills.io) protocol |

- If **exactly one** of the above exists, use it.
- If **multiple** exist, ask the user which one to install into.
- If **none** exist, ask the user which runtime they're using and what its
  skills directory is.

Call this directory `$SKILLS_DIR` below.

## Step 2 — Check for an existing install

If `$SKILLS_DIR/skillhone/SKILL.md` already exists, **skip Step 3** — the
skill is already installed. Tell the user and continue to Step 4 to make
sure configuration is in place.

## Step 3 — Copy the skill in

```bash
set -e
TMPDIR=$(mktemp -d)
git clone --depth=1 https://github.com/Tencent/SkillHone.git "$TMPDIR/SkillHone"
cp -r "$TMPDIR/SkillHone/skills/skillhone" "$SKILLS_DIR/"
rm -rf "$TMPDIR"
```

> Use `cp -r`, not `ln -sf`. Other skills may already live under
> `$SKILLS_DIR/` and a symlinked directory would clash with them.

After this step, `$SKILLS_DIR/skillhone/SKILL.md` must exist. Verify it.

## Step 4 — Configure

SkillHone reads `~/.skillhone/settings.json` for its model credentials.
The only thing you actually need from the user is **one set of model
credentials** for the optimisation loop.

**Default — Anthropic direct.** Ask only for an Anthropic API key.
`claude-agent-sdk` uses Anthropic's official endpoint by default, so
no `base_url` / `model_name` overrides are needed.

**Third-party Anthropic-compatible providers** (e.g. DeepSeek).
Only when the user explicitly routes through such a
provider, ask for three fields:

| Required | Optional |
|---|---|
| **Optimizer LLM** — `base_url` (Anthropic-format), `api_key`, `model_name`. | **Executor LLM** — same three fields. If omitted, SkillHone reuses the optimizer settings for the eval solver. |

Example values to ask for, in plain English:

```
base_url   = https://api.deepseek.com/anthropic
api_key    = sk-xxx
model_name = deepseek-v4-pro
```

Then write `~/.skillhone/settings.json` yourself, following the schema in
[`skills/skillhone/references/configuration.md`](../../skills/skillhone/references/configuration.md).

Minimum JSON (improver only):

```jsonc
{
  "api_key": "<user api_key>",
  "improver": {
    "api_base": "<user base_url>",
    "model":    "<user model_name>"
  }
}
```

If the user provides an Executor LLM, add a parallel `"executor"` section. If not,
omit `"executor"` and SkillHone will reuse `improver`. Do not invent any other
fields — leave Forgejo and other sections out unless the user asked for a
self-hosted Git backend (see Step 5).

## Step 5 — Optional self-hosted Forgejo

This step is **only** needed if the user explicitly asked for a self-hosted
Git server. Otherwise skip it.

1. Start Forgejo: `docker compose up -d` using the file at
   `skills/skillhone/assets/docker-compose.yml`.
2. Have the user create an admin account at `http://localhost:3000`,
   create a dedicated `skillhone` user, and mint a Personal Access Token
   with `repo` + `issue` + `pull-request` read/write scopes.
3. Add the resulting block to `~/.skillhone/settings.json`:
   ```jsonc
   "forgejo": {
     "url":   "http://localhost:3000",
     "owner": "skillhone",
     "token": "<the PAT>"
   }
   ```

## Step 6 — Verify and report

Report back to the user:

- The install path: `$SKILLS_DIR/skillhone/`
- Whether `~/.skillhone/settings.json` was written, and which sections
  it contains (`improver` only, or `improver` + `test`, with or without
  `forgejo`).
- A one-line next step they can try in their runtime, for example:
  *"Open Claude Code and ask it to use the `skillhone` skill on an
  existing skill repo."*

---

## Updating

To update an existing install, re-run **Step 3**. The `cp -r` overwrites
`$SKILLS_DIR/skillhone/` in place.

## Uninstalling

```bash
rm -rf $SKILLS_DIR/skillhone
# settings.json is left in place; remove it manually if you want a clean uninstall:
# rm ~/.skillhone/settings.json
```
