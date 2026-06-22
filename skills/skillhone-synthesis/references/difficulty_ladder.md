# Difficulty Levels

Use difficulty labels to describe why a question is hard, not to decorate the dataset.

## Easy

One direct lookup or one simple transformation.

Example: given an explicit record ID, return one field.

## Medium

Requires resolving an entity or doing a small computation, but the path is short and the terminal is straightforward.

Example: find a record by a stable attribute, then return a count.

## Hard

Requires several of the following in one question:

- Attribute-based entity resolution.
- Multi-hop traversal.
- Cross-source join.
- Aggregation or derived threshold.
- Exclusion, tie-breaker, or fixed window.
- Precise terminal format.

Hard does not mean verbose. A concise question can be hard if the solver must perform real operations to answer it.

## Invalid

Do not label a question hard if it is only long, only obscure, or only full of arbitrary filters. If the answer is ambiguous, drifting, subjective, or guessable without tools, it should not ship.
