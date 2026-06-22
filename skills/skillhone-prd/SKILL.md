---
name: skillhone-prd
description: >-
  Interactively gather a PRD (Product Requirements Document) for an agent
  skill that is about to be built or optimized by SkillHone. Use when the user
  says things like "I want to write a new skill", "help me spec this skill",
  "what should <x>-skill do", or before running `skillhone new` / `skillhone
  optim` on a skill whose requirements aren't fully nailed down. The interview
  is driven through the `AskUserQuestion` tool — every round is a small set of
  dependent multi-choice questions, and the skill keeps asking until the user
  says stop. Final artifacts are three files in the paired `<skill>-eval`
  repo: `PRD.md` (eval-agent-visible), `PRD.improver_only.md` (improver-agent
  visible, scoring rubric redacted), and `PRD.choice.md` (the AskUserQuestion
  transcript). Also mirrors the appropriate pages into Forgejo wiki checkouts
  when available.
---

# skillhone-prd — Interactive PRD builder for skills

## Why this skill exists

Before SkillHone can meaningfully optimize a skill, **three things must be unambiguous**: what the skill is trying to achieve (goal), what environment it runs in (tools), and how its outputs will be judged (evaluation — both the structural format and the scoring rubric). Writing ordinary product PRDs doesn't cut it — a skill PRD is primarily an **evaluation contract**, not a feature list.

This skill drives a multi-round interview via `AskUserQuestion` and emits three files into the paired `<skill>-eval` repo:

- **`PRD.md`** — full PRD, including evaluation criteria. Visible to the **eval agent only**.
- **`PRD.improver_only.md`** — same PRD with section 4 (Evaluation) stripped. Visible to the **improver / iter agent**.
- **`PRD.choice.md`** — full question/answer transcript. Eval artifact; never published to the skill wiki.

The split is deliberate: if the improver sees its own grading rubric, Goodhart's Law takes over within a few iterations.

## The three dimensions to pin down (in this order)

A skill PRD is structurally analogous to an RL problem spec:

| RL concept | Skill PRD dimension | Why it comes when it does |
|---|---|---|
| Task goal | **Goal** | Without a goal, you can't pick what tools matter or what to measure. |
| Environment | **Environment** (tools, runtime) | Tools = the action space; sets the ceiling on what's testable. |
| Reward | **Evaluation** (incl. output format) | Reward is meaningful only relative to a fixed goal and environment. |

> **Output format is part of evaluation, not separate from it.** Format validity is the *structural* reward gate; metrics and thresholds are the *content* reward. They're rendered as two sections (3 and 4) so that the improver-only file can keep the format spec visible while redacting the scoring rubric.

PRD section order in `PRD.md` is fixed: `## 1. Environment` → `## 2. Goal` → `## 3. Output format` → `## 4. Evaluation`. The interview order is independent — the script reorders for you.

If the user pushes to jump ahead ("let's talk metrics first"), briefly redirect: *"reward depends on what the agent can actually do — let's pin down the goal and the tools first, or we'll just be optimizing a metric that doesn't correspond to the task."*

## Interaction contract — use `AskUserQuestion`, always

Drive every round through the `AskUserQuestion` tool. Do **not** paste numbered lists into your text reply — the tool gives the user a real picker UI and structured answers come back to you, which removes parsing ambiguity.

**Language**: match the language of the user's most recent message for all user-facing text (questions, options, your prose). Keep file names, the four dimension keys (`environment`, `goal`, `output_format`, `evaluation`), and the generated-PRD headings in English — the script depends on them.

### Hard rules for questions

- **2–4 options per question** (tool-enforced). Prefer 3.
- **`header` ≤ 12 chars.** Crisp nouns: `Tools`, `Goal`, `Format`, `Metric`.
- **`label` = what the user picks; `description` = why.** Both required.
- **`multiSelect: true`** only when more than one option can legitimately apply.
- **One question = one decision.** No double-barreled questions.
- **Options must be MECE, distinct, and actionable.** No vague adjectives ("fast", "good"), no "recommended"/"best" labels unless the user used those words.
- **No fake options.** If you can't name 2 grounded alternatives, ask an upstream context question first.
- **Batch aggressively within a round.** Round 1 should cover all four dimensions where questions don't depend on each other.
- **Each later round depends on the prior round's answers.** Don't pre-compute the full tree.
- **Always accept free-text.** The UI supplies it automatically — treat it as more authoritative than your offered options.

