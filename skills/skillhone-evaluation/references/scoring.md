# Evaluation Scoring Reference

## Matching Rules

The evaluator uses exact match + loose match (no LLM judge):

1. **Normalize both strings**: Unicode NFKD, lowercase, strip punctuation, normalize whitespace
2. **Strict match**: normalized(predicted) == normalized(expected)
3. **Loose match**: normalized(expected) is a substring of normalized(predicted), OR vice versa

A trace passes if EITHER strict or loose match succeeds.

## Common Matching Edge Cases

| Predicted | Expected | Match? | Why |
|-----------|----------|--------|-----|
| "Morarji Desai" | "Morarji Desai" | strict | exact |
| "BRINIEST" | "Briniest" | strict | case-insensitive after normalization |
| "b,e" | "b, e" | loose | substring after removing punctuation/spaces |
| "17000" | "17" | **NO** | "17" is substring of "17000" but exact numbers must match |
| "100%" | "86" | **NO** | completely different |

## Error Categories in Traces

| Error | Meaning |
|-------|---------|
| (empty) | Clean execution, answer written normally |
| `Recursion limit of 150 reached...` | Agent hit step limit (timeout) |
| `hard timeout 1200s` | Wall-clock timeout |
| `answer from LLM fallback guess` | No answer.txt found; LLM guessed |
| `answer scraped from workdir` | Found answer in unexpected location |

## Scoring Implications for Iteration

- **Recursion limit errors** → skill needs fewer steps / tighter budget
- **LLM fallback** → skill needs "always write answer.txt" enforcement
- **Clean wrong answers** → search strategy needs improvement
- **Substring match failures** → format guidance needed in SKILL.md
