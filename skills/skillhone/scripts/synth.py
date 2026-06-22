#!/usr/bin/env python3
"""Synthesize closed-form eval data via skillhone-synthesis.

Usage:
    python3 scripts/synth.py --repo <forgejo-skill-repo-url> \
        --target 30 --splits probe,test
    python3 scripts/synth.py --repo <forgejo-skill-repo-url> \
        --target 10 --splits probe \
        --target-pass-rate-max 0.70 --max-resynth 3

The skill repo's README.md is taken as the task spec. The eval repo
(<repo-name>-eval.git) gets a fresh probe.jsonl (+ test.jsonl etc.) committed
and pushed. All probes run through verifier compile + exec smoke-test before
push; if anything fails, no push happens.

When --target-pass-rate-max is given, synth runs a regression loop:
after each draft, scripts/eval.py --mode seed --split probe scores the seed
skill against the new probes. If the seed pass rate exceeds the target, the
synth agent is re-invoked with feedback (which items were too easy) and
redrafts. Bounded by --max-resynth iterations. Each iteration's observation
is written to <eval_clone>/synthesis_observations/iter_NN.md so future
runs (and the user) can audit the synth-stage behaviour.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SKILLHONE_HOME = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone"))
SKILLS_DIR = SKILLHONE_HOME / "skills"
HISTORY_FILE = SKILLHONE_HOME / "history.jsonl"
RUNS_DIR = SKILLHONE_HOME / "runs"
WORK_DIR = Path("/tmp/skillhone")

sys.path.insert(0, str(SKILLHONE_HOME / "skills" / "skillhone" / "scripts"))
from core.redaction import redact_for_log  # noqa: E402


def _make_run_id(repo_name: str) -> str:
    import datetime
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"synth_{repo_name}_{ts}"


def _log_event(action: str, data: dict) -> None:
    import datetime
    record = {"ts": datetime.datetime.now().isoformat(), "action": action, **data}
    SKILLHONE_HOME.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def _validate_jsonl(path: Path) -> tuple[bool, str]:
    """Schema + verifier-compile sanity. Returns (ok, message)."""
    if not path.exists():
        return False, f"missing {path.name}"
    try:
        items = [json.loads(l) for l in path.read_text().splitlines() if l.strip()]
    except Exception as e:
        return False, f"{path.name}: jsonl parse error: {e}"
    if not items:
        return False, f"{path.name}: 0 items"
    for i, it in enumerate(items):
        if "question" not in it or "verification" not in it:
            return False, f"{path.name}[{i}]: missing question/verification keys"
        try:
            compile(it["verification"], f"<{path.name}#{i}>", "exec")
        except SyntaxError as e:
            return False, f"{path.name}[{i}]: verifier syntax: {e}"
    return True, f"{len(items)} items, all verifiers compile"


def _push_eval(eval_clone: Path, repo_name: str, token: str, forgejo_url: str,
               owner: str, run_id: str) -> None:
    """git add + commit + push the eval repo. Stages new/modified jsonl files."""
    import git as _git
    repo = _git.Repo(str(eval_clone))
    repo.config_writer().set_value("user", "name", "skillhone").release()
    repo.config_writer().set_value("user", "email", "skillhone@localhost").release()
    repo.git.add(A=True)
    if repo.is_dirty(untracked_files=True):
        repo.index.commit(f"synth: {run_id}")
        push_url = (
            f"http://oauth2:{token}@"
            f"{forgejo_url.split('://', 1)[1]}/{owner}/{repo_name}-eval.git"
        )
        if "origin" in [r.name for r in repo.remotes]:
            repo.remotes.origin.set_url(push_url)
        else:
            repo.create_remote("origin", push_url)
        repo.git.push("origin", "HEAD:main", force=True)


# ─────────────────────────────────────────────────────────────────────────────
# Regression-loop helpers
# ─────────────────────────────────────────────────────────────────────────────

_SEED_TODO_NEEDLES = ("todo: replace this", "TODO replace", "TODO: implement")


def _check_seed_committed(skill_clone: Path) -> tuple[bool, str]:
    """Verify SKILL.md is a real seed, not the new.py TODO placeholder."""
    skill_md = skill_clone / "SKILL.md"
    if not skill_md.exists():
        return False, "SKILL.md missing"
    body = skill_md.read_text()
    size = len(body)
    if size < 500:
        return False, f"SKILL.md only {size} bytes (placeholder)"
    if any(needle in body for needle in _SEED_TODO_NEEDLES):
        return False, "SKILL.md still contains TODO placeholder text"
    return True, f"SKILL.md {size} bytes"


def _run_seed_eval(skill_clone: Path, eval_clone: Path, split: str,
                   run_dir: Path, iteration: int) -> tuple[float, list[dict], str]:
    """Run scripts/eval.py --mode seed --split <split>.

    Returns (pass_rate, traces, raw_log_path). On failure returns
    (1.0, [], log) — pessimistic so the gate doesn't accidentally accept.
    """
    output = run_dir / f"seed_eval_iter{iteration:02d}_{split}.json"
    log_path = run_dir / f"seed_eval_iter{iteration:02d}_{split}.log"
    eval_py = Path(__file__).resolve().parent / "eval.py"
    cmd = [
        sys.executable, str(eval_py),
        "--skill-dir", str(skill_clone),
        "--eval-dir", str(eval_clone),
        "--split", split,
        "--mode", "seed",
        "--output", str(output),
        "--trace-dir", str(run_dir / f"seed_traces_iter{iteration:02d}_{split}"),
    ]
    print("  > " + " ".join(cmd))
    with log_path.open("w") as logf:
        rc = subprocess.call(cmd, stdout=logf, stderr=subprocess.STDOUT)
    if rc != 0:
        print(f"  eval.py rc={rc}, see {log_path}")
        return 1.0, [], str(log_path)
    try:
        result = json.loads(output.read_text())
    except Exception as e:
        print(f"  failed to parse {output}: {e}")
        return 1.0, [], str(log_path)
    pass_rate = float(result.get("pass_rate", result.get("score", 0.0)))
    traces = result.get("traces", [])
    return pass_rate, traces, str(log_path)


def _format_observation_md(iteration: int, max_iters: int, target_max: float,
                            pass_rate: float, traces: list[dict],
                            decision: str, probe_questions: list[dict]) -> str:
    """Build the Synth-Iteration-N markdown body."""
    lines = [
        f"# Synth Iteration {iteration} of {max_iters}",
        "",
        f"- **Decision:** {decision}",
        f"- **Seed pass rate:** {pass_rate:.2%}",
        f"- **Target max:** ≤ {target_max:.2%}",
        f"- **Probe count:** {len(probe_questions)}",
        "",
        "## Per-item",
        "",
    ]
    # Join trace ↔ probe by question string (same fix as _build_redraft_prompt:
    # synth.py and eval.py auto-assign uids in different formats).
    trace_by_q = {t.get("query", "").strip(): t for t in traces}
    for i, q in enumerate(probe_questions, 1):
        qtext = q.get("question", "").strip()
        t = trace_by_q.get(qtext, {})
        passed = t.get("passed")
        mark = "✅ seed PASS" if passed else "❌ seed FAIL" if passed is False else "⏺ no trace"
        lines.append(f"### {i:02d}. {mark}")
        lines.append("")
        lines.append(f"**Q:** {qtext[:400]}")
        lines.append("")
        if t.get("expected"):
            lines.append(f"- expected: `{t['expected']}`")
        if t.get("predicted") is not None:
            pred = str(t.get("predicted", ""))[:200]
            lines.append(f"- predicted: `{pred}`")
        if t.get("error"):
            lines.append(f"- error: `{str(t['error'])[:200]}`")
        lines.append("")
    return "\n".join(lines) + "\n"


def _write_synth_observation(eval_clone: Path, iteration: int, body: str) -> Path:
    obs_dir = eval_clone / "synthesis_observations"
    obs_dir.mkdir(parents=True, exist_ok=True)
    f = obs_dir / f"iter_{iteration:02d}.md"
    f.write_text(body)
    return f


def _build_redraft_prompt(base_prompt: str, prior: list[dict], target_max: float) -> str:
    """Prepend redraft feedback derived from the previous iteration's traces."""
    if not prior:
        return base_prompt
    last = prior[-1]
    pass_rate = last["pass_rate"]
    traces = last["traces"]
    questions = last["questions"]

    # Robust join: match trace ↔ probe by question string (uid auto-assignment
    # uses different formats across synth.py and eval.py; question text is the
    # one field that's identical).
    trace_by_q = {t.get("query", "").strip(): t for t in traces}

    passed = []
    failed = []
    for q in questions:
        qtext = q.get("question", "").strip()
        t = trace_by_q.get(qtext, {})
        if t.get("passed"):
            passed.append({"question": qtext,
                           "expected": t.get("expected", ""),
                           "predicted": t.get("predicted", "")})
        else:
            failed.append({"question": qtext,
                           "expected": t.get("expected", "")})

    # Template-fixation detector: if many questions share an opening prefix,
    # the synth is reusing one shape — call it out explicitly.
    import collections
    def _opening(qtext: str, n_words: int = 8) -> str:
        return " ".join(qtext.split()[:n_words]).lower()
    openings = [_opening(q.get("question", "")) for q in questions]
    counts = collections.Counter(openings)
    top_opening, top_count = (counts.most_common(1) or [(None, 0)])[0]
    fixation = top_count >= max(3, len(questions) // 3) and top_opening is not None

    lines = [
        f"⚠️  REDRAFT — synth iteration {len(prior) + 1}.",
        "",
        f"The previous probe set scored **{pass_rate:.2%}** when the seed skill ran "
        f"against it (target ≤ {target_max:.2%}). The questions did NOT have "
        f"enough discrimination room — a baseline solver passes them without "
        f"learning the optimisation tricks task.md's `## 3. Evaluation` rubric "
        f"is supposed to filter for. Redraft.",
        "",
    ]

    if fixation:
        lines += [
            f"🚨 TEMPLATE FIXATION DETECTED: {top_count}/{len(questions)} of "
            f"the previous probes opened with the same {len(top_opening.split())}-word phrase:",
            f"    \"{top_opening}…\"",
            "",
            "The synth has locked into one question shape. This is exactly the "
            "kind of single-chained-API-call template task.md's §3.1.C explicitly "
            "rejects. The next iteration MUST use diverse openings — at most ONE "
            "question may start with any given 6-word prefix. Vary the entity "
            "type the question selects (institution / author / source / topic / "
            "funder), vary the JOIN axis, and vary the leaf metric.",
            "",
        ]

    lines += [
        f"Items the seed PASSED ({len(passed)} too-easy items — your redraft must "
        f"replace these with HARDER ones, or remove the leaky shape):",
        "",
    ]
    for i, p in enumerate(passed[:12], 1):
        lines.append(f"  {i}. {p['question'][:240]}")
        lines.append(f"     gold: {p['expected']!r}  predicted: {p['predicted']!r}")
    if len(passed) > 12:
        lines.append(f"  ... ({len(passed) - 12} more)")
    lines.append("")
    lines.append(f"Items the seed FAILED ({len(failed)} working items — keep this "
                 f"shape or use it as a template):")
    lines.append("")
    for i, fitem in enumerate(failed[:6], 1):
        lines.append(f"  {i}. {fitem['question'][:240]}")
    if len(failed) > 6:
        lines.append(f"  ... ({len(failed) - 6} more)")
    lines += [
        "",
        "REDRAFT GUIDANCE:",
        "  - Re-read task.md's `## 3. Evaluation` § 3.1 in full — pay special attention to §3.1.A.5 (multi-call independence), §3.1.C (rejection templates), and §3.1.D (good vs bad pattern litmus).",
        "  - The single most common synth failure is the \"Consider the <X> ranked Nth by <metric>\" opener. Every question of this shape is a single chained `?filter=…&sort=…` call and gets solved by the seed in one pass. BANNED OUTRIGHT — re-read §3.1.C.",
        "  - The structural fix: the gold value must depend on a baseline (mean / median / Gini / percentile / std) computed from a SEPARATE API call than the one that fetched the target. The seed cannot solve this in one chained query because the API can't combine two cohorts server-side.",
        "  - Use §3.1.D's GOOD examples as templates: cohort normalisation, multi-attribute disambiguation, Gini / Lorenz on a paginated cohort, multi-cohort comparison, manual-cohort percentile.",
        "  - Rebuild the probe set from scratch — don't try to patch one-by-one.",
        "  - Keep total probe count exactly at the target.",
        "  - DIVERSITY: the 10 probes must cover ≥ 4 distinct opening shapes (no 6-word prefix may appear in > 1 probe).",
        "  - Verify each new item satisfies §3.1.A all FIVE hard-floor gates AND engages ≥ 2 §3.1.B levers.",
        "",
        "===== ORIGINAL TASK PROMPT BELOW =====",
        "",
    ]
    return "\n".join(lines) + "\n" + base_prompt


def _archive_iteration(ws: Path, splits: list[str], iteration: int) -> None:
    """Stash the current iteration's <split>.jsonl files so the next iteration starts clean."""
    for s in splits:
        live = ws / f"{s}.jsonl"
        if live.exists():
            shutil.move(str(live), str(ws / f"{s}.iter_{iteration:02d}.jsonl"))


async def _run_synth_agent(ws: Path, prompt: str, model: str, max_turns: int,
                            run_dir: Path, iteration: int,
                            disallowed_tools: list[str], improver_env: dict,
                            passthrough_env: list[str] | tuple[str, ...] = ()) -> int:
    """One agent invocation that produces <split>.jsonl files in ws.

    Returns event count. Trajectory is appended to run_dir/trajectory_iterNN.jsonl.
    """
    from claude_agent_sdk import query, ClaudeAgentOptions
    options = ClaudeAgentOptions(
        cwd=str(ws),
        model=model,
        skills="all",
        setting_sources=["project"],
        disallowed_tools=disallowed_tools,
        permission_mode="bypassPermissions",
        max_turns=max_turns,
        env={**{k: v for k, v in os.environ.items()
                if k in passthrough_env and v},
             **improver_env},
    )
    traj = run_dir / f"trajectory_iter{iteration:02d}.jsonl"
    n = 0
    async for msg in query(prompt=prompt, options=options):
        try:
            if hasattr(msg, "__dict__"):
                entry = {"type": type(msg).__name__, **msg.__dict__}
            elif isinstance(msg, dict):
                entry = msg
            else:
                entry = {"type": type(msg).__name__, "raw": str(msg)[:2000]}
        except Exception:
            entry = {"type": "unknown", "raw": str(msg)[:2000]}
        with traj.open("a") as _tf:
            _tf.write(json.dumps(redact_for_log(entry), default=str, ensure_ascii=False) + "\n")
        n += 1
        if n % 10 == 0:
            print(f"  ... {n} messages")
    print(f"  {n} messages")
    return n


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Synthesize closed-form eval data via skillhone-synthesis",
    )
    parser.add_argument("--repo", required=True,
                        help="Forgejo skill repo URL (eval repo derived: <repo>-eval.git)")
    parser.add_argument("--target", type=int, default=10,
                        help="target validated samples per split (default: 10)")
    parser.add_argument("--splits", default="probe,test",
                        help="comma-separated split names to emit (default: probe,test)")
    parser.add_argument("--max-turns", type=int, default=200,
                        help="max agent turns per synth iteration (default: 200)")
    parser.add_argument("--no-push", action="store_true",
                        help="generate locally but don't push to forgejo")
    parser.add_argument("--target-pass-rate-max", type=float, default=None,
                        help="if set, run a regression loop: after each synth pass, "
                             "score the seed skill (eval.py --mode seed) against "
                             "the probe split. If pass rate > this, redraft. "
                             "Typical: 0.70 (probes must be hard enough that the "
                             "unoptimised seed solves <=70%%, leaving >=30pp "
                             "headroom for optim to demonstrate). Default: off.")
    parser.add_argument("--max-resynth", type=int, default=3,
                        help="max number of redraft iterations when "
                             "--target-pass-rate-max is set (default: 3)")
    parser.add_argument("--regression-split", default="probe",
                        help="which split to regress against the seed (default: probe)")
    args = parser.parse_args()

    settings_path = Path.home() / ".skillhone" / "settings.json"
    if not settings_path.exists():
        print("ERROR: ~/.skillhone/settings.json not found", file=sys.stderr)
        return 1
    settings = json.loads(settings_path.read_text())
    forgejo_cfg = settings.get("forgejo", {})
    token = forgejo_cfg.get("token", "")
    forgejo_url = forgejo_cfg.get("url", "http://localhost:3000")
    owner = forgejo_cfg.get("owner", "skillhone")

    from core.git_ops import clone as git_clone

    print(f"Cloning skill repo: {args.repo}")
    skill_clone = git_clone(args.repo, token=token)
    print(f"  → {skill_clone}")

    eval_url = args.repo.rstrip("/").removesuffix(".git") + "-eval.git"
    print(f"Cloning eval repo: {eval_url}")
    eval_clone = git_clone(eval_url, token=token)
    print(f"  → {eval_clone}")

    readme = Path(skill_clone) / "README.md"
    if not readme.exists():
        print("ERROR: skill repo has no README.md (no task spec)", file=sys.stderr)
        return 1

    # Prefer the eval-side full PRD as task.md (synth needs the rubric / gold
    # source contract, which has been stripped from skill_clone/README.md).
    # Fall back to skill_clone/README.md for legacy setups without a PRD.md in
    # the eval repo.
    eval_prd = Path(eval_clone) / "PRD.md"
    if eval_prd.exists():
        task_spec_source = eval_prd
        print(f"  using eval-side PRD as task spec: {eval_prd}")
    else:
        task_spec_source = readme
        print(f"  WARNING: no {eval_prd}; falling back to skill README "
              f"(synth won't see §3/eval rubric)")

    if args.target_pass_rate_max is not None:
        ok, msg = _check_seed_committed(Path(skill_clone))
        if not ok:
            print(f"ERROR: --target-pass-rate-max requires a seeded skill: {msg}",
                  file=sys.stderr)
            print("Run scripts/seed.py --repo <skill-url> first.", file=sys.stderr)
            return 2
        print(f"  seed check OK: {msg}")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    ws = Path(tempfile.mkdtemp(prefix="syn_ws_", dir=str(WORK_DIR)))

    skills_dst = ws / ".claude" / "skills"
    skills_dst.mkdir(parents=True, exist_ok=True)
    mounted: list[str] = []
    skipped: list[str] = []
    for lib in (SKILLS_DIR, Path.home() / ".claude" / "skills"):
        if not lib.exists():
            continue
        for src in sorted(lib.iterdir()):
            if not (src.is_dir() and (src / "SKILL.md").exists()):
                continue
            if src.name in mounted:
                continue
            try:
                shutil.copytree(
                    src, skills_dst / src.name,
                    dirs_exist_ok=False, ignore_dangling_symlinks=True,
                )
                mounted.append(src.name)
            except Exception as e:
                shutil.rmtree(skills_dst / src.name, ignore_errors=True)
                skipped.append(f"{src.name}({type(e).__name__})")

    agents_dst = ws / ".claude" / "agents"
    agents_dst.mkdir(parents=True, exist_ok=True)
    for sd in skills_dst.iterdir():
        ad = sd / "agents"
        if ad.is_dir():
            for am in ad.glob("*.md"):
                shutil.copy2(str(am), str(agents_dst / am.name))

    shutil.copy2(task_spec_source, ws / "task.md")

    repo_name = args.repo.rstrip("/").split("/")[-1].removesuffix(".git")
    run_id = _make_run_id(repo_name)
    run_dir = RUNS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    splits = [s.strip() for s in args.splits.split(",") if s.strip()]
    state = {
        "run_id": run_id,
        "repo": args.repo,
        "repo_name": repo_name,
        "eval_url": eval_url,
        "eval_clone": str(eval_clone),
        "workspace": str(ws),
        "target": args.target,
        "splits": splits,
        "regression": args.target_pass_rate_max is not None,
        "target_pass_rate_max": args.target_pass_rate_max,
        "max_resynth": args.max_resynth,
        "model": settings.get("improver", {}).get("sdk_model_alias", "opus"),
    }
    (run_dir / "state.json").write_text(json.dumps(state, indent=2))
    _log_event("synth_start", {"run_id": run_id, "run_dir": str(run_dir), **state})
    print(f"\n  Run: {run_dir}")
    print(f"  Mounted {len(mounted)} skills, skipped {len(skipped)}")

    base_prompt = (
        f"Use the `skillhone-synthesis` skill to synthesize closed-form eval "
        f"data for the task described in `task.md` (read it first).\n\n"
        f"Target yield: {args.target} validated samples PER split.\n"
        f"Splits to emit: {', '.join(splits)} — each as `<split>.jsonl` in the "
        f"working directory. The splits must be DISJOINT (no shared seed entities) "
        f"to prevent train/test leakage.\n\n"
        f"Each sample: a JSON object with at minimum `question` and `verification` "
        f"keys. The `verification` snippet must compile and execute deterministically "
        f"on the solver's `answer.txt`. No VLM / LLM judge unless task.md explicitly "
        f"calls for one.\n\n"
        f"DIFFICULTY REQUIREMENT — every question MUST require real computation, "
        f"not single-hop lookup. Each one must combine at least 3 of these "
        f"levers (per the synthesis skill's 'Difficulty Construction' section):\n"
        f"  • multi-hop: ≥3 dependent lookups / chained traversals\n"
        f"  • derived value: a rank, ratio, count, aggregation, or threshold\n"
        f"  • exclusion / tie-breaker: a constraint that disqualifies entities\n"
        f"  • cross-source: two distinct tool views combined\n"
        f"  • de-identification: target entity described by attributes, not name/ID\n"
        f"REJECT and rewrite any candidate answerable by a single direct lookup. "
        f"REJECT 'X's most-cited Y' style 1-hop questions. The reader should think "
        f"'this took real work to answer'.\n\n"
        f"Before finalizing each split, exec every verifier on a sentinel "
        f"baseline (a generic wrong answer) — at least 80% must reject it. If a "
        f"verifier passes the baseline, tighten it.\n\n"
        f"EXPLORE the local skill library before drafting. Skim peer SKILL.md "
        f"under .claude/skills/ for any quality / format / structural rules that "
        f"apply to the output type — transcribe those as additional verifier "
        f"checks.\n\n"
        f"HONOUR task.md's question-phrasing rules STRICTLY. If task.md "
        f"contains a 'FORBIDDEN', 'must not contain', 'do not leak', 'do not "
        f"name', or similar negative list applying to the question text, "
        f"treat it as a hard rejection rule. Before accepting any candidate, "
        f"re-read the question and verify it does NOT mention: the canonical "
        f"data source's name (when forbidden by task.md), any opaque "
        f"identifier strings the task spec lists in its rejection / "
        f"anti-leakage section (whatever shape — opaque database ids, "
        f"DOIs, ORCIDs, knowledge-graph entity codes, URLs, API path "
        f"fragments, etc.), or any literal API key / secret. Identifiers "
        f"belong only in eval-only metadata fields (e.g. "
        f"`reference_query` / `reference_pipeline` / `reference_url`) "
        f"that the eval-agent reads but the solver never sees. Reject and "
        f"rewrite any candidate that violates this.\n\n"
        f"HONOUR task.md's DIFFICULTY AND DATE-ANCHOR constraints with the "
        f"same strictness. If task.md specifies a 'Hard floor', a minimum "
        f"chain length, a numeric-answer floor (e.g. 'answers must not be a "
        f"bare year or integer < 100'), an 'event_date >= YYYY-MM-DD' anchor, "
        f"or a 'rejection list' of trivially-solvable templates, treat every "
        f"item as a hard rejection rule — items that violate ANY of them must "
        f"be redrafted, not shipped. Specifically, for every candidate: "
        f"(a) check the question text for any year mentioned that is strictly "
        f"before the task.md date anchor and reject if found; (b) extract the "
        f"date predicate of the reference query and confirm every returned "
        f"row's date is on/after the anchor; (c) check the gold answer is not "
        f"a bare year or a single integer below the task.md numeric floor "
        f"(default: integers must be >= 100, OR carry a unit suffix in the "
        f"gold list); (d) compare the candidate against the rejection list — "
        f"if it matches any forbidden template (e.g. 'In what year was X "
        f"founded', 'Who is the spouse of <famous>'), drop it. This is "
        f"non-negotiable. The fact that a candidate is well-formed SPARQL or "
        f"factually answerable does not override these gates.\n"
    )

    improver_cfg = settings.get("improver", {})
    model = improver_cfg.get("sdk_model_alias", "opus")
    improver_env = improver_cfg.get("env", {})
    disallowed_tools = improver_cfg.get("disallowed_tools", ["WebSearch"])
    # Allowlist of env-var names forwarded from the parent shell into the
    # synth agent. Read from `improver.passthrough_env` (a list of UPPER_CASE
    # names). Empty by default — task-domain credentials are opt-in per
    # deployment.
    passthrough_env = tuple(
        str(x) for x in (improver_cfg.get("passthrough_env") or []) if x
    )

    target_max = args.target_pass_rate_max
    max_iters = args.max_resynth if target_max is not None else 1
    regression_split = args.regression_split

    print(f"\nStarting synth (model={model}, max_turns={args.max_turns})")
    if target_max is not None:
        print(f"  REGRESSION ON: target seed pass rate ≤ {target_max:.2%}, "
              f"max_resynth={max_iters}, regression_split={regression_split}")
    else:
        print(f"  regression OFF (single-shot synth)")
    print(f"  splits: {splits}  target/split: {args.target}")
    print("=" * 60)

    iterations: list[dict] = []
    final_decision = "no_run"
    final_pass_rate: float | None = None

    for iteration in range(1, max_iters + 1):
        prompt = (_build_redraft_prompt(base_prompt, iterations, target_max)
                  if iteration > 1 and target_max is not None
                  else base_prompt)

        # Persist the per-iteration prompt for audit
        (run_dir / f"prompt_iter{iteration:02d}.md").write_text(prompt)

        print(f"\n===== Synth iteration {iteration} of {max_iters} =====")
        try:
            asyncio.run(_run_synth_agent(
                ws, prompt, model, args.max_turns, run_dir, iteration,
                disallowed_tools, improver_env, passthrough_env,
            ))
        except KeyboardInterrupt:
            _log_event("synth_end", {"run_id": run_id, "status": "interrupted",
                                      "iteration": iteration})
            return 130
        except Exception as e:
            _log_event("synth_end", {"run_id": run_id, "status": "error",
                                      "iteration": iteration, "error": str(e)})
            print(f"\nERROR in iteration {iteration}: {e}", file=sys.stderr)
            return 1

        # Recover output files (handle SDK cwd-offset bug)
        for split in splits:
            stray = Path(f"/data/workspace/{split}.jsonl")
            target_path = ws / f"{split}.jsonl"
            if stray.exists() and not target_path.exists():
                shutil.move(str(stray), str(target_path))
                print(f"  recovered {split}.jsonl from /data/workspace (SDK cwd offset)")

        # Validate
        print("\n=== Pre-flight: schema + verifier compile ===")
        all_ok = True
        for split in splits:
            sp = ws / f"{split}.jsonl"
            ok, msg = _validate_jsonl(sp)
            print(f"  {split}: {'OK' if ok else 'FAIL'} — {msg}")
            if not ok:
                all_ok = False
        if not all_ok:
            iterations.append({"iter": iteration, "validation_failed": True,
                                "pass_rate": 1.0, "traces": [], "questions": []})
            if iteration < max_iters and target_max is not None:
                print("  validation failed — archiving and redrafting")
                _archive_iteration(ws, splits, iteration)
                continue
            _log_event("synth_end", {"run_id": run_id, "status": "validation_failed",
                                      "iteration": iteration})
            print("ABORT: validation failed at final iteration", file=sys.stderr)
            return 2

        # Stage into eval clone (overwrites previous iteration's splits)
        for split in splits:
            shutil.copy2(ws / f"{split}.jsonl", Path(eval_clone) / f"{split}.jsonl")

        # If no regression mode, accept and break
        if target_max is None:
            iterations.append({"iter": iteration, "accepted": True})
            final_decision = "accepted_no_regression"
            break

        # Run seed eval
        print(f"\n=== Regression: seed × {regression_split} (iter {iteration}) ===")
        pass_rate, traces, log_path = _run_seed_eval(
            Path(skill_clone), Path(eval_clone), regression_split, run_dir, iteration,
        )
        final_pass_rate = pass_rate

        # Assemble probe questions for the observation log
        probe_path = ws / f"{regression_split}.jsonl"
        probe_questions = [json.loads(l) for l in probe_path.read_text().splitlines() if l.strip()]
        # Auto-uid the probe items if eval.py auto-assigned uids
        for i, q in enumerate(probe_questions):
            if "uid" not in q:
                q["uid"] = f"item_{i:02d}"

        accepted = pass_rate <= target_max
        decision = ("ACCEPT (under target)" if accepted
                    else f"REDRAFT → iter {iteration + 1}" if iteration < max_iters
                    else "PUSH AT MAX_ITERS (over target)")
        obs_md = _format_observation_md(
            iteration, max_iters, target_max, pass_rate, traces, decision,
            probe_questions,
        )
        obs_file = _write_synth_observation(Path(eval_clone), iteration, obs_md)
        print(f"  pass_rate={pass_rate:.2%}  decision={decision}")
        print(f"  observation: {obs_file}")

        iterations.append({
            "iter": iteration,
            "pass_rate": pass_rate,
            "traces": traces,
            "questions": probe_questions,
            "accepted": accepted,
            "decision": decision,
        })

        if accepted:
            final_decision = "accepted"
            print(f"\nACCEPT iter {iteration}: seed pass rate {pass_rate:.2%} ≤ {target_max:.2%}")
            break

        if iteration == max_iters:
            final_decision = "max_iters_pushed_anyway"
            print(f"\nMAX_ITERS reached: pushing iter {iteration}'s probe set anyway "
                  f"(pass rate {pass_rate:.2%}). Recorded as a synth-stage failure.")
            break

        print(f"\nREDRAFT iter {iteration}: pass rate {pass_rate:.2%} > {target_max:.2%}, "
              f"archiving and re-invoking synth with feedback")
        _archive_iteration(ws, splits, iteration)

    # Final push
    if args.no_push:
        print(f"\n--no-push: splits + observations staged at {eval_clone}, not pushed.")
    else:
        print("\n=== Pushing to forgejo ===")
        _push_eval(Path(eval_clone), repo_name, token, forgejo_url, owner, run_id)
        print(f"  pushed → {eval_url}")

    _log_event("synth_end", {
        "run_id": run_id, "status": "completed",
        "splits": splits, "target": args.target,
        "eval_clone": str(eval_clone),
        "iterations": len(iterations),
        "final_decision": final_decision,
        "final_pass_rate": final_pass_rate,
    })
    print(f"\nDone. Workspace: {ws}")
    print(f"  Run dir: {run_dir}")
    print(f"  Iterations: {len(iterations)}")
    if final_pass_rate is not None:
        print(f"  Final seed pass rate: {final_pass_rate:.2%}")
    print(f"  Decision: {final_decision}")

    if final_decision in ("accepted", "accepted_no_regression"):
        return 0
    if final_decision == "max_iters_pushed_anyway":
        return 4
    return 3


if __name__ == "__main__":
    sys.exit(main())
