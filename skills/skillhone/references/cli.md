# Scripts Reference

## status.py — inspect the current repo's state

```bash
python3 scripts/status.py [--repo <repo|owner/repo>] [--repo-url <forgejo-url>] [--state open|closed|all] [--json]
```

Read-only dashboard of Forgejo Issues / PRs for the current repo. Run
this before any diagnose / develop / review / merge / optimisation
cycle so you don't duplicate an existing issue, miss an open PR, or
operate on the wrong repo.

| Flag | Required | Description |
|------|----------|-------------|
| `--repo` | no | repo name or `owner/repo`; overrides the configured repo |
| `--repo-url` | no | Forgejo clone / web URL; used to infer owner / repo / base URL |
| `--state` | no | `open` / `closed` / `all` (default `all`) |
| `--limit` | no | rows per list (default 12) |
| `--max-items` | no | max remote records fetched per category (default 200) |
| `--json` | no | machine-readable JSON output for agent consumption |
| `--show-sources` | no | show the resolution source for each config field; tokens are summarised, never printed |

Configuration resolution order: CLI flag → `FORGEJO_*` env vars →
`_data/forgejo_config.txt` / `_data/config.json` searched up from cwd →
git `origin` → `~/.skillhone/settings.json`. Missing required fields
or any API failure exits non-zero.

## eval.py — run an evaluation

```bash
python3 scripts/eval.py --skill-dir <path> --eval-dir <path> --split probe [--n-probe 0] [--output result.json] [--trace-dir traces/]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--skill-dir` | ✅ | path to the skill being tested (must contain `SKILL.md`) |
| `--eval-dir`  | ✅ | path to the eval repo (must contain `probe.jsonl` + `evaluator/`) |
| `--split`     | ✅ | `probe` / `train` / `test` |
| `--n-probe`   | no | how many items to evaluate; `0` = all |
| `--output`    | no | output JSON path |
| `--trace-dir` | no | directory in which to copy each solver's trajectory |
| `--iteration` | no | iteration index used to window/save outputs |

## synth.py — synthesise eval data (optional regression gate)

```bash
python3 scripts/synth.py --repo <forgejo-url> [--target 10] [--splits probe[,test]] \
        [--target-pass-rate-max 0.30] [--max-resynth 3] [--regression-split probe] \
        [--max-turns 200] [--no-push]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--repo`                 | ✅ | Forgejo skill-repo URL; the eval repo is inferred as `<repo>-eval.git` |
| `--target`               | no | items per split (default 10) |
| `--splits`               | no | comma-separated split names (default `probe,test`) |
| `--target-pass-rate-max` | no | enable the synth-stage regression gate: after each draft, the seed skill runs `eval.py --mode seed`; if the pass rate exceeds this value, redraft. Typical `0.30` (probe must be hard enough that the un-optimised seed solves at most 30%). Omit for single-shot synth (historical behaviour). |
| `--max-resynth`          | no | upper bound on redraft rounds when `--target-pass-rate-max` is set (default 3) |
| `--regression-split`     | no | which split runs the regression eval (default `probe`) |
| `--max-turns`            | no | max turns per synth agent run (default 200) |
| `--no-push`              | no | generate locally but don't push to Forgejo |

When the regression gate is on, each round writes a
`Synth-Iteration-N` markdown to
`<eval-clone>/synthesis_observations/iter_NN.md` and pushes it to the
eval repo — symmetric to the `Iteration-N-Observation` wiki pages
`optim.py` writes to the skill repo. The skill repo must already be
seeded (`scripts/seed.py`) — running the regression gate without a
committed seed is rejected by `_check_seed_committed`.

## optim.py — optimisation loop

```bash
python3 scripts/optim.py --repo <forgejo-url> [--iters 5] [--patience 2] [--max-turns 200]
```

Launches a Claude Agent SDK session with `skillhone`,
`skillhone-evaluation`, and `skillhone-optimization` mounted. The
agent decides autonomously when to eval, when to optimise, and when
to stop.

## new.py — create an experiment

```bash
python3 scripts/new.py <name> --instruction <README.md|inline-text> --data-dir <data-dir> [--no-run]
```

Creates a public skill repo and a private eval repo on Forgejo and
pushes the initial content into both.

## seed.py — initialise a skill

```bash
python3 scripts/seed.py --repo <forgejo-url>
python3 scripts/seed.py <local-path>
```

Uses SkillHone's bundled scaffold to generate `SKILL.md`,
`references/task.md`, and `scripts/validate_seed.py` from the target
repo's `README.md`, then runs the built-in static-quality check.

## serve.py — webhook listener

```bash
python3 scripts/serve.py [--port 8790] [--host 0.0.0.0] [--secret <hmac>]
```

Logs incoming Forgejo events (PR / Issue / Push).