For the full catalogue of worked examples, anti-patterns, and dimension-by-dimension question templates, see [references/question_playbook.md](references/question_playbook.md). Load that file if you're unsure how to phrase a question for a specific dimension.

### Choice log

Maintain an in-memory `choices` list. After every `AskUserQuestion` result, append exactly what you asked and what the user answered:

```json
{
  "round": 1,
  "dimension": "goal",
  "why": "Determines the primary PRD goal and downstream eval metric family.",
  "questions": [ /* passed to AskUserQuestion verbatim */ ],
  "answers": { "What's the primary optimization target?": "Total accuracy" }
}
```

Rules: record `questions` exactly as sent; record answers exactly as returned; do not summarize in `choices`; include the `Stop?` question like any other. Pass the list to `scripts/write_prd.py`; it renders `PRD.choice.md` from it.

### Question gate — only ask when the answer changes the PRD

Before each `AskUserQuestion` call, confirm:

1. Does this ambiguity affect the final PRD materially?
2. Would different answers change the generated skill, eval dataset, validator, output format, or scoring rubric?
3. Do you have 2–4 grounded candidate options?
4. Is the answer not already inferable from what the user said?

If any answer is **no**, don't ask. Either infer and state the assumption, or ask a narrower upstream question.

### Funnel principle

1. If intent is still broad, ask a high-level routing question.
2. Once a dimension is identified, ask targeted choice questions.
3. Once a choice is made, ask dependent follow-ups.
4. Do not use choice questions to prematurely frame an unknown problem space.

Treat free-text answers as more authoritative than the offered options.

### Stop condition — only the user can stop

Keep launching `AskUserQuestion` rounds until the user explicitly says stop. No question budget, no auto-stop on convergence.

Starting with **round 2**, include a `Stop?` question in every round (default `No`):

```json
{
  "header": "Stop?",
  "question": "Stop collecting requirements and write the PRD now?",
  "options": [
    {"label": "No",  "description": "Keep going — I have more to say"},
    {"label": "Yes", "description": "Looks clear enough; write the PRD"}
  ]
}
```

On `Yes` → exit and write PRDs. On `No` or free-text → next substantive round (including `Stop?` again). You can also stop immediately if the free-text reply is an unambiguous stop signal — anything that clearly means "stop / done / just write it" in any language.

If the user stops while a dimension is half-baked, write the PRD anyway with the gap flagged: `_(deferred — not pinned down in the interview)_`. Do not guess.

## Workflow (you decide the order)

This skill is **not a state machine**. A reasonable default:

1. **Scan what's already given.** Mark each dimension `unknown | partial | settled` from the user's opening message.
2. **Round 1 should be comprehensive.** Ask highest-information independent questions across all four dimensions in one call.
3. **Later rounds = dependent follow-ups.** Batch independent follow-ups together.
4. **Revisit upstream dimensions only if a new answer invalidates them.**
5. **Include `Stop?` from round 2 onwards.**
6. **Write all three PRD artifacts** via `scripts/write_prd.py`. Use `--out-dir`. Pass `--eval-wiki-dir` / `--skill-wiki-dir` if wiki checkouts are available.
7. **Validate** via `scripts/validate_prd.py`. If either PRD exits non-zero, fix inputs and re-run. Don't hand back an invalid PRD.

## Where to write the PRDs

All three files go to the **root of the eval repo**, not the skill repo. Detection order:

1. If the user names a directory, use it.
2. If a sibling `<skill-name>-eval` exists next to the current skill repo, write into it.
3. If `$SKILLHONE_EVAL_DIR` is set, write into it.
4. Otherwise, write to `./PRD.md`, `./PRD.improver_only.md`, `./PRD.choice.md` in CWD and print:
   `note: couldn't auto-detect eval repo; copy PRD.md, PRD.improver_only.md, and PRD.choice.md into <skill>-eval/`

Reason: if the full PRD or choice transcript sits inside the skill repo, the improver eventually trains against its own rubric and Goodhart takes over.

## Forgejo wiki publishing

Forgejo wikis are git-backed. Clone the two wiki repos into a scratch area, pass those checkouts to `scripts/write_prd.py`, then commit/push after user authorization. Derive wiki clone URL by replacing the repo suffix: `<repo>.git` → `<repo>.wiki.git`.

