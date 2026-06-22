# clawhub — OpenClaw skill registry

Accessed via the `openclaw` CLI. A separate registry from skillhub — the two
rarely overlap, so always run both when discovering tools.

## Search

```bash
# Search the OpenClaw registry
openclaw skills search "calendar"
openclaw skills search "browser"
openclaw skills search "web search"
```

Multiple words are AND-matched.

## Install / fetch as reference

```bash
# Install into the workspace .refer/ tree (study only, do not activate)
openclaw skills install <slug> --dir .refer/skills
```

If your version of the CLI uses a different flag for the destination, run
`openclaw skills install --help` to confirm. The goal is the same: land the
skill under `.refer/skills/<slug>/` so you can read its `SKILL.md` and
`scripts/` without polluting the project's active skill set.

## List installed

```bash
openclaw skills list
```

## Read what it does

```bash
cat .refer/skills/<slug>/SKILL.md
ls .refer/skills/<slug>/scripts/
ls .refer/skills/<slug>/references/
```

## Failure modes

- `openclaw` CLI missing → skip and rely on skillhub + local scan.
- Different sub-command shape on older versions → try `openclaw search …`
  without the `skills` segment.
- No results → don't give up; the same query through `skillhub` may hit
  (different ecosystems index differently).
