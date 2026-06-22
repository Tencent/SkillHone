---
name: skillhone-synthesis
description: "Use this skill to synthesize closed-form, automatically verifiable benchmark Q/A by exploring a tool environment, building a reusable exploration graph, and mining multiple hard questions from that graph. Use for: building a benchmark, writing eval items, generating evaluation data, closed-form QA, verifiable-answer datasets, synthesising eval data. Applies to any domain with callable tools. Do not use for open-ended writing, subjective scoring, or pure labeling."
version: 0.2.0
author: skillhone
---

# SkillHone Synthesis

This skill builds a generic closed-form Q/A dataset from real tool use.

Closed-form means each question has one intended answer, and the answer can be checked by code: exact match, regex, numeric tolerance, enum, or JSON field checks. The final benchmark should not require a human or an LLM judge for basic grading.

The central idea is simple:

1. Explore the target environment with tools.
2. Save what was learned as a graph of entities, relations, and reasoning walks.
3. Mine several Q/A samples from that graph.
4. Validate that each sample is answerable, unique, stable, hard enough, and mechanically gradable.

The skill is domain-agnostic. Concrete task files, tool wrappers, and domain examples live outside this skill.

## Task Spec Coverage

The task description is the source of truth for both the solver prompt and the
verifier. When a task spec uses words such as "must", "must not", "required",
"forbidden", "output format", "validation", "quality", or "acceptance", treat
those clauses as benchmark requirements.

For every requirement in the task spec that can be checked mechanically, the
generated verifier should include a corresponding `scores` key. This includes
artifact constraints such as file names, raw-vs-wrapped output, syntax validity,
compile/render success, required fields, banned strings, shape/count limits,
style tokens, fixed palettes, local-only dependencies, and any other observable
property of the submitted answer.

Do not reduce the verifier to only the gold answer. If the task says the output
must have a particular structure or quality, that structure or quality should be
scored directly whenever it is observable from the answer or from local helper
tools. Subjective requirements may be approximated by deterministic proxies, but
clearly subjective-only preferences should not be silently converted into a pass.

## Inputs

Ask for these if they are missing:

- Task description: what environment is being explored and who will answer the questions.
- Tool interface: CLI commands, MCP tools, shell commands, or local files the explorer may use.
- Answer contract: allowed answer types and formatting rules.
- Target yield: desired number of final samples and optional coverage goals.

Do not infer hidden tools or hidden datasets. If the task needs live data, the Cartographer must collect it through the provided tools.

## Simple, Hard, And Broken Questions

A simple question usually has one of these shapes:

- It asks for a single obvious field.
- It names the target entity directly.
- It ends on a fact that a strong model may already know.
- It can be answered without using the tools.

A hard question usually forces at least one real operation:

- Resolve an entity from attributes rather than from its name or ID.
- Traverse multiple linked records.
- Combine data from two sources.
- Compute an aggregation, ratio, rank, or derived threshold.
- Apply a meaningful exclusion or tie-breaker.
- Return a precise value that cannot be guessed approximately.

A broken question is not a hard question. Drop or repair it if it is ambiguous, unstable, subjective, unverifiable, or impossible to answer from the collected graph.

Example:

- Too easy: "What is the display name of record R001?"
- Better: "Among records in segment A during the fixed window, find the record ranked third by metric X after excluding records without a linked event. What is its stable source code?"

The second question is not hard because the entities are obscure. It is hard because the solver must resolve a set, apply constraints, rank, traverse a relation, and return a precise terminal value.

## Pipeline

| Stage | Agent | Purpose | Tool access |
|---|---|---|---|
| 1 | Cartographer | Explore with tools and build a graph plus reasoning walks. | Yes |
| 2 | Miner | Convert walks into Q/A candidates and verification snippets. | No |
| 3 | Validator | Reject candidates that are not answerable, unique, stable, executable, or hard enough. | Sometimes |
| 4 | Deduper | Remove duplicate shapes and produce final files. | No |

The Cartographer is the only stage that should gather new facts. Miner and Deduper are pure over saved artifacts. Validator may run the system-under-test solver when an empirical difficulty gate is requested.

## Exploration Graph

The graph stores reusable evidence:

- Entities: records, actors, groups, sources, categories, events, or task-specific equivalents.
- Edges: links, ownership, membership, category, source, time window, or other relations.
- Walks: precomputed paths from a seed to a terminal answer.

A single good graph should support several distinct questions. Reusing a graph is the point: if the Miner prompt improves, the graph can be mined again without new tool calls.

See `references/exploration_graph.md` for the minimal format.

## Difficulty Construction

Use a small number of clear transformations rather than many decorative layers:

- De-identify: describe an entity by resolvable attributes instead of naming it.
- Add hops: require following relationships in the graph.
- Cross sources: combine two tool-returned views.
- Derive values: compute an average, rank, ratio, modulo, or threshold.
- Constrain carefully: add time windows, exclusions, and tie-breakers that make the answer unique.

Do not build difficulty by listing forbidden entities or by adding arbitrary trivia. The question should feel like a realistic analysis task.

See `references/difficulty_traps.md` and `references/layerwise_obfuscation.md` for short examples.

## Output

The final benchmark has two files:

`final.jsonl` contains only the fields the grader needs:

```json
{"question": "...", "verification": "answer = open('answer.txt').read().strip()\ngold = 'GOLD'\nscores = {'exact': _normalize(answer) == _normalize(gold)}"}
```

`final.meta.jsonl` keeps debugging metadata in the same order:

```json
{"answer": "GOLD", "answer_type": "string", "seed_id": "segment_a", "walk_id": "walk_001", "difficulty": "hard"}
```

Keep graph artifacts under `graph/<seed_id>/` and, when useful, in the shared exploration library for future re-mining.

## Verification Rules

Every candidate must pass these gates:

- The question is answerable from the graph and tools.
- The answer is unique under the wording.
- The answer is stable for the intended evaluation period.
- The verification snippet executes and rejects a wrong sentinel answer.
- The verification snippet covers the task spec's mechanically checkable output
  constraints, not just the terminal gold value.
- The question does not leak the gold answer or intermediate entity IDs.
- The question needs tool use or real computation, not just memory.

See `references/verification_format.md` for snippet templates.

## What This Skill Is Not

- Not an evaluator for an existing dataset.
- Not a domain pack for any specific dataset, API, or company workflow.
- Not a way to generate open-ended writing tasks.
- Not a substitute for manual sampling when the benchmark is high stakes.
