# Question Playbook

These are **style references**, not scripts. Adapt every question to
what the user already told you. Every round is a single
`AskUserQuestion` tool call; pack as many independent, high-information
questions as the current UI / SDK allows. Each section ends with a
**convergence check**: the dimension is only `settled` when that check
passes.

A few reminders carried from `SKILL.md`:

- `header` ≤ 12 characters. Use crisp nouns (`Tools`, `Goal`,
  `Format`, `Metric`, `Threshold`).
- `description` is where the *concrete* trade-off lives — never use
  vague adjectives like "fast" or "good".
- Prefer 3 options. Use 4 only when the fourth is genuinely distinct.
- Use `multiSelect: true` when more than one option can apply
  (tool list, non-goals, tie-breakers). Single-select otherwise.
- One question should resolve one decision, but one round should bundle
  many independent decisions whenever possible.
- Each round depends on the previous round's answer. Don't pre-compute
  the whole tree.
- Anthropic's UI lets the user type a free-text reply if no option
  fits — accept that as the canonical answer.
- After each tool result, append the exact `questions` payload and raw
  answer mapping to the `choices` list so `PRD.choice.md` can be written.

> **Section order in this playbook ≠ interview order.** Sections
> below are numbered to match the **PRD document** layout
> (`1. Environment`, `2. Goal`, `3. Output format`, `4. Evaluation`).
> The **interview order** you should follow is the RL design order:
> Goal → Environment → Output format → Scoring (see SKILL.md). Use
> these sections as a per-dimension question bank, not as a script
> top-to-bottom.

---

## Option quality checklist

Before asking a choice question, verify:

- The answer changes at least one PRD field.
- The options are grounded in what the user already said.
- Single-select options are mutually exclusive enough for this decision.
- Multi-select combinations do not create contradictions.
- Each option describes an observable implementation, eval, or runtime
  consequence.
- The wording is neutral: no "recommended", "best", "safe", or
  "advanced" labels unless the user introduced those terms.
- If the option set feels incomplete, rely on the UI's free-text escape
  rather than inventing filler options.

When adapting examples, replace generic labels with task-specific labels
whenever possible. `Correctness` is weaker than `extract all invoice
totals correctly`; `Latency` is weaker than `<2 s p50 for one receipt
image`; `Strict` is weaker than `jsonschema hard fail`.

---

## First-round batching pattern

Round 1 should usually ask one broad routing question for each major PRD
area at once. Do **not** spend a separate round on Goal, then another on
Environment, then another on Format if those questions are independent.
A good first round often includes:

- Goal: primary optimization target or job-to-be-done.
- Environment: input/tool/runtime pattern.
- Output format: expected artifact shape.
- Evaluation: primary metric family or dataset source.

From round 2 onward, every round should include the `Stop?` question as
one of the questions. Use the remaining question slots for dependent
follow-ups.

---

## 1. Environment

### Round A — tool access pattern (start here)

```json
{
  "questions": [{
    "header": "Env",
    "question": "How does the skill get its inputs and produce outputs?",
    "options": [
      {"label": "Pure text",       "description": "Text-in, text-out — no network, no files, no tools"},
      {"label": "Local files",     "description": "Reads files the user passes in, writes files back"},
      {"label": "External API",    "description": "Calls a network API or MCP server to fetch / act on data"}
    ]
  }]
}
```

### Round B — concrete tools (depends on A)

If A = `External API`:

```json
{
  "questions": [{
    "header": "Tools",
    "question": "Which specific tools / endpoints does it need?",
    "multiSelect": true,
    "options": [
      {"label": "WebSearch",   "description": "Read the open web; no writes"},
      {"label": "MCP server",  "description": "A specific MCP server (we'll name it next round)"},
      {"label": "Raw HTTP",    "description": "requests / curl against a known endpoint"}
    ]
  }]
}
```

If A = `Local files`:

```json
{
  "questions": [{
    "header": "FS scope",
    "question": "Which file operations does the skill need?",
    "multiSelect": true,
    "options": [
      {"label": "Read only",   "description": "Read user-supplied files; never write"},
      {"label": "Read+Write",  "description": "Reads inputs, writes derived outputs in the same dir"},
      {"label": "Subprocess",  "description": "Shells out to a binary (OCR, ffmpeg, etc.)"}
    ]
  }]
}
```

### Round C — runtime constraints

```json
{
  "questions": [{
    "header": "Runtime",
    "question": "Where will this skill actually run?",
    "options": [
      {"label": "Inside agent", "description": "Sandboxed Claude Code agent session (default)"},
      {"label": "CLI for human","description": "Standalone CLI tool a human invokes directly"},
      {"label": "Server",       "description": "A long-running endpoint other services hit"}
    ]
  }]
}
```

### Convergence check

You can list every tool the skill is allowed to invoke **and** every
tool it is forbidden from invoking, with no ambiguity left. Runtime is
named. If you wrote the `Environment` section of the PRD right now, you
wouldn't have to write `<...>` anywhere.

---

## 2. Goal

### Round A — primary objective

```json
{
  "questions": [{
    "header": "Goal",
    "question": "In one phrase, what is this skill optimizing for?",
    "options": [
      {"label": "Correctness", "description": "Highest task-completion rate, even if slow"},
      {"label": "Latency",     "description": "Lowest p50 latency on the common case"},
      {"label": "Coverage",    "description": "Widest range of input variants, even if quality dips"}
    ]
  }]
}
```

### Round B — non-goals (depends on A)

