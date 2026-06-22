# Verification Format

The final benchmark line must be executable and machine-checkable.

## Final Files

`final.jsonl` contains the grader-facing fields:

```json
{"question": "...", "verification": "..."}
```

`final.meta.jsonl` contains answer and debugging metadata:

```json
{"answer": "GOLD", "answer_type": "string", "seed_id": "segment_a", "walk_id": "walk_001"}
```

## Snippet Runtime

The grader runs the `verification` string in a directory containing `answer.txt`. Available helpers:

- `answer`: legacy injected string, but prefer reading `answer.txt`.
- `_normalize(s)`: normalize strings for comparison.
- `_loose_match(pred, exp)`: normalized equality or substring match.
- `_llm_judge_equal(pred, exp)`: optional semantic equivalence helper.

Import modules inside the snippet if needed.

## Default String Template

```python
answer = open('answer.txt').read().strip()
gold = 'GOLD'
scores = {
    'exact': _normalize(answer) == _normalize(gold),
    'loose': _loose_match(answer, gold),
}
```

## Strict Format Template

```python
import re
answer = open('answer.txt').read().strip()
gold = 'SRC-0427'
scores = {
    'format_ok': re.fullmatch(r'SRC-\d{4}', answer) is not None,
    'value_ok': answer == gold,
}
```

## Numeric Template

```python
answer = open('answer.txt').read().strip()
gold = 47.25
value = float(answer)
scores = {
    'within_0_01': abs(value - gold) <= 0.01,
}
```

## JSON Template

```python
import json
answer = open('answer.txt').read().strip()
obj = json.loads(answer)
scores = {
    'parses': isinstance(obj, dict),
    'code_ok': obj.get('code') == 'SRC-0427',
    'count_ok': obj.get('count') == 3,
}
```

## Required Self-Test

Before shipping a candidate, run the snippet twice:

1. With the gold answer. At least one score must be true.
2. With a wrong sentinel answer. No score may be true.

If a wrong answer passes, the verifier is broken even if the question sounds good.

## Task Constraint Coverage

The verifier should score every mechanically checkable requirement from the task
spec / README, not just the gold answer. Add separate `scores` keys for required
formats, artifact files, parser/compile/render success, required fields, banned
tokens, count ranges, fixed style tokens, local-only dependencies, and similar
observable constraints.

Good pattern:

```python
answer = open('answer.txt').read()
scores = {
    'gold_ok': 'GOLD' in answer,
    'format_ok': answer.startswith('EXPECTED_PREFIX'),
    'banned_tokens_ok': 'TODO' not in answer and '```' not in answer,
}
```

Bad pattern:

```python
answer = open('answer.txt').read()
scores = {'gold_ok': 'GOLD' in answer}
```

The bad pattern ignores the task's output contract. If the README says a
property is required and it can be checked deterministically, include it.
