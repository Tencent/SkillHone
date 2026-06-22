# Evaluation

## How to run

```bash
python3 scripts/eval.py --skill-dir ./my-skill --eval-dir ./my-skill-eval --split probe --n-probe 0 --output probe.json
```

## Input format — `<split>.jsonl` (eval-repo root)

`probe.jsonl` / `test.jsonl` under `eval-dir` are line-delimited JSON. Each
line is one item with the same two-key contract: `question` and
`verification`. Items can be produced by `skillhone-synthesis` **or
hand-authored and pushed directly into the eval repo** — neither
`eval.py` nor `optim.py` cares about the source, only that the schema
holds.

```json
{
  "question": "Find a non-chain restaurant within 1.5 km of Dam Square …",
  "verification": "answer = open('answer.txt').read().strip()\nscores = {\n    'single_line':   '\\n' not in answer,\n    'not_empty':     bool(answer),\n    'gold_ok':       answer == 'The Corner Restaurant',\n}"
}
```

- `question` — the full natural-language prompt. The solver sees only
  this; it never sees the gold answer or the verifier code.
- `verification` — a self-contained Python snippet (executed in an
  isolated workdir) that must populate the local variable `scores`
  (`dict[str, bool]`). After the snippet runs the verifier defaults to
  `scores_require_all = True`: every key must be `True` for the item to
  pass. For soft matching, set `'scores_require_all': False` inside the
  dict.

One JSON object per line (`*.jsonl`, strict line-by-line). The **gold
answer is embedded inside the verifier** (e.g. the `'gold_ok'` key
above) — there is no separate gold field.

> When bringing your own data: commit + push `probe.jsonl` (required)
> and optionally `test.jsonl` (used as the held-out final measurement)
> into the `<skill>-eval` repo. From there, `optim.py` and `eval.py`
> behave identically whether the data was synthesised or hand-authored.
> The full verifier-authoring spec is in
> [`skills/skillhone-synthesis/references/verification_format.md`](../../skillhone-synthesis/references/verification_format.md).

## Output format

```json
{
  "split": "probe",
  "n_items": 25,
  "n_passed": 7,
  "n_total": 25,
  "score": 0.28,
  "pass_rate": 0.28,
  "avg_duration_s": 120.5,
  "model": "<solver-model>",
  "solver_mode": "claude_agent_sdk",
  "traces": [
    {
      "uid": "gaia_001",
      "query": "What is the capital of...",
      "expected": "Paris",
      "predicted": "Paris",
      "passed": true,
      "score": 1.0,
      "duration_s": 45.2,
      "error": ""
    }
  ]
}
```

## How the solver works

For each item the harness starts one Claude Agent SDK session:

1. The skill under test is loaded into the system prompt.
2. The agent solves the question using its Bash / Read / Write / Edit tools.
3. The final answer is written to `answer.txt`.
4. The verifier code (Python `assert` style) is executed against `answer.txt`.
5. The trajectory is saved to `trajectory.jsonl` (and copied out if `--trace-dir` was specified).

## Failure analysis

```bash
python3 -c "
import sys; sys.path.insert(0, '~/.skillhone/skills/skillhone/scripts')
from evaluation.failure_analysis import generate_failure_analysis
import json
print(generate_failure_analysis(json.load(open('probe.json'))))
"
```

Emits Markdown with pattern-level analysis only — never leaks the
gold answer or the question text.
