# Travel-QA — SkillHone Example

<p align="left">
  <strong>English</strong> &bull; <a href="./README.zh.md">简体中文</a>
</p>

A worked example: a **travel-planning Q&A** skill, optimised by
SkillHone — measurably better at answering hard travel questions
after a single run, and catching its own regressions along the way.

The questions are shaped like what travellers actually ask — not
"recommend me a city to visit", but "**find a non-chain coffee
stop along my route that has a phone listed and isn't the obvious
tourist pick**". Answering them requires several chained queries
plus some arithmetic; an LLM on its own tends to drop one of the
constraints along the way.

This directory ships **only the task spec** (`PRD.md`).
SkillHone generates the skill, the question set, and the
regression eval from it. The map data behind this example happens
to be TomTom Maps, but the skill is the assistant — TomTom is
just the implementation detail.

---

## What you get

Every change to the skill is a real Pull request — you read the
diagnosis behind each fix the same way you'd read any code review.

The kind of question that flips from ❌ to ✅:

> *"I'm at Dam Square in Amsterdam. Drive me to a non-chain
> restaurant within 1.5 km whose drive time is closest to the
> **median** drive time of all nearby candidates. Skip ones within
> 200 m (I'd just walk). Just tell me the restaurant's name."*

**Before SkillHone:** `Palmyra Restaurant` *(Lebanese, Nieuwezijds Voorburgwal 53)* ❌
The assistant treated "median" as "mean". Amsterdam's canal
detours make a few candidates much slower to reach — median ≠ mean
by a wide margin, so the wrong restaurant came back.

**After SkillHone:** `The Corner Restaurant` *(Martelaarsgracht 26)* ✅
A merged Pull request added explicit `median` / `percentile` /
`closest-to-X` helpers and a SKILL.md rule: "if the question says
median, use median — don't approximate with mean". Same question,
same executor, different statistic — answer flips.

---

## Requirements

|  |  |
|---|---|
| **SkillHone harness** | Local Forgejo + Python env — see [`docs/install/developer.md`](../../docs/install/developer.md) |
| **TomTom Maps API key** | <https://developer.tomtom.com/> |

```sh
export TOMTOM_API_KEY='your-key-here'
```

---

## Run it

In a SkillHone-mounted agent runtime (Claude Code / Codex / OpenClaw / …),
from a checkout of this repo, just say:

> `/skillhone help me synthesise and optimise a skill from ./examples/travel-qa/PRD.md`

That's it. SkillHone takes it from there.

---

## Behind the numbers

Every fix is a real Pull request, every failure is a real Issue,
every iteration leaves a wiki page. Open Forgejo and the trail
reads like any code review you've done before. The screenshots
below are from this example's own run.

### The whole-skill evolution

SkillHone modifies whatever in the skill repo needs modifying —
`SKILL.md` instructions, helper scripts under `scripts/`, reference
pages — and every modification is a normal PR. Four PRs landed
on this run, including one revert; the per-file diff makes the
arc obvious:

| PR | Diagnosed in Issue | Skill-repo diff |
|---:|---|---|
| **#2** | **#1** matrix routing 404 (36 occurrences across 5 solvers) | `SKILL.md` +116 / −19 · `scripts/tomtom_api.py` ➕ 243 (new file) · `scripts/tsp_solver.py` ➕ 184 (new file) |
| **#4** | **#3** wrong statistical method (mean used where median required) | `SKILL.md` +62 / −5 |
| **#6** | **#5** hallucinated tool syntax + HTTP 403 in `tomtom_api.py` | `SKILL.md` +27 / −0 · `scripts/tomtom_api.py` +27 / −4 ⚠️ |
| **#7** | regression caught by post-merge re-eval | `SKILL.md` 0 / −27 · `scripts/tomtom_api.py` +4 / −27 |

Net result: **two new helper scripts** (`tomtom_api.py`,
`tsp_solver.py`) live under `scripts/`, **`SKILL.md` grew from
1.3 KB to ~6 KB** of task-shaped guidance, **one regression was
detected and reverted by the next PR within minutes**. Every diff
above is whole-skill-scoped — SkillHone is not a prompt tuner; it
edits files in a real repo with the same git workflow a human
maintainer would use.

<p align="center">
  <img src="../../docs/assets/issue.png" alt="Issues view — the failures that drove each revision" width="100%">
  <br>
  <em>Issues — the failure that triggered each revision.</em>
</p>

<p align="center">
  <img src="../../docs/assets/pr.png" alt="Pull requests view — the skill changes themselves" width="100%">
  <br>
  <em>Pull requests — the skill changes themselves.</em>
</p>

<p align="center">
  <img src="../../docs/assets/wiki.png" alt="Wiki view — per-iteration observations" width="100%">
  <br>
  <em>Wiki — what each iteration learned.</em>
</p>

---

## Files

- [`PRD.md`](./PRD.md) — the task spec. `skillhone new`
  auto-redacts the `## 3. Evaluation` section before staging the
  public skill repo; the full PRD goes to the private eval repo.
  Override the split with a sibling `PRD.improver_only.md`.
