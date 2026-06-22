---
name: forgejo
description: >
  Forgejo REST API toolkit — manage issues, pull requests, wikis, and repos on
  a Forgejo server. Use when the agent needs to file an issue, open / review /
  merge a PR, read or write a wiki page, or look up repo / branch info. One
  standalone script per resource type. Reads credentials from environment,
  `~/.skillhone/settings.json`, or `_data/forgejo_config.txt`.
compatibility: Requires Python 3.10+ and network access to a Forgejo instance.
---

# Forgejo

Thin wrapper around the Forgejo REST API. Each resource lives in its own script
so the agent can discover and invoke them individually. SkillHone depends on
this as a VCS backend skill, but it stays independent so another backend such as
GitLab or Gitea can provide the same workflow surface.

## Scripts

| Script | Resource | Representative usage |
|--------|----------|----------------------|
| `scripts/issue.py` | Issues | `python3 scripts/issue.py create --title "Bug"` |
| `scripts/pr.py` | Pull requests | `python3 scripts/pr.py merge 1` |
| `scripts/wiki.py` | Wiki pages | `python3 scripts/wiki.py get --title "Analysis"` |
| `scripts/repo.py` | Repo metadata | `python3 scripts/repo.py branches` |
| `scripts/summary.py` | Aggregate dashboard | `python3 scripts/summary.py` |

Every script supports `--help`. Run it before guessing flags.

## Configuration

Resolved in this order (first match wins):

1. Environment variables: `FORGEJO_URL`, `FORGEJO_TOKEN`, `FORGEJO_OWNER`, `FORGEJO_REPO`
2. `~/.skillhone/settings.json` + `~/.skillhone/identities.conf`
3. `_data/forgejo_config.txt` in the current working directory

If nothing is set, the script exits with a clear message naming the missing variable.

## Usage By Resource

### Issues

```bash
python3 scripts/issue.py list
python3 scripts/issue.py view <N>
python3 scripts/issue.py create --title "Fix: timeout" --body "## Problem\n..."
python3 scripts/issue.py close <N>
python3 scripts/issue.py comment <N> --body "Done"
```

### Pull Requests

```bash
python3 scripts/pr.py list
python3 scripts/pr.py view <M>
python3 scripts/pr.py create --title "Fix timeout" --head fix/timeout --base main --body "Closes #1"
python3 scripts/pr.py review <M> --approve
python3 scripts/pr.py merge <M> --method merge
python3 scripts/pr.py comment <M> --body "LGTM"
```

### Wiki

```bash
python3 scripts/wiki.py list
python3 scripts/wiki.py get --title "Iteration-1-Observation"
python3 scripts/wiki.py create --title "Page" --body "content"
python3 scripts/wiki.py edit --title "Page" --body "updated content"
```

### Repo Metadata

```bash
python3 scripts/repo.py info
python3 scripts/repo.py branches
```

### Combined Summary

```bash
python3 scripts/summary.py
# open issues + open PRs + latest observation wiki page
```

## Invocation From Other Skills

Other skills living under `~/.skillhone/skills/` call these scripts via their
absolute path:

```bash
python3 ~/.skillhone/skills/forgejo/scripts/issue.py list
```

This keeps the VCS backend replaceable. A GitLab or Gitea skill can expose an
equivalent command surface without changing SkillHone's optimization logic.

## Gotchas

- Tokens with `@` characters break git clone URL injection. Use a token without `@` or URL-encode it.
- `merge --method squash` is not supported by older Forgejo versions. If you hit `Unknown method`, fall back to `merge`.
- Wiki pages are stored as `.md` files in a separate git repo (`<repo>.wiki.git`). `wiki.py` hides that, but if you need custom editing, clone the wiki repo directly.

## Hard Rules

- Never print the Forgejo token to stdout/stderr logs. The scripts already redact; don't paste it into `--body` fields.
- Do not call Forgejo's REST API directly with `curl` or handcrafted HTTP from
  SkillHone workflows. Use these backend scripts so credential loading,
  redaction, and backend replacement stay centralized.
- Do not `cat` `_data/forgejo_config.txt`, `~/.skillhone/settings.json`, or
  `identities.conf` to discover credentials. The scripts resolve credentials
  internally.
- Do not push directly to `main` via any of these scripts. PRs only.
- When you get a 401/403, re-check the config resolution order above before changing the script.
