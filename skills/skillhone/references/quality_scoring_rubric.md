# Skill Quality Scoring Rubric

This rubric is consumed **by the scoring Agent itself** — the same Agent that's loading skills. No independent LLM judge script runs; you read this file, read the target skill's `SKILL.md`, and produce a JSON score.

The rubric has two sections (Description and Instructions) totalling 24 points. Each dimension is scored **0–3**. After scoring, you output the fixed JSON schema at the bottom of this file.

---

## Section 1 — Description (9 points)

The `description` field in SKILL.md frontmatter is the only signal used to decide whether to activate the skill. It's high-leverage and deserves careful grading.

### 1.1 `what_scope` (0–3)

Does the description clearly say **what the skill does**?

- **0** — vague or tautological. Example: `"Helps with PDFs."` or `"A skill for research tasks."`
- **1** — names the domain but not the specific capability. Example: `"Handles PDF files."`
- **2** — names the capability. Example: `"Extracts tables and fills forms in PDF files."`
- **3** — names the capability with enough specificity that an Agent can pick this skill over a near-neighbour. Example: `"Extracts tables with merged-cell heuristics, fills PDF acroforms, and merges multiple PDFs preserving bookmarks."`

### 1.2 `when_trigger` (0–3)

Does the description say **when** the skill should be activated? Best practice is "use when the user says …" phrasing with concrete example phrasings.

- **0** — no trigger guidance at all.
- **1** — mentions trigger context in one generic phrase (`"Use for PDF work."`).
- **2** — lists at least one concrete user-facing phrase that should trigger the skill.
- **3** — lists multiple concrete triggers, including a non-obvious one (where the user doesn't name the domain directly — e.g. "extract line items from this invoice" should trigger a PDF skill even without the word "PDF").

### 1.3 `keyword_coverage` (0–3)

Does the description contain enough keyword variety for the Agent's triggering model to match different phrasings?

- **0** — a single noun repeated. E.g. `"PDF skill for PDFs."`
- **1** — 2–3 keywords, no synonyms.
- **2** — 3–5 keywords including at least one synonym or related phrase (e.g. "PDF", "document", "extract", "form").
- **3** — a rich keyword cloud that covers formal, casual, and indirect phrasings; keywords a naive user would use ("that PDF my boss sent") show up alongside technical ones ("PDF acroform").

---

## Section 2 — Instructions (15 points)

The SKILL.md body. Grade what's inside the Markdown body, not the frontmatter.

### 2.1 `adds_value` (0–3)

Does the body provide information an Agent **wouldn't already know**? General LLM knowledge should not be re-explained.

- **0** — most of the body is padding the Agent already knows (e.g. "PDF stands for Portable Document Format…").
- **1** — occasional project-specific insight amongst generic prose.
- **2** — mostly project-specific; small amounts of restating-the-obvious.
- **3** — every paragraph tells the Agent something it wouldn't otherwise know: specific APIs, project conventions, non-obvious constraints.

### 2.2 `procedural` (0–3)

Does the body teach a **procedure** (how to approach a class of tasks) or does it just declare facts about a single instance?

- **0** — purely declarative; reads like an essay ("This skill handles PDFs, which are useful because…").
- **1** — a few imperative steps mixed with prose.
- **2** — a clear step-by-step workflow; steps are generalizable across instances.
- **3** — explicit numbered workflow with rationale for each step, reusable across every task in the skill's scope.

### 2.3 `clear_defaults` (0–3)

Does the body **pick a default** and mention alternatives briefly, or does it give the Agent a menu to choose from?

- **0** — menu of options with equal weight ("you can use pypdf or pdfplumber or PyMuPDF or pdf2image…") and no recommendation.
- **1** — a default is mentioned but buried; alternatives get more weight.
- **2** — clear default for the common path, alternatives mentioned once with a reason.
- **3** — a single, clearly-labelled default for each decision point; alternatives relegated to a short "fallback if X" note.

### 2.4 `has_gotchas` (0–3)

Does the body include **non-obvious pitfalls** — surprise-the-Agent facts that would cause silent failures without the warning?

- **0** — no gotchas section and no inline warnings.
- **1** — one or two generic warnings ("be careful with errors").
- **2** — one or two concrete, project-specific gotchas (e.g. "the `/health` endpoint always returns 200 even when the DB is down; use `/ready` instead").
- **3** — a dedicated `## Gotchas` (or equivalent) section with multiple concrete, non-obvious facts, each with the consequence spelled out.

### 2.5 `has_validation` (0–3)

Does the body instruct the Agent to **verify its own work** before finalising — run a validator, re-check against a reference, or re-run a self-test?

- **0** — no validation step at all.
- **1** — asks the Agent to "check your work" without saying how.
- **2** — one explicit verification step tied to a specific artifact (e.g. "run `pytest tests/` after editing").
- **3** — a validation loop: do the work → run validator → if fail, adjust → re-validate, with a concrete escape condition.

---

## Output contract

After scoring, emit this exact JSON (no prose before/after, no Markdown fences):

```json
{
  "skill": "<skill-name>",
  "description_score": {
    "what_scope": 0,
    "when_trigger": 0,
    "keyword_coverage": 0,
    "subtotal": 0
  },
  "instructions_score": {
    "adds_value": 0,
    "procedural": 0,
    "clear_defaults": 0,
    "has_gotchas": 0,
    "has_validation": 0,
    "subtotal": 0
  },
  "total": 0,
  "max_total": 24,
  "pct": 0.0,
  "verdict": "APPROVE|REQUEST_CHANGES",
  "suggestions": [
    "<one actionable suggestion, tied to a specific dimension>",
    "<another>"
  ]
}
```

### Verdict rule

- `pct >= 50%` → `verdict = "APPROVE"`
- `pct < 50%` → `verdict = "REQUEST_CHANGES"`

The **50% threshold** is deliberately loose — this rubric is advisory during improvement, a gate during merge. Never block a PR just because a single dimension scored low; block on the overall percentage.

### Suggestions

List 1–3 short, actionable suggestions. Each suggestion must:

- Name which dimension it addresses (the Agent will use the dimension name to target the fix).
- Propose a concrete change, not "improve X".
- Avoid copying gold answers or test data into any suggested edit.

Good: `"when_trigger: add two example user phrases like 'extract line items from this invoice'"`
Bad: `"improve the description"`

---

## Meta — when to re-read this file

Load this file every time you're asked to score a skill — the rubric is not short enough to memorise reliably. If you're only **static-checking** (format / structure) you don't need this file; run `scripts/static_check.py` instead.
