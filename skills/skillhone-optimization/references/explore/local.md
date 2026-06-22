# Local skill discovery

When `skillhub` and `openclaw` registries are insufficient (or you're offline)
fall back to a filesystem scan of locally installed skill trees.

## Known local skill roots

- `~/.claude/skills/` — Claude Code skills
- `~/.hermes/skills/` — Hermes skills
- `~/.openclaw/skills/` — OpenClaw skills (already installed copies)
- `~/.codex/skills/` — Codex skills

These directories all share the same convention: each immediate subdirectory
is a single skill, with a `SKILL.md` at its root.

## Discover by keyword

```bash
KEYWORD="web search"

for dir in ~/.claude/skills ~/.hermes/skills ~/.openclaw/skills ~/.codex/skills; do
  if [ -d "$dir" ]; then
    echo "=== $dir ==="
    grep -l -r --include='SKILL.md' -F "$KEYWORD" "$dir" 2>/dev/null
  fi
done
```

Tweaks:

- For a stricter match use `grep -l -i` (case-insensitive) or anchor on the
  YAML `description:` field.
- For a quick listing of all installed skills:

  ```bash
  for dir in ~/.claude/skills ~/.hermes/skills ~/.openclaw/skills ~/.codex/skills; do
    [ -d "$dir" ] && ls "$dir"
  done
  ```

## Read a hit

```bash
cat ~/.claude/skills/<name>/SKILL.md
ls ~/.claude/skills/<name>/scripts/
ls ~/.claude/skills/<name>/references/
```

## Adopt patterns

Local skills are already runnable but you should still TREAT them as reference
material when you're optimizing a different skill. Copy useful scripts and
prompts into your skill's tree (rewriting paths/names so they fit), don't
activate the local skill from the workspace.

## Failure modes

- A directory exists but is empty → just skip it.
- A `SKILL.md` is present but malformed (missing `name:` frontmatter) → ignore
  that skill, it won't load anyway.
