# skillhub — community skill registry

`skillhub` is the broadest community registry. First stop for almost any
search.

## Search

```bash
# Search by keyword(s)
skillhub search "web search"
skillhub search "browser"
skillhub search "arxiv"
skillhub search "pdf extraction"

# JSON output (when you want to script over results)
skillhub search "calendar" --json
```

Multiple words are AND-matched. Try one specific keyword first; if you get
nothing, broaden it.

## Install

Install candidate skills as reference material under `.refer/skills/`:

```bash
skillhub --dir .refer/skills install <slug>
```

Then read what it actually does:

```bash
cat .refer/skills/<slug>/SKILL.md
ls .refer/skills/<slug>/scripts/
```

## List installed

```bash
skillhub list
skillhub --dir .refer/skills list
```

## Tuning

| Flag | Purpose |
|------|---------|
| `--search-url URL` | Use a non-default registry (or `SKILLHUB_SEARCH_URL` env) |
| `--search-limit N` | Cap result count |
| `--search-timeout S` | Network timeout |

## Failure modes

- `skillhub` not installed → skip and use `openclaw skills` (see `clawhub.md`)
  or local scan (see `local.md`).
- Empty results → try a synonym (`web search` → `search engine`, `pdf extraction` → `pdf parsing`).
- Slow network → add `--search-timeout 5` and continue.
