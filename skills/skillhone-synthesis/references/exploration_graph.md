# Exploration Graph Format

The exploration graph records the evidence collected by the Cartographer. It should be small enough to read and complete enough to support mining questions without more tool calls.

## Layout

```text
graph/<seed_id>/
├── README.md
├── _meta.json
├── walks.md
├── records/
├── actors/
├── groups/
├── sources/
├── categories/
└── events/
```

The type folders are generic. A concrete task may use equivalent names, but avoid domain-specific examples in this skill.

## Entity Files

Each entity file is markdown with YAML frontmatter:

```markdown
---
"@id": ent:R001
"@type": Record
identifier: R001
name: "Example record"
ext:seed_id: segment_a
ext:entity_type: record
ext:metric_x: 47
---

# R001

Source: tool call #3 (`records get R001 --select ...`)

## Relations

- Source: [S001](../sources/S001.md)
- Linked record: [R004](R004.md)
```

Keep only fields needed for disambiguation, reasoning, or verification.

## Walks

`walks.md` is for humans. `_meta.json` is the canonical machine-readable source.

```yaml
walk_id: walk_001
path: [G001, R001, A001, R004]
terminal_field: ext:source_code
gold: "SRC-0427"
gold_type: regex
reasoning_shape: attribute-resolution + rank + relationship-traversal
```

A walk should say what operations make the question hard, not just list nodes.

## `_meta.json`

```json
{
  "seed_id": "segment_a",
  "task": "generic-domain",
  "n_entities": 32,
  "n_walks": 10,
  "walks": [
    {
      "walk_id": "walk_001",
      "path": ["G001", "R001", "A001", "R004"],
      "terminal_field": "ext:source_code",
      "gold": "SRC-0427",
      "gold_type": "regex",
      "reasoning_shape": "attribute-resolution + rank + relationship-traversal"
    }
  ]
}
```

## Graph Quality

A good graph supports several different question shapes. It should include enough relations and terminal fields for multi-hop, aggregation, cross-source, and exact-format questions. It should not be a raw dump of every field returned by the tools.
