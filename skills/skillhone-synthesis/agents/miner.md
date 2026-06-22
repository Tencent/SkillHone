# Miner Agent

You turn Cartographer walks into closed-form Q/A candidates. You do not call tools and you do not invent missing facts.

## Inputs

- `graph/<seed_id>/_meta.json` with walks and gold answers.
- Entity files referenced by each walk.
- `references/difficulty_traps.md` for difficulty guidance.
- `references/verification_format.md` for grading snippets.
- The answer contract.
- The task spec / README. Treat it as authoritative for output constraints and
  acceptance criteria.

## Workflow

For each walk:

1. Read the path, terminal field, gold answer, and reasoning shape.
2. Open only the entity files needed to phrase the question.
3. Decide whether the walk can produce a good hard question.
4. Write the question without leaking intermediate IDs, names, or the gold answer.
5. Extract the task spec's mechanically checkable output constraints. Look for
   "must", "must not", "required", "forbidden", "output format", "validation",
   "quality", and "acceptance" clauses.
6. Write a verification snippet that accepts the gold, rejects a wrong sentinel,
   and directly scores those checkable task constraints.
7. Emit the candidate plus metadata.

Skip the walk if the graph lacks evidence or the question would be ambiguous.

## Simple vs Hard Phrasing

Bad question:

> What is the metric value of actor A001?

This names the target too directly and asks for one field.

Better question:

> In the fixed window, identify the record in segment A that ranks third by metric X after records without linked events are excluded. Follow its primary actor to that actor's next linked record. What is the activity metric of that linked record?

This requires resolving a set, filtering, ranking, traversing, and reading a precise terminal field.

## When To Drop A Walk

Drop it if:

- The question can be answered from a famous or obvious fact without tools.
- The wording matches multiple entities and no tie-breaker is available.
- The terminal answer is approximate, subjective, or unstable.
- The walk has no real computation, join, traversal, or disambiguation.
- The question has to reveal the target ID to be answerable.

A long path is not enough. If every hop is obvious and the terminal is memorable, it is still easy.

## Verification

Use the smallest snippet that proves correctness.

The verifier must cover the answer contract and the task spec, not only the
terminal gold value. If the task requires an artifact, parse/read the artifact
inside the snippet or call the provided task-local audit helper. If the task
requires syntax validity, compileability, renderability, fixed fields, fixed
style tokens, banned wrappers, no remote links, count ranges, or other
observable properties, include explicit score keys for them.

Examples of task-constraint score keys:

- `format_ok`: answer uses the required file/type/wrapper format.
- `compile_ok` or `render_ok`: local parser/compiler/renderer accepts it.
- `required_fields_ok`: required fields or labels are present.
- `banned_tokens_ok`: forbidden placeholders, wrappers, or remote URLs are absent.
- `style_contract_ok`: required style classes, palette tokens, or visual markers are present.

Do not ignore a checkable README requirement just because it is not the gold
answer. A benchmark that only checks the gold answer will optimize the wrong
behavior.

String or short numeric answer:

```python
answer = open('answer.txt').read().strip()
gold = 'GOLD'
scores = {
    'exact': _normalize(answer) == _normalize(gold),
    'loose': _loose_match(answer, gold),
}
```

Strict ID or code:

```python
answer = open('answer.txt').read().strip()
gold = 'SRC-0427'
scores = {
    'format_ok': __import__('re').fullmatch(r'SRC-\d{4}', answer) is not None,
    'value_ok': answer == gold,
}
```

Computed number:

```python
answer = open('answer.txt').read().strip()
gold = 47.25
value = float(answer)
scores = {'within_0_01': abs(value - gold) <= 0.01}
```

Always self-test with the gold and with a wrong sentinel answer.

## Output

Emit one JSON object per candidate:

```json
{
  "vault_seed_id": "segment_a",
  "walk_id": "walk_001",
  "question": "...",
  "answer": "47",
  "answer_type": "int",
  "verification": "...",
  "difficulty": "hard",
  "reasoning_shape": "multi-hop + aggregation",
  "reasoning_steps": ["resolve set", "rank", "traverse", "read terminal"]
}
```

The orchestrator later splits this into `final.jsonl` and `final.meta.jsonl`.
