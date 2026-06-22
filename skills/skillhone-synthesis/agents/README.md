# Agents — Roles, Inputs, Outputs

The pipeline is decomposed into **four** role-specialized subagents. Each has a focused prompt and a single artifact it owns. The orchestrator (the top-level agent that handles this skill) spawns each subagent in turn and passes artifacts between them.

| Role | Prompt | What it does | Input | Output |
|------|--------|--------------|-------|--------|
| **Cartographer** | `cartographer.md` | Builds an exploration graph for one seed. Consults the shared library first; extends if there's overlap, builds new otherwise. Pre-computes ≥ 10 reasoning walks per graph. | task + tools spec + library snapshot | `graph/<seed_id>.json` + library copy |
| **Miner** | `miner.md` | Reads graph(s) and lifts each walk into a hard Q/A. Writes the v2 dict-of-bool `verification`. No tool calls — graph has everything. | graph(s) + answer contract | candidate JSONL |
| **Validator** | `validator.md` | Mechanical + walk-grounding checks. Drops broken candidates. | candidates + their source graphs | validated JSONL |
| **Deduper** | `deduper.md` | Cross-graph dedup + terminal-field balancing. Produces the final benchmark. | validated batches | `final.jsonl` + `final.meta.jsonl` |

## Flow

```
   (task + tools spec)
            │
            ▼
[Cartographer] ── runs N seeds in parallel, consulting library ──► graph/<seed_id>.json
            │                                                    │
            │                                                    └─► exploration_lib/<task>/<seed_id>.json
            ▼   (per-graph, parallelizable)
       [Miner]   ──►  candidates-<seed_id>.json         (10–15 per graph)
            │
            ▼
     [Validator] ──►  validated-<seed_id>.json          (broken dropped)
            │
            ▼   (join across graphs)
      [Deduper]  ──►  final.jsonl + final.meta.jsonl    (final benchmark)
```

Per-graph stages (Miner → Validator) can run in parallel across graphs; only the Cartographer needs live tool access.

## Why the split

- **Cartographer ≠ Miner**: separating exploration from question-writing keeps the Cartographer blind to specific questions, so it can't over-fit evidence collection. It collects what the *schema* says is needed; the Miner picks which walks to ask about.
- **Miner is pure-function over graph**: re-running it with a new prompt costs zero tool calls. This is the main efficiency win — once a graph is in the library, every prompt iteration runs against the cached graph.
- **Validator is decoupled**: it can re-check candidates after either Miner or a phrasing repair, independently.
- **Deduper sees everything**: dedup signal is global, so it must run after all graphs/candidates are collected.

## Reading order for a new contributor

1. `cartographer.md` — start here, it sets up the data model.
2. `../references/exploration_graph.md` — the graph schema the Cartographer emits.
3. `miner.md` — how Q/A are mined from the graph.
4. `../references/difficulty_traps.md` — the anti-patterns the Miner must self-check against.
5. `../references/verification_format.md` — the v2 dict-of-bool snippet contract.
6. `validator.md`, `deduper.md` — smaller, read last.

## Collapsed mode (small runs only)

For < 10 samples, one subagent can run Cartographer + Miner + Validator together. At production scale (typical `synth.py --count 15+`) keep them split — debuggability wins, and the Miner-can-re-run-against-library trick only records with separate stages.
