# Output Format Menu

When the user picks an output format, immediately know how it will be
**auto-validated** downstream. If the format can't be checked without a
human, the evaluation dimension gets much harder — flag that to the user.

| Output shape | Good for | Auto-validation | Gotchas |
|---|---|---|---|
| **JSON object (fixed schema)** | Structured extraction, tool-like skills | JSON Schema + `jsonschema` CLI, or `jq` assertions | Schema drift; free-text fields inside JSON still need judgment |
| **JSON Lines** | Batch extraction, one-per-item | Same as JSON, per line; count-check records | Must fail-closed on a single bad line |
| **Markdown with required sections** | Report generation, documentation skills | `grep`-based heading check, or the validate_prd-style "required H2 list" | Section present ≠ section useful; may still need rubric for content |
| **Single value (number / label / yes-no)** | Classification, scoring, routing | Equality or tolerance against a gold value | Very easy to game with heuristics; watch for label imbalance |
| **Code (function / script)** | Code-gen skills | Run the code on test cases, compare outputs; linter / typechecker as gate | Sandboxing matters; flaky tests poison the signal |
| **Structured table (CSV / TSV)** | Tabular extraction | Column-name + type check; row-count check | Delimiter / quoting bugs; Unicode width |
| **Patch / diff** | Editing-focused skills | Apply to reference base, run tests | Patch may apply but break semantics; needs test suite |
| **Plain free text** | Summarization, explanation, creative skills | LLM-as-judge + rubric; optional n-gram overlap metric | Judge variance; rubric drift; expensive |
| **Mixed (e.g. Markdown + embedded JSON block)** | Hybrid skills | Split parse: validate JSON block with schema, Markdown with heading check | Easy to break the boundary; spec the delimiter strictly |

## Rules of thumb

- If the format can be auto-validated, **prefer a cheap rule-based check**
  for the structural part and save LLM judgment for the content part.
- If the user picks "plain free text", push back: *can we at least require
  a top-level heading or a closing sentence?* Any structure you can get
  makes evaluation cheaper and more stable.
- Always ask for a **worked example** of a valid output — if the user
  can't produce one, the format isn't yet pinned down.
- The **refusal / error shape** is part of the format, not an afterthought.
  An unvalidated error path is a favorite place for regressions to hide.
