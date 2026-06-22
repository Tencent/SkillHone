# Skill Structure Guidelines

## The Three Components

A well-optimized skill has three components — not just SKILL.md:

```
skill-name/
├── SKILL.md         # Strategy & workflow ONLY (keep under 3KB!)
├── scripts/         # Executable wrappers for tools
└── references/      # Detailed docs loaded on-demand
```

## Size Budgets

| Component | Max Size | Why |
|-----------|----------|-----|
| SKILL.md | <3KB / <80 lines | Loaded every agent step — bloat kills performance |
| scripts/ (each) | <200 lines | Executed, not loaded into context |
| references/ (each) | <5KB | Only loaded when agent explicitly reads |

## When to Put Content Where

### SKILL.md — High-level strategy
- Workflow steps (what to do, in what order)
- Critical rules (non-negotiable constraints)
- Anti-patterns (what NOT to do)
- Output format specification

### scripts/ — Executable tool wrappers
- API calls (search, fetch, etc.)
- Data processing pipelines
- Validation scripts
- Anything the agent runs via `bash scripts/xxx.sh` or `python3 scripts/xxx.py`

### references/ — Detailed knowledge
- API documentation and schemas
- Domain-specific lookup tables
- Examples and templates
- Verbose explanations of edge cases

## Progressive Disclosure

The agent's context window is a shared resource. Content should be loaded progressively:

1. **Always loaded**: SKILL.md metadata (name + description, ~50 tokens)
2. **Loaded on trigger**: Full SKILL.md body (~500-1000 tokens)
3. **Loaded on demand**: scripts execute without entering context; references loaded via read_file

## Common Anti-patterns

1. **Bloated SKILL.md** — putting curl commands, JSON schemas, and examples all in SKILL.md
   - Fix: Extract curl commands → `scripts/search.sh`, schemas → `references/api.md`

2. **No scripts** — every tool call is a raw curl/python snippet in SKILL.md
   - Fix: Wrap repeated patterns in scripts/ that take arguments

3. **Hardcoded values** — API keys, URLs inline in SKILL.md
   - Fix: Scripts read from env vars or config files

4. **Too many steps** — 20-step workflow in SKILL.md
   - Fix: Collapse to 3-5 high-level steps; details go to references/

## Measuring Quality

Good skill indicators:
- SKILL.md fits on one screen (<80 lines)
- Agent completes task in <10 tool calls with skill vs >30 without
- Scripts handle error cases (retry, fallback)
- No context budget wasted on content the agent already knows
