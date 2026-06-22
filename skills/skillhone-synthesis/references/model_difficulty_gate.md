# Model Difficulty Gate

Mechanical validation proves that a question is well-formed. It does not prove that the question is hard for the target solver. The model difficulty gate is an optional empirical check.

## Procedure

For a candidate batch:

1. Run the target solver with the same tools it will have at evaluation time.
2. Do not show the gold answer or this skill's instructions.
3. Give a tight budget so the solver either solves it quickly or gives up.
4. Grade the solver's `answer.txt` with the candidate's own verification snippet.

## Interpretation

- Solver passes: candidate is probably too easy for that solver. Reject or rewrite.
- Solver is wrong: candidate may be useful.
- Solver gives no answer or times out: candidate may be useful, but inspect for ambiguity.

## Batch Signal

If many candidates pass the probe, regenerate with harder reasoning shapes: more joins, more aggregation, stronger disambiguation, or more precise terminal formats.

Do not solve this by adding entity lists. Solve it by changing the reasoning work required.