```json
{
  "questions": [{
    "header": "Non-goals",
    "question": "Which of these is explicitly NOT this skill's job?",
    "multiSelect": true,
    "options": [
      {"label": "Explain steps", "description": "Narrate its reasoning back to the user"},
      {"label": "Adversarial",   "description": "Handle malformed / hostile inputs gracefully"},
      {"label": "Multilingual",  "description": "Work in languages other than English"},
      {"label": "Personalize",   "description": "Adapt to per-user history or preferences"}
    ]
  }]
}
```

### Round C — caller (only if not implied earlier)

```json
{
  "questions": [{
    "header": "Caller",
    "question": "Who or what invokes this skill in production?",
    "options": [
      {"label": "End user",      "description": "A human typing into Claude Code or similar"},
      {"label": "Another skill", "description": "Called as a step in a larger skill workflow"},
      {"label": "Cron job",      "description": "Scheduled batch run, no human in the loop"}
    ]
  }]
}
```

### Convergence check

The goal fits in one sentence. At least one non-goal is named. You can
describe the kind of caller who would invoke this skill and the
situations where they would *not*.

---

## 3. Output format

### Round A — shape

```json
{
  "questions": [{
    "header": "Format",
    "question": "What does a successful skill invocation produce?",
    "options": [
      {"label": "JSON object", "description": "Fixed schema, machine-parseable"},
      {"label": "Markdown",    "description": "Document with required sections / headings"},
      {"label": "Single value","description": "A number, a label, or a yes/no"},
      {"label": "Code",        "description": "A function or script that gets executed downstream"}
    ]
  }]
}
```

### Round B — checkability (depends on A)

```json
{
  "questions": [{
    "header": "Checking",
    "question": "How is the format going to be checked?",
    "options": [
      {"label": "Strict",   "description": "Either it parses as the schema or it's a hard fail"},
      {"label": "Hybrid",   "description": "Structure is automated; content quality needs an LLM judge"},
      {"label": "Human",    "description": "A reviewer reads it; no automated validator possible"}
    ]
  }]
}
```

### Round C — error / refusal shape

```json
{
  "questions": [{
    "header": "On fail",
    "question": "What should the skill emit when it can't complete the task?",
    "options": [
      {"label": "Error obj",   "description": "Same shape as success, with an `error` field set"},
      {"label": "Refuse",      "description": "Free text saying why; no structured output"},
      {"label": "Best-effort", "description": "Always return something; never refuse"}
    ]
  }]
}
```

### Convergence check

You can write out an exact schema, template, or grammar for the
output. You know what tool or command would validate it (see
`references/output_format_menu.md`). You have at least one worked
example of a valid output. The error/refusal path has a defined shape.

---

## 4. Evaluation

### Round A — primary metric

```json
{
  "questions": [{
    "header": "Metric",
    "question": "How do you decide version A is better than version B?",
    "options": [
      {"label": "Exact match",  "description": "Fraction of items where output equals a gold answer"},
      {"label": "LLM judge",    "description": "Numeric score from an LLM rubric"},
      {"label": "Domain metric","description": "Task-specific (BLEU, F1, normalized-edit, etc.)"}
    ]
  }]
}
```

### Round B — pass threshold (depends on A)

```json
{
  "questions": [{
    "header": "Threshold",
    "question": "What primary-metric score counts as 'good enough'?",
    "options": [
      {"label": "≥ 0.9",         "description": "Strict — only ship near-perfect skills"},
      {"label": "≥ 0.7",         "description": "Moderate — ship when clearly competent"},
      {"label": "Beat baseline", "description": "Any improvement over current production"}
    ]
  }]
}
```

### Round C — tie-breakers

```json
{
  "questions": [{
    "header": "Tie-break",
    "question": "If two versions tie on the primary metric, which signal wins?",
    "options": [
      {"label": "Latency",  "description": "Lower wall-clock time per item"},
      {"label": "Tokens",   "description": "Fewer tokens consumed per item"},
      {"label": "Variance", "description": "Lower spread across the eval set"}
    ]
  }]
}
```

### Round D — dataset shape (often the last Eval question)

```json
{
  "questions": [{
    "header": "Dataset",
    "question": "Where does the eval dataset come from?",
    "options": [
      {"label": "Hand-written",   "description": "We'll author probe.jsonl ourselves"},
      {"label": "Production log", "description": "Sample from real user traffic, redact PII"},
      {"label": "Synthetic",      "description": "LLM-generated cases against a spec"}
    ]
  }]
}
```

### Convergence check

The grading function can be described as pseudocode or a concrete tool
command. Pass / fail thresholds are numbers, not adjectives. You know
roughly what the eval dataset looks like (how many items, where they
come from, what fields each item has).

---

## Closing the interview

Starting with round 2, include the `Stop?` question from `SKILL.md` in
every substantive round:

```json
{
  "questions": [
    {
      "header": "Metric",
      "question": "How do you decide version A is better than version B?",
      "options": [
        {"label": "Exact match",  "description": "Fraction of items where output equals a gold answer"},
        {"label": "LLM judge",    "description": "Numeric score from an LLM rubric"},
        {"label": "Domain metric","description": "Task-specific metric such as F1, normalized edit distance, or pass rate"}
      ]
    },
    {
      "header": "Stop?",
      "question": "Stop collecting requirements and write the PRD now?",
      "options": [
        {"label": "No",  "description": "Keep going — I have more to say"},
        {"label": "Yes", "description": "Looks clear enough; write the PRD"}
      ]
    }
  ]
}
```

`No` is the default. If the user picks `Yes` or gives an unambiguous
free-text stop signal, call `scripts/write_prd.py`. If they pick `No`,
continue with the next highest-information-gain question.
