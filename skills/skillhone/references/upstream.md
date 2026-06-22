# Upstream binding & sync

The `skillhone` skill is bound to a single canonical upstream repository:

> **<https://github.com/Tencent/SkillHone>**

That repository is where the harness's full implementation lives — the
sibling skills (`skillhone-evaluation`, `skillhone-optimization`,
`skillhone-prd`, `skillhone-synthesis`, `forgejo`), the `scripts/`
directory, the `references/`, and the bundled `assets/`. When the
`skillhone` skill is delivered through a hub (SkillHub, an internal
mirror, an `agentskills.io`-protocol runtime, etc.) the SKILL.md alone is
not the implementation; **the runtime must pull the full repository from
the bound upstream** before the harness scripts can run.

This page documents that procedure for both cases:

1. **Initial fetch** — first time the skill is being set up on a
   machine, `~/.skillhone/skills/` is empty or missing.
2. **Refresh** — `~/.skillhone/skills/` already contains earlier
   copies; user asks to *update*, *upgrade*, *refresh*, or *pull
   latest*.

Both cases run the same procedure. It is idempotent.

## What gets fetched

Everything under `skills/` in the upstream repo, mirrored into
`~/.skillhone/skills/`:

- `skills/skillhone/` (this skill)
- `skills/skillhone-evaluation/`
- `skills/skillhone-optimization/`
- `skills/skillhone-prd/`
- `skills/skillhone-synthesis/`
- `skills/forgejo/`

## What is preserved

The procedure does **not** touch:

- `~/.skillhone/settings.json` — model credentials and Forgejo config
- `~/.skillhone/runs/` — past optimisation run history
- `~/.skillhone/cache/` — eval-repo clones
- Anything else outside `~/.skillhone/skills/`

## Procedure

```bash
# 1. Shallow-clone upstream into a scratch directory
WORK=$(mktemp -d)
git clone --depth=1 https://github.com/Tencent/SkillHone "$WORK/SkillHone"

# 2. Mirror each skill folder into ~/.skillhone/skills/.
#    cp -R (NOT cp -p) — drops xattrs that block macOS cross-volume copies.
mkdir -p "$HOME/.skillhone/skills"
for sd in "$WORK/SkillHone/skills/"*/; do
  name=$(basename "$sd")
  [[ -f "$sd/SKILL.md" ]] || continue
  rm -rf "$HOME/.skillhone/skills/$name"
  cp -R "$sd" "$HOME/.skillhone/skills/$name"
done

# 3. Clean up
rm -rf "$WORK"
ls ~/.skillhone/skills/
```

If the user wants to pin to a specific tag, branch, or commit:

```bash
git clone --depth=1 --branch <tag-or-branch> https://github.com/Tencent/SkillHone "$WORK/SkillHone"
# or, after a full clone:
git -C "$WORK/SkillHone" checkout <commit-sha>
```

## After the sync

- Smoke-check the python modules compile:
  ```bash
  python3 -m py_compile $HOME/.skillhone/skills/skillhone/scripts/*.py
  ```
- A new release may add fields to `~/.skillhone/settings.json`. The
  schema is backward-compatible (new keys default to sensible values),
  but the user may want to read the diff under
  `skills/skillhone/references/configuration.md`.
- If the user has uncommitted local edits under
  `~/.skillhone/skills/<skill>/`, this procedure overwrites them.
  Stash or commit them somewhere first.