| Forgejo wiki | Page | Source | Visibility |
|---|---|---|---|
| `<skill>-eval` wiki | `PRD.md` | `PRD.md` | Full eval-visible contract |
| `<skill>-eval` wiki | `PRD-Choices.md` | `PRD.choice.md` | Full interview transcript |
| `<skill>` wiki | `PRD.md` | `PRD.improver_only.md` | Training/improver-visible only |

**Never publish** `PRD.md`, `PRD.choice.md`, scoring rubrics, validators, or eval dataset details into the `<skill>` wiki. The skill repo wiki is improver-visible — treat it as part of the skill repo for leakage purposes.

```bash
python3 scripts/write_prd.py \
  --skill-name <skill> \
  --data collected_prd.json \
  --out-dir <skill-eval-dir> \
  --eval-wiki-dir <checked-out-skill-eval-wiki> \
  --skill-wiki-dir <checked-out-skill-wiki>
```

The script writes files but does not `git commit`/`push`; do that separately with the user's Forgejo credentials.

## What lives in which file

| Content | `PRD.md` / eval wiki | `PRD.improver_only.md` / skill wiki | `PRD.choice.md` / eval wiki |
|---|---|---|---|
| 1. Environment | ✅ full | ✅ full | ❌ |
| 2. Goal | ✅ full | ✅ full | ❌ |
| 3. Output format — schema, examples | ✅ full | ✅ full | ❌ |
| 3. Output format — auto-validation rule | ✅ full | ❌ redacted | ❌ |
| 4. Evaluation (metrics, thresholds, dataset) | ✅ full | ❌ entire section removed | ❌ |
| AskUserQuestion raw Q/A | ❌ | ❌ | ✅ full |

The redaction, choice-log rendering, and wiki split are enforced by `scripts/write_prd.py`. Do not hand-edit to bypass them.

## Gotchas

- **`PRD.improver_only.md` is generated by the script, not written by you.** If you hand-edit it, you'll eventually leak the rubric.
- **`PRD.choice.md` must never go into the skill wiki** — only the eval wiki. The script enforces this; don't `wiki.py create` it yourself in the wrong repo.
- **Forgejo wiki page filenames are case-sensitive and use hyphens** (`PRD-Choices.md`, not `PRD_Choices.md`).
- **`write_prd.py` validates its input JSON schema**. If it exits non-zero on the first run, fix your `choices`/data payload before re-running.
- **If you see "section 4 missing" from `validate_prd.py`** on `PRD.md`, the interview skipped Evaluation. Resume with a Scoring question rather than hand-authoring the section.
- **Language mixing is allowed.** Prose and option labels should follow the user's language; only dimension keys and headings stay English.

## Anti-patterns

- ❌ Going back to ASCII numbered lists in your text reply — always use `AskUserQuestion`.
- ❌ Cramming Goal, Environment, and Evaluation into one round after round 1 (dependent questions must follow answers).
- ❌ Asking one big question like "tell me everything about the desired output" — that's a text box, not an interview.
- ❌ Leaking evaluation criteria into the improver file. Redaction is automatic; don't hand-write an improver file with section 4.
- ❌ Making up options the user didn't ground. No 2 concrete options → explore first.
- ❌ Treating "I don't know" as terminal — offer a follow-up round walking through 2–3 concrete trade-offs.

## References (load on demand)

- [references/question_playbook.md](references/question_playbook.md) — worked examples, per-dimension question templates, full anti-pattern list. Load if you're unsure how to phrase a question.
- [references/output_format_menu.md](references/output_format_menu.md) — menu of auto-checkable output formats (JSON schema, Markdown with required sections, etc.). Load before asking format questions.
- [references/prd_template.md](references/prd_template.md) — the exact Markdown template `write_prd.py` renders. Load only if debugging PRD output.

## Output

Three files at the target path:

- `PRD.md` — full PRD, eval-agent-visible.
- `PRD.improver_only.md` — redacted PRD, improver-agent-visible.
- `PRD.choice.md` — `AskUserQuestion` transcript.

Both PRD files must pass `scripts/validate_prd.py` before you hand back. `PRD.choice.md` is an audit artifact — no redaction, but only publish to the eval repo/wiki.
